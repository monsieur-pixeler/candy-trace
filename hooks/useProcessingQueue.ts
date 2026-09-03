import * as React from 'react';
import type { Action, AppState, GenHistory, GeminiTurn, ProcessingJob, WorkSide, PromptVersion, StyleSet } from '../types';
import { geminiService } from '../services/geminiService';
import { dbService } from '../services/dbService';
import { getApiImageParts, dataUrlToFile } from '../utils/fileUtils';
import { BLANK_CANVAS_INSTRUCTION, TRANSPARENT_BACKGROUND_INSTRUCTION } from '../constants';
import { generatePrompt } from '../utils/promptUtils';
import { cleanImageToOneBit, injectPromptIntoPng } from '../utils/imageUtils';
import { suggestLogoTextFromFilename } from '../utils/textUtils';

export function useProcessingQueue(
    state: AppState,
    dispatch: React.Dispatch<Action>,
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void
) {
    const { processingQueue, workPairs, styleSets, settings, isQueueRunning } = state;
    const isProcessingRef = React.useRef(false);

    React.useEffect(() => {
        if (processingQueue.length === 0 || isProcessingRef.current || !isQueueRunning) {
            return;
        }

        const processJob = async (job: ProcessingJob) => {
            isProcessingRef.current = true;
            const { workPairId, side } = job;
            const workPair = workPairs.find(wp => wp.id === workPairId);
            if (!workPair) {
                addLog('ERROR', `Could not find work pair with ID ${workPairId} for processing.`);
                dispatch({ type: 'DEQUEUE_JOB' });
                isProcessingRef.current = false;
                return;
            }

            const workSide = workPair[side];

            if (!workSide.originalFile) {
                addLog('WARN', `Skipping job for ${workPair.name} (Side ${side}) - no original file.`);
                dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { status: 'error', error: 'Missing original file.' } } });
                dispatch({ type: 'DEQUEUE_JOB' });
                isProcessingRef.current = false;
                return;
            }
            
            addLog('INFO', `Starting job for ${workPair.name} (Side ${side})...`);

            try {
                // Step 1: Update status to processing
                dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { status: 'processing', error: undefined } } });

                // Step 2: Determine prompt set and extract logo text if needed
                let logoText = workSide.logoText;
                let promptSet = workSide.promptSetOverride || settings.activePromptSet;

                // Priority 1: Check for special filename patterns (e.g., "Domino3x1").
                // This is fast, free, and more reliable than OCR for structured names.
                const textFromFilename = suggestLogoTextFromFilename(workPair.name);

                if (textFromFilename) {
                    logoText = textFromFilename;
                    // If we get text from the filename, we MUST use a prompt that can handle it.
                    // Force the use of the dynamic prompt set for this job.
                    promptSet = 'dynamicSimpleTrace'; 
                    addLog('INFO', `Detected filename pattern for '${workPair.name}'. Forcing dynamic prompt with text: "${logoText}".`);
                    // Update the work side so the UI reflects this automatic decision.
                    dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoText, logoExtractionStatus: 'extracted' } } });
                }
                // Priority 2: If no filename pattern, but user chose dynamic trace, run OCR.
                else if (promptSet === 'dynamicSimpleTrace' && workSide.logoExtractionStatus !== 'extracted') {
                    dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'extracting' } } });
                    try {
                        const result = await geminiService.extractTextFromImage(workSide.originalFile, settings.textModel);
                        logoText = result.extractedText;
                        dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'extracted', logoText } } });
                        addLog('INFO', `Extracted text "${logoText}" for ${workPair.name} (Side ${side}).`);
                    } catch (e) {
                        const err = e as Error;
                        dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'error', logoExtractionError: err.message } } });
                        addLog('WARN', `Failed to extract text for ${workPair.name} (Side ${side}): ${err.message}. Proceeding without it.`);
                    }
                }

                // Step 3: Prepare for image generation
                const candyPhoto = workSide.originalFile;
                
                const stylesToUse = (workSide.styleRefIds || [])
                    .map(id => styleSets.find(ss => ss.id === id))
                    .filter((ss): ss is StyleSet => !!ss && ss.active) // Ensure style exists and is active
                    .slice(0, settings.directTraceReferenceCount);

                let promptHistory: PromptVersion[];
                let activePromptId: string;

                if (promptSet === 'simpleTrace') {
                    promptHistory = settings.simpleTraceMainPromptHistory;
                    activePromptId = workSide.simpleTracePromptIdOverride || settings.activeSimpleTraceMainPromptId;
                } else { // 'dynamicSimpleTrace'
                    promptHistory = settings.dynamicSimpleTraceMainPromptHistory;
                    activePromptId = workSide.dynamicSimpleTracePromptIdOverride || settings.activeDynamicSimpleTraceMainPromptId;
                }
                
                const activePromptVersion = promptHistory.find(p => p.id === activePromptId) || promptHistory[0];
                if (!activePromptVersion) {
                    throw new Error(`Could not find an active prompt for the '${promptSet}' set.`);
                }
                
                const promptTemplate = activePromptVersion.content;
                const promptName = activePromptVersion.name;
                
                let fullPrompt = generatePrompt(promptTemplate, {
                    candyPhotoFilename: candyPhoto.name,
                    logoText: logoText || '',
                });

                if (settings.outputBackground === 'transparent') {
                    fullPrompt += `\n\n${TRANSPARENT_BACKGROUND_INSTRUCTION}`;
                } else if (settings.forceBlankCanvas) {
                    fullPrompt += `\n\n${BLANK_CANVAS_INSTRUCTION}`;
                }
                
                const conversation: GeminiTurn[] = [{
                    role: 'user',
                    parts: []
                }];
                
                // Add images to conversation
                conversation[0].parts.push(await getApiImageParts(candyPhoto).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } })));
                for (const style of stylesToUse) {
                    const traceFile = style.A.traceFile || style.B.traceFile;
                    if (traceFile) {
                        conversation[0].parts.push(await getApiImageParts(traceFile).then(({ data, mimeType }) => ({ inlineData: { data, mimeType } })));
                    }
                }
                
                // Add prompt text
                conversation[0].parts.push({ text: fullPrompt });
                
                // Step 4: Generate Image
                const startTime = Date.now();
                const systemInstruction = settings.systemInstructionEnabled ? settings.systemInstruction : null;
                const result = await geminiService.generateImageFromMultiModal(conversation, systemInstruction);
                const durationMs = Date.now() - startTime;
                
                if (!result.imageUrl) {
                    throw new Error(`Image generation failed. API response: ${result.text || 'No text response'}`);
                }

                let finalImageUrl = result.imageUrl;

                // Step 5: Post-processing
                if (settings.autoCleanTrace) {
                    finalImageUrl = await cleanImageToOneBit(finalImageUrl, settings.outputBackground, settings.size);
                }
                finalImageUrl = await injectPromptIntoPng(finalImageUrl, fullPrompt);

                // Step 6: Save trace to archive
                const traceImageFile = await dataUrlToFile(finalImageUrl, `${workPair.name}_${side}_trace.png`);
                const storedTrace = await dbService.saveTrace({
                    id: `${workPairId}-${side}-${Date.now()}`,
                    timestamp: Date.now(),
                    candyName: workPair.name,
                    side: side,
                    traceImageFile: traceImageFile,
                    candyImageFile: candyPhoto,
                    prompt: fullPrompt,
                    promptName: promptName,
                    styleRefIds: stylesToUse.map(s => s.id),
                    durationMs: durationMs,
                    systemInstruction: systemInstruction || undefined,
                    bucket: workSide.bucket,
                    origin: 'work',
                });
                dispatch({ type: 'ADD_TO_ARCHIVE', payload: storedTrace });
                
                const newHistory: GenHistory = {
                    timestamp: Date.now(),
                    stage: 'single',
                    imageUrl: finalImageUrl,
                    prompt: fullPrompt,
                    textResponse: result.text,
                    durationMs: durationMs,
                    styleRefId: stylesToUse[0]?.id,
                    styleRefName: stylesToUse[0]?.name,
                };
                
                // Step 7: Update work side with final result
                dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { status: 'done', pngUrl: finalImageUrl, gens: [...workSide.gens, newHistory] } } });
                dispatch({ type: 'UPDATE_PILL', payload: { id: workPairId, traceStatus: 'Completed' } });
                addLog('SUCCESS', `Successfully processed ${workPair.name} (Side ${side}).`);

            } catch (e) {
                const err = e as Error;
                addLog('ERROR', `Job for ${workPair.name} (Side ${side}) failed: ${err.message}`);
                dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { status: 'error', error: err.message } } });
            } finally {
                dispatch({ type: 'DEQUEUE_JOB' });
                isProcessingRef.current = false;
            }
        };

        if (processingQueue.length > 0 && !isProcessingRef.current && isQueueRunning) {
            processJob(processingQueue[0]);
        }

    }, [processingQueue, workPairs, styleSets, settings, dispatch, addLog, isQueueRunning]);
}