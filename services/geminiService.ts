import { GoogleGenAI, Modality, Type, type GenerateContentResponse } from "@google/genai";
import { getApiImageParts, dataUrlToFile, getFileSHA256 } from "../utils/fileUtils";
import { BUCKETS } from "../constants";
import type { GeminiTurn, TextModel, Bucket } from "../types";
import { CLASSIFICATION_CACHE } from '../classificationCache';
import { apiKeyService } from './apiKeyService';

/**
 * Decide whether a failed Gemini call is worth retrying.
 *
 * The API reports status in the JSON error body, e.g. {"error":{"code":429,...}}.
 * We parse that code rather than pattern-matching digits anywhere in the message —
 * a message like "failed on item 412 of 542" must not be read as a 4xx status.
 *
 * Retryable:     429 (rate limit / quota) and 5xx (server-side, overloaded).
 * Not retryable: 400/401/403/404 (bad request, bad key, no access) and any
 *                safety / recitation block, which will fail identically on retry.
 */
function classifyGeminiError(errorMessage: string): { retryable: boolean; status: number | null } {
    const codeMatch = errorMessage.match(/"code"\s*:\s*(\d{3})/);
    const status = codeMatch ? Number(codeMatch[1]) : null;

    if (/\b(SAFETY|RECITATION|PROHIBITED_CONTENT)\b/.test(errorMessage) || /was blocked/i.test(errorMessage)) {
        return { retryable: false, status };
    }
    if (/No Gemini API key configured/.test(errorMessage)) {
        return { retryable: false, status };
    }

    if (status !== null) {
        if (status === 429) return { retryable: true, status };
        if (status >= 500) return { retryable: true, status };
        if (status >= 400) return { retryable: false, status };
        return { retryable: true, status };
    }

    // No status code: transient network failures are worth one more try.
    return { retryable: true, status: null };
}

/**
 * Read the text of a Gemini response, or throw an error that says what actually happened.
 *
 * `response.text` is `string | undefined`: it is undefined whenever the model returned no
 * text part, which is exactly what happens on a safety block, a recitation block, or a
 * MAX_TOKENS truncation. Calling `.trim()` on it directly turns every one of those cases
 * into "Cannot read properties of undefined (reading 'trim')", which tells the user nothing
 * and matches no branch of the retry classifier.
 */
function requireResponseText(response: GenerateContentResponse): string {
    const text = response.text;
    if (typeof text === 'string' && text.trim()) {
        return text.trim();
    }

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
        throw new Error(`Request was blocked. Reason: ${blockReason}.`);
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        throw new Error(`The model stopped early (finishReason: ${finishReason}) and returned no text.`);
    }

    throw new Error('The model returned an empty response.');
}

export namespace geminiService {
    
    /**
     * UNIFIED FUNCTION: Generates an image and optional text from a multi-modal conversation history.
     * This is the single entry point for all image generation tasks, ensuring a consistent and robust
     * conversational request structure is used across the application.
     * @param conversation An array of GeminiTurn objects representing the conversation history.
     * @param systemInstruction The system instruction string, or null if it should not be included.
     * @returns A promise that resolves to an object containing the generated image URL and any accompanying text.
     */
    export async function generateImageFromMultiModal(conversation: GeminiTurn[], systemInstruction: string | null): Promise<{ imageUrl?: string; text?: string }> {
      const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const config: {
              systemInstruction?: string;
              responseModalities: Modality[];
          } = {
              responseModalities: [Modality.IMAGE, Modality.TEXT],
          };

          if (systemInstruction) {
              config.systemInstruction = systemInstruction;
          }

          const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: conversation,
            config: config,
          });

          if (response.promptFeedback?.blockReason) {
            throw new Error(`Request was blocked. Reason: ${response.promptFeedback.blockReason}.`);
          }
          if (!response.candidates || response.candidates.length === 0) {
            throw new Error("API returned no candidates.");
          }
          
          const candidate = response.candidates[0];
          if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            throw new Error("API returned a candidate with no content parts.");
          }

          let imageUrl: string | undefined;
          let text: string | undefined;

          for (const part of candidate.content.parts) {
            if (part.text) {
              text = part.text;
            } else if (part.inlineData) {
              imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
          }

          if (!imageUrl) {
            throw new Error(`API did not return an image. Text response: "${text || 'none'}"`);
          }

          return { imageUrl, text };
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            const isNonRetryable = !classifyGeminiError(errorMessage).retryable;

            if (isNonRetryable) {
                console.error("Gemini Multi-Modal Error (non-retryable):", error);
                if (error instanceof Error) throw new Error(`Gemini Multi-Modal Error: ${error.message}`);
                throw new Error("An unknown error occurred with the Gemini API.");
            }

            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                console.warn(`Gemini Multi-Modal failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Gemini Multi-Modal failed after ${maxRetries + 1} attempts.`, error);
                if (error instanceof Error) throw new Error(`Gemini Multi-Modal Error: ${error.message}`);
                throw new Error("An unknown error occurred with the Gemini API after all retries.");
            }
        }
      }
      throw new Error("Gemini Multi-Modal request failed unexpectedly after all retries.");
    }

    // DELETED: analyzeStyleTrace function has been removed.

    export async function classifyObjectShape(candyPhoto: File, temperature: number | undefined, model: TextModel): Promise<{ bucket: Bucket; reasoning: string }> {
      const fileHash = await getFileSHA256(candyPhoto);
      const cachedEntry = CLASSIFICATION_CACHE[fileHash];
      if (cachedEntry) {
          console.log(`[Cache Hit] Classification for ${candyPhoto.name} (hash: ${fileHash})`);
          return {
              bucket: cachedEntry.bucket as Bucket,
              reasoning: `${cachedEntry.reasoning} (from cache)`
          };
      }

      const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
      const prompt = `Analyze the candy image. Classify its primary shape into one of these categories: ${BUCKETS.join(', ')}. Respond in JSON.`;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { data, mimeType } = await getApiImageParts(candyPhoto);
          const candyPhotoPart = { inlineData: { data, mimeType } };
          const textPart = { text: prompt };

          const config: any = {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bucket: { type: Type.STRING, description: 'The most appropriate shape category for the object.', enum: BUCKETS },
                reasoning: { type: Type.STRING, description: 'A brief explanation for the classification choice.' },
              },
              required: ['bucket', 'reasoning'],
            },
          };

          if (temperature !== undefined) {
            config.temperature = temperature;
          }

          const response = await ai.models.generateContent({ model, contents: { parts: [candyPhotoPart, textPart] }, config });
          const jsonText = requireResponseText(response);
          const result = JSON.parse(jsonText);

          if (!result.bucket || !BUCKETS.includes(result.bucket)) {
            throw new Error('API returned an invalid bucket category.');
          }

          return { bucket: result.bucket as Bucket, reasoning: result.reasoning || 'No reasoning provided.' };
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            const isNonRetryable = !classifyGeminiError(errorMessage).retryable;
            
            if (isNonRetryable) {
                console.error("Gemini Classification Error (non-retryable):", error);
                if (error instanceof Error) throw new Error(`Gemini Classification Error: ${error.message}`);
                throw new Error("An unknown error occurred during classification.");
            }

            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                console.warn(`Gemini Classification failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Gemini Classification failed after ${maxRetries + 1} attempts.`, error);
                if (error instanceof Error) throw new Error(`Gemini Classification Error: ${error.message}`);
                throw new Error("An unknown error occurred during classification after all retries.");
            }
        }
      }
      throw new Error("Gemini Classification failed unexpectedly after all retries.");
    }

    export async function extractTextFromImage(image: File, model: TextModel): Promise<{ extractedText: string }> {
        const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
        const prompt = "Perform OCR on the provided image of a pill. Transcribe all visible text, numbers, and symbols exactly as they appear, preserving line breaks if any. Return only the transcribed text, with no additional commentary or explanation.";
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const imagePart = await getApiImageParts(image).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } }));
                const textPart = { text: prompt };
                
                const response = await ai.models.generateContent({ model, contents: { parts: [imagePart, textPart] }});
                const extractedText = requireResponseText(response);

                if (!extractedText) {
                    throw new Error("API did not return any text.");
                }

                return { extractedText };

            } catch (error) {
                const errorMessage = (error instanceof Error) ? error.message : String(error);
                const isNonRetryable = !classifyGeminiError(errorMessage).retryable;

                if (isNonRetryable) {
                    console.error("Gemini Text Extraction Error (non-retryable):", error);
                    if (error instanceof Error) throw new Error(`Gemini Text Extraction Error: ${error.message}`);
                    throw new Error("An unknown error occurred during text extraction.");
                }

                if (attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt);
                    console.warn(`Gemini Text Extraction failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Gemini Text Extraction failed after ${maxRetries + 1} attempts.`, error);
                    if (error instanceof Error) throw new Error(`Gemini Text Extraction Error: ${error.message}`);
                    throw new Error("An unknown error occurred during text extraction after all retries.");
                }
            }
        }
        throw new Error("Gemini Text Extraction failed unexpectedly after all retries.");
    }

    export async function compareObjectSides(imageA: File, imageB: File, temperature: number | undefined, model: TextModel): Promise<{ areDifferent: boolean, reasoning: string }> {
        const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
        const prompt = `You are a visual design analyst. Your task is to determine if the designs on two sides of an object are significantly different.

**Context:** The application needs to know if it should find a separate artistic style reference for Side B, or if the style from Side A is sufficient.

**Instructions:**
1.  Compare the two images provided (Side A and Side B of an object).
2.  **Focus on major design elements:** Are the logos, markings, imprints, or overall shapes fundamentally different? A score line on one side and a logo on the other are considered different. A blank side is considered different from a side with any markings.
3.  **IGNORE minor variations:** Do not be concerned with slight changes in lighting, angle, or texture.
4.  **Answer the core question:** Is Side B just a blank version of Side A, or does it have a completely different design that would require its own unique style guide?

Provide your analysis in JSON format.`;
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const imageAPart = await getApiImageParts(imageA).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } }));
                const imageBPart = await getApiImageParts(imageB).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } }));
                const textPart = { text: prompt };

                const config: any = {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            areDifferent: { type: Type.BOOLEAN, description: 'True if the designs on the two sides are significantly different, otherwise false.' },
                            reasoning: { type: Type.STRING, description: 'A brief explanation for your decision.' }
                        },
                        required: ['areDifferent', 'reasoning'],
                    }
                };
                
                if (temperature !== undefined) {
                    config.temperature = temperature;
                }

                const response = await ai.models.generateContent({ model, contents: { parts: [imageAPart, imageBPart, textPart] }, config });
                const jsonText = requireResponseText(response);
                const result = JSON.parse(jsonText);

                if (typeof result.areDifferent !== 'boolean') {
                    throw new Error('API response for side comparison was missing the "areDifferent" boolean.');
                }

                return { areDifferent: result.areDifferent, reasoning: result.reasoning || 'No reasoning provided.' };
            } catch (error) {
                const errorMessage = (error instanceof Error) ? error.message : String(error);
                const isNonRetryable = !classifyGeminiError(errorMessage).retryable;
                
                if (isNonRetryable) {
                    console.error("Gemini Side Comparison Error (non-retryable):", error);
                    if (error instanceof Error) throw new Error(`Gemini Side Comparison Error: ${error.message}`);
                    throw new Error("An unknown error occurred during side comparison.");
                }

                if (attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt);
                    console.warn(`Gemini Side Comparison failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Gemini Side Comparison failed after ${maxRetries + 1} attempts.`, error);
                    if (error instanceof Error) throw new Error(`Gemini Side Comparison Error: ${error.message}`);
                    throw new Error("An unknown error occurred during side comparison after all retries.");
                }
            }
        }
        throw new Error("Gemini Side Comparison failed unexpectedly after all retries.");
    }

    export async function refinePromptsInConversation(
      conversation: GeminiTurn[],
      currentSystemPrompt: string,
      currentMainPrompt: string,
      model: TextModel
    ): Promise<{ chatResponse: string; suggestedSystemInstruction: string; suggestedMainPrompt: string }> {
      const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
      const metaPrompt = `You are a world-class prompt engineering expert co-pilot for the Google Gemini API, specifically for image generation. Your user is trying to refine prompts for a technical, 1-bit, black-and-white line art generation task.

Your goal is to have a conversation with the user to help them improve their prompts. You must be helpful, concise, and focus on generating high-quality prompts.

The user will provide their current prompts-in-progress, the conversation history, and a new message. This message may include images for context (e.g., examples of good or bad output).

You MUST respond with a valid JSON object. This JSON object must have three fields:
1.  \`chatResponse\`: A friendly, conversational message to display to the user in the chat UI. This should explain the changes you've made.
2.  \`suggestedSystemInstruction\`: The COMPLETE, revised System Instruction.
3.  \`suggestedMainPrompt\`: The COMPLETE, revised Main Prompt.

**Do not only return the changes.** You must return the full text for both prompts.

Here is the current state of the prompts the user is editing:

--- CURRENT SYSTEM INSTRUCTION ---
${currentSystemPrompt}
--- END CURRENT SYSTEM INSTRUCTION ---

--- CURRENT MAIN PROMPT ---
${currentMainPrompt}
--- END CURRENT MAIN PROMPT ---
`;

      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const fullConversation = [
                ...conversation.slice(0, -1), // History
                {
                    role: 'user',
                    parts: [
                        { text: metaPrompt },
                        ...conversation[conversation.length - 1].parts
                    ]
                }
            ] as GeminiTurn[];

          const response = await ai.models.generateContent({
            model,
            contents: fullConversation,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  chatResponse: { type: Type.STRING, description: 'Your conversational response to the user explaining your changes.' },
                  suggestedSystemInstruction: { type: Type.STRING, description: 'The full, revised System Instruction text.' },
                  suggestedMainPrompt: { type: Type.STRING, description: 'The full, revised Main Prompt text.' },
                },
                required: ['chatResponse', 'suggestedSystemInstruction', 'suggestedMainPrompt'],
              },
            },
          });

          const jsonText = requireResponseText(response);
          const result = JSON.parse(jsonText);

          if (!result.chatResponse || !result.suggestedSystemInstruction || !result.suggestedMainPrompt) {
            throw new Error('API response for prompt refinement was incomplete.');
          }

          return result;

        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            const isNonRetryable = !classifyGeminiError(errorMessage).retryable;
            
            if (isNonRetryable) {
                console.error("Gemini Prompt Refinement Error (non-retryable):", error);
                if (error instanceof Error) throw new Error(`Gemini Prompt Refinement Error: ${error.message}`);
                throw new Error("An unknown error occurred during prompt refinement.");
            }

            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                console.warn(`Gemini Prompt Refinement failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Gemini Prompt Refinement failed after ${maxRetries + 1} attempts.`, error);
                if (error instanceof Error) throw new Error(`Gemini Prompt Refinement Error: ${error.message}`);
                throw new Error("An unknown error occurred during prompt refinement after all retries.");
            }
        }
      }
      throw new Error("Gemini Prompt Refinement failed unexpectedly after all retries.");
    }

    export async function analyzeSimilarity(
      image1: File,
      image2: File,
      name1: string,
      name2: string,
      temperature: number | undefined,
      model: TextModel
    ): Promise<{ isSimilar: boolean; reasoning: string }> {
      const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });

      const prompt = `You are an expert visual style analyst for a technical illustration application. Your task is to determine if two provided style-reference images are functionally redundant *for the purpose of generating line art*.

**Context:** The application takes a photo of an object and uses these style references to create a 1-bit, black and white line drawing. The key artistic elements are:
1.  **Line quality:** Smoothness, thickness, consistency.
2.  **Contouring:** How edges are defined (e.g., single thick line, double line "echo" effect).
3.  **Detail rendering:** How internal logos, text, or features are simplified into lines.

**Task:**
Compare \`image[0]\` (${name1}) and \`image[1]\` (${name2}).

**CRITICAL INSTRUCTIONS:**
*   **IGNORE SHAPE AND COLOR:** The overall shape (round, square, etc.) and color of the object in the photo are irrelevant. Focus ONLY on the artistic style of the line art.
*   **IGNORE CONTENT:** The specific logo (e.g., "IKEA" vs. "Netflix") is not important. What matters is *how* the logo is drawn.
*   **FOCUS ON REDUNDANCY:** Are the styles so similar that having both in a library would be redundant? Would they guide the AI to produce nearly identical outputs?

Provide your analysis in JSON format.`;
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const { data: data1, mimeType: mimeType1 } = await getApiImageParts(image1);
                const image1Part = { inlineData: { data: data1, mimeType: mimeType1 } };
                const { data: data2, mimeType: mimeType2 } = await getApiImageParts(image2);
                const image2Part = { inlineData: { data: data2, mimeType: mimeType2 } };
                const textPart = { text: prompt };

                const config: any = {
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        isSimilar: { type: Type.BOOLEAN, description: 'True if the artistic styles are functionally redundant, otherwise false.' },
                        reasoning: { type: Type.STRING, description: 'A brief explanation for your decision, focusing on line quality, contouring, and detail rendering.' },
                      },
                      required: ['isSimilar', 'reasoning'],
                    },
                };

                if (temperature !== undefined) {
                    config.temperature = temperature;
                }

                const response = await ai.models.generateContent({ model, contents: { parts: [image1Part, image2Part, textPart] }, config });
                const jsonText = requireResponseText(response);
                const result = JSON.parse(jsonText);
                
                if (typeof result.isSimilar !== 'boolean') {
                  throw new Error('API response for similarity analysis was missing the "isSimilar" boolean.');
                }

                return { isSimilar: result.isSimilar, reasoning: result.reasoning || 'No reasoning provided.' };
            } catch (error) {
                const errorMessage = (error instanceof Error) ? error.message : String(error);
                const isNonRetryable = !classifyGeminiError(errorMessage).retryable;
                
                if (isNonRetryable) {
                    console.error("Gemini Similarity Analysis Error (non-retryable):", error);
                    if (error instanceof Error) throw new Error(`Gemini Similarity Analysis Error: ${error.message}`);
                    throw new Error("An unknown error occurred during similarity analysis.");
                }

                if (attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt);
                    console.warn(`Gemini Similarity Analysis failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Gemini Similarity Analysis failed after ${maxRetries + 1} attempts.`, error);
                    if (error instanceof Error) throw new Error(`Gemini Similarity Analysis Error: ${error.message}`);
                    throw new Error("An unknown error occurred during similarity analysis after all retries.");
                }
            }
        }
        throw new Error("Gemini Similarity Analysis failed unexpectedly after all retries.");
    }
    
    export async function analyzePillQuality(
        pillPhoto: File,
        temperature: number | undefined,
        model: TextModel,
        signal?: AbortSignal
    ): Promise<{ quality: 'Good' | 'Poor' | 'Uncertain'; reasoning: string }> {
        const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
        const prompt = `You are a master technical illustrator specializing in converting pill photographs into 1-bit, black-and-white line art. Your task is to evaluate a photograph of a pill to determine if its imprints (logos, text, score lines from embossing or debossing) are suitable for being accurately traced by an AI.

--- CRITICAL EVALUATION PRINCIPLES ---
1.  **FOCUS ON STRUCTURAL INTEGRITY, IGNORE SURFACE TEXTURE:** Your primary goal is to identify the structural lines created by the imprint's shadows and highlights. The pill's superficial surface texture (e.g., graininess, speckles, color variations, minor chips) is IRRELEVANT and MUST BE IGNORED.
2.  **SHADOWS DEFINE THE LINES:** A successful trace interprets the shadows cast by an imprint as the lines. Low color contrast between the imprint and the pill body is acceptable IF the shadow contrast is high and clearly defines the shape.
3.  **LEARN FROM EXAMPLES:**
    *   **GOLD STANDARD for 'Good' Quality:** An orange, rectangular 'The North Face' pill with a grainy texture. The logo is clearly debossed, creating sharp, continuous shadows. This is 'Good' because an AI can confidently trace these shadow lines to create a perfect line art version, completely ignoring the surface noise.
    *   **ANOTHER 'Good' EXAMPLE:** A blue, hexagonal pill with a 'PP' logo. The pill has visible speckles. However, the logo and hexagonal border are deeply impressed, creating distinct, unambiguous shadows. This is 'Good' because the structural lines are clear.
    *   **DEFINITIVELY 'Poor' Quality:** A pill where the imprint is worn down, shallow, or filled with debris, making the shadow lines incomplete, faint, or ambiguous. If you cannot confidently determine the complete shape of a letter or logo from its shadows, it is 'Poor'.

--- TASK ---
Based on these principles, analyze the provided user image. Classify the **AI traceability** of the imprint as one of the following:
- "Good": The imprint is sharp, deep, and casts clear, unambiguous shadows that form complete lines. An AI can trace this with high accuracy.
- "Poor": The imprint is worn, shallow, or incomplete. The shadows are too faint, broken, or ambiguous for an AI to trace reliably.
- "Uncertain": The quality is borderline. Some parts are clear, but others may be difficult for an AI to interpret.

Provide your response in JSON format. Your reasoning must focus on the quality of the shadow lines from the imprint, not the surface texture.`;
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const { data, mimeType } = await getApiImageParts(pillPhoto);
                const photoPart = { inlineData: { data, mimeType } };
                const textPart = { text: prompt };

                const config: any = {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            quality: { type: Type.STRING, description: 'The assessed quality for AI tracing.', enum: ['Good', 'Poor', 'Uncertain'] },
                            reasoning: { type: Type.STRING, description: 'A brief explanation for the quality assessment, focusing on the clarity of shadow lines from the imprint.' },
                        },
                        required: ['quality', 'reasoning'],
                    },
                };

                if (temperature !== undefined) {
                    config.temperature = temperature;
                }

                // Fix: The `signal` for request cancellation must be passed inside a `requestOptions` object, not as a top-level property.
                const params: any = {
                    model,
                    contents: { parts: [photoPart, textPart] },
                    config,
                };
                if (signal) {
                    params.requestOptions = { signal };
                }
                const response = await ai.models.generateContent(params);
                const jsonText = requireResponseText(response);
                const result = JSON.parse(jsonText);

                if (!result.quality || !['Good', 'Poor', 'Uncertain'].includes(result.quality)) {
                    throw new Error('API returned an invalid quality category.');
                }

                return { quality: result.quality, reasoning: result.reasoning || 'No reasoning provided.' };
            } catch (error) {
                const errorMessage = (error instanceof Error) ? error.message : String(error);
                if ((error as Error).name === 'AbortError') {
                    throw error; // Re-throw cancellation errors to be handled by the caller
                }
                const isNonRetryable = !classifyGeminiError(errorMessage).retryable;
                
                if (isNonRetryable) {
                    console.error("Gemini Quality Analysis Error (non-retryable):", error);
                    if (error instanceof Error) throw new Error(`Gemini Quality Analysis Error: ${error.message}`);
                    throw new Error("An unknown error occurred during quality analysis.");
                }

                if (attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt);
                    console.warn(`Gemini Quality Analysis failed (Attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s... Error: ${errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Gemini Quality Analysis failed after ${maxRetries + 1} attempts.`, error);
                    if (error instanceof Error) throw new Error(`Gemini Quality Analysis Error: ${error.message}`);
                    throw new Error("An unknown error occurred during quality analysis after all retries.");
                }
            }
        }
        throw new Error("Gemini Quality Analysis failed unexpectedly after all retries.");
    }

    export async function performAndVerifyTestTrace(
        pillPhoto: File,
        model: TextModel,
        tracePrompt: string,
    ): Promise<{ success: boolean; reason: string; imageUrl: string }> {
        // Stage 1: Generate a quick, style-less trace
        const candyPhotoPart = await getApiImageParts(pillPhoto).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } }));
        const tracePromptPart = { text: tracePrompt };
        const conversation: GeminiTurn[] = [{ role: 'user', parts: [candyPhotoPart, tracePromptPart] }];
        
        const { imageUrl } = await generateImageFromMultiModal(conversation, null);
        if (!imageUrl) {
            throw new Error("Test trace generation failed to produce an image.");
        }

        // Stage 2: Verify the generated trace
        const ai = new GoogleGenAI({ apiKey: apiKeyService.require() });
        const verificationPrompt = `You are a meticulous quality assurance expert for a technical illustration AI. Your task is to compare an original photograph of a pill with an AI-generated line-art trace of that pill.

You will be given two images:
1. The original photograph.
2. The AI-generated trace.

Your goal is to determine if the trace is a **successful and accurate representation** of the features visible in the photograph.

- A **successful** trace accurately captures all major, non-ambiguous features (text, logos, score lines) and the main perimeter.
- A **failed** trace misses key details, hallucinates features not present in the photo, or is substantially incomplete.

**CRITICAL:** Ignore minor imperfections. Focus on the overall accuracy and completeness.

Respond in JSON format.`;

        const testTraceFile = await dataUrlToFile(imageUrl, 'test_trace.png');
        const testTracePart = await getApiImageParts(testTraceFile).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } }));
        const verificationTextPart = { text: verificationPrompt };
        
        const verificationConfig: any = {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    isTraceSuccessful: { type: Type.BOOLEAN, description: 'True if the AI trace is an accurate and complete representation of the original photo.' },
                    failureReason: { type: Type.STRING, description: 'A brief, clear explanation of why the trace failed. If successful, this should be a confirmation like "All key features were captured successfully."' }
                },
                required: ['isTraceSuccessful', 'failureReason']
            }
        };

        const response = await ai.models.generateContent({ model, contents: { parts: [candyPhotoPart, testTracePart, verificationTextPart] }, config: verificationConfig });
        const jsonText = requireResponseText(response);
        const result = JSON.parse(jsonText);

        if (typeof result.isTraceSuccessful !== 'boolean') {
            throw new Error("Verification response did not contain a valid 'isTraceSuccessful' field.");
        }

        return {
            success: result.isTraceSuccessful,
            reason: result.failureReason || (result.isTraceSuccessful ? "Trace successful." : "No reason provided."),
            imageUrl: imageUrl
        };
    }
}