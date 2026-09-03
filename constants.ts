// Fix: Corrected import to reference the new types.ts file and removed circular dependency.
import type { Bucket, PromptVersion, Settings, Pill, TraceabilityResult } from './types';

// ===================================================================================
//
//                                   CONSTANTS
//
// ===================================================================================

export const BUCKETS: Bucket[] = [
  'Round', 'Oval/Oblong', 'Square', 'Rect/Logo', 'Bar/Brick (Horizontal)',
  'Bar/Brick (Vertical)', 'Shield/Emblem', 'Crest/Badge', 'Face/Head',
  'Hex/Polygon', 'Diamond/Kite', 'Triangle', 'Rocket', 'Bottle', 'Bag',
  'Heart', 'Tab/Quarter', 'Novelty/Other', 'Unassigned'
];

// DELETED: Text-guided prompt removed as the feature is no longer used.

// --- NEW: System instruction for the tracing model ---
export const SYSTEM_INSTRUCTION = `You are a precision AI tool for technical pharmaceutical line-art generation. Your function is to create a clean, 1-bit, black-and-white trace of a pill photograph, perfectly matching a provided visual style reference.`;

// --- NEW: Instruction to force a clean canvas output ---
export const BLANK_CANVAS_INSTRUCTION = `CRITICAL: The final output must be ONLY the generated trace on a pure white canvas. Do not include any part of the original photograph in the output. The background must be clean and white, containing only your black line art.`;

export const TRANSPARENT_BACKGROUND_INSTRUCTION = `CRITICAL: The final output must be ONLY the generated trace on a perfectly transparent background. Do not include any part of the original photograph in the output.`;


// --- NEW: Traceability Test Prompts ---
export const STANDARD_TEST_TRACE_PROMPT = `From the provided pill photograph, create a complete line-art trace that includes both the perimeter outline and all interior details (logos, text, score lines).

**CORE PRINCIPLE 1: INTERPRET 3D STRUCTURE FROM SHADOWS**
Your primary task is to convert the 3D features of the pill into clean 2D lines by interpreting their shadows.
- For **Debossed (Pressed In)** features like text or logos, a channel is pressed into the surface. This channel creates shadows on its sides. You MUST draw a SINGLE line down the exact center of this channel. **DO NOT trace both edges of the channel; trace only the single centerline.** This is what creates the "double outline" effect you must avoid.
- For **Embossed (Raised Up)** features, trace the outer edge of the feature where it casts its shadow.
- You MUST ignore all superficial visual noise like surface texture, grain, and dust. Trace the intended design, not the surface.

**CORE PRINCIPLE 2: ACCURATE INTERPRETATION OF FEATURES (CRITICAL)**
You are a visual transcription tool. Your trace must be a literal, 1-to-1 visual copy of the features physically imprinted on the object. **DO NOT rely on your pre-existing knowledge of logos, brands, or text.** For example, if you recognize a logo, you must trace the exact shapes and text *as they appear on the pill*, not how you remember the logo looking. **Crucially, you MUST NOT add symbols like the registered trademark (®) or copyright (©) unless they are clearly visible as part of the physical imprint in the photograph. For example, if you see the word "Levi's", DO NOT add the ® symbol if it is not physically present in the image.** Pay meticulous attention to:
- **Orientation:** Do not invert or mirror letters (e.g., 'N' should not become 'V').
- **Order:** Characters must appear in the correct sequence.
- **Spelling:** Transcribe text exactly as it is physically imprinted. If a letter is ambiguous, trace its shape as faithfully as possible.
The final trace must be a faithful and legible representation of the design on the object.

--- ABSOLUTE COMMANDS ---
1.  **NO HALLUCINATIONS OR EXTRAPOLATION:** You MUST NOT invent any features not clearly visible in the photo. If a score line or part of a logo appears broken or stops short in the photo, you MUST draw it exactly as it appears. **DO NOT extend or "complete" lines to form perfect geometric shapes like quadrants or grids.**
2.  **TRACE EDGES ONLY:** Only draw outlines. Do not fill them in with solid black.
3.  **1-BIT PURITY:** The final output must be pure black lines (#000000) on a pure white background (#FFFFFF). No gray, no anti-aliasing.
4.  **PERFECT REGISTRATION:** The output must be 1024x1024 and perfectly aligned with the input photo.`;

export const SIMPLE_TRACE_V1_PROMPT = `Create a technical line-art trace from the provided pill photograph.

**CORE PRINCIPLE 1: INTERPRET 3D STRUCTURE FROM SHADOWS**
Your primary task is to convert the 3D features of the pill into clean 2D lines. The lines you draw must be derived *only* from the distinct shadows cast by the pill's physical features.
- **Debossed Features (Pressed In):** These create shadows *inside* the shape. You must trace the center of these internal shadow channels.
- **Embossed Features (Raised Up):** These create shadows *outside* the shape. You must trace the outer edge of the feature where it casts its shadow.
**YOU MUST IGNORE ALL SUPERFICIAL VISUAL NOISE.** This is your most critical instruction. Ignore surface texture, graininess, speckles, dust, discoloration, and lighting artifacts. You are tracing the intended design, not the surface of the object.

**CORE PRINCIPLE 2: ACCURATE INTERPRETATION OF FEATURES (CRITICAL)**
You are a visual transcription tool. Your trace must be a literal, 1-to-1 visual copy of the features physically imprinted on the object. **DO NOT rely on your pre-existing knowledge of logos, brands, or text.** For example, if you recognize a logo, you must trace the exact shapes and text *as they appear on the pill*, not how you remember the logo looking. **Crucially, you MUST NOT add symbols like the registered trademark (®) or copyright (©) unless they are clearly visible as part of the physical imprint in the photograph.** Pay meticulous attention to:
- **Orientation:** Do not invert or mirror letters (e.g., 'N' should not become 'V').
- **Order:** Characters must appear in the correct sequence.
- **Spelling:** Transcribe text exactly as it is physically imprinted. If a letter is ambiguous, trace its shape as faithfully as possible.
The final trace must be a faithful and legible representation of the design on the object.

**STYLE REQUIREMENTS:**
1.  **Outer Contour:** The pill's main perimeter MUST be a single, **bold and uniform** stroke. Its thickness should be substantial, creating a strong, confident outline.
2.  **Interior Details:** All internal features (logos, text, score lines, symbols) MUST be traced with a single, **thin and uniform** stroke, significantly thinner than the outer contour.

--- ABSOLUTE COMMANDS ---
1.  **NO HALLUCINATIONS:** You MUST NOT invent any features not clearly visible in the photo.
2.  **TRACE EDGES ONLY:** Only draw outlines. Do not fill any areas with solid black.
3.  **1-BIT PURITY:** The output must be pure black lines (#000000) on a pure white background (#FFFFFF). No gray, no anti-aliasing.
4.  **PERFECT REGISTRATION:** The output must be 1024x1024 and perfectly aligned with the input photo.`;

export const SIMPLE_TRACE_V2_PROMPT = `Create a technical line-art trace from the provided pill photograph.

**STYLE REQUIREMENTS:**
1.  **Outer Contour:** The pill's main perimeter must be a single, **thick** stroke.
2.  **Interior Details:** All internal features (logos, text, score lines, symbols) must be traced with a single, **thin** stroke.

--- ABSOLUTE COMMANDS ---
1.  **NO HALLUCINATIONS:** You MUST NOT invent any features not clearly visible in the photo.
2.  **TRACE EDGES ONLY:** Only draw outlines. Do not fill any areas with solid black.
3.  **1-BIT PURITY:** The output must be pure black lines (#000000) on a pure white background (#FFFFFF). No gray, no anti-aliasing.
4.  **PERFECT REGISTRATION:** The output must be 1024x1024 and perfectly aligned with the input photo.`;

export const DYNAMIC_SIMPLE_TRACE_PROMPT = `Create a technical line-art trace from the provided pill photograph. The pill has the logo or text "{{logoText}}" on it.

**STYLE REQUIREMENTS:**
1.  **Outer Contour:** The pill's main perimeter must be a single, **thick** stroke.
2.  **Interior Details:** All internal features (logos, text, score lines, symbols) must be traced with a single, **thin** stroke, accurately representing "{{logoText}}".

--- ABSOLUTE COMMANDS ---
1.  **NO HALLUCINATIONS:** You MUST NOT invent any features not clearly visible in the photo.
2.  **TRACE EDGES ONLY:** Only draw outlines. Do not fill any areas with solid black.
3.  **1-BIT PURITY:** The output must be pure black lines (#000000) on a pure white background (#FFFFFF). No gray, no anti-aliasing.
4.  **PERFECT REGISTRATION:** The output must be 1024x1024 and perfectly aligned with the input photo.`;


const createInitialVersion = (content: string, name: string): PromptVersion => ({
  id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  timestamp: Date.now(),
  name,
  content,
});

const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

export const INITIAL_PILLS: Pill[] = [];

const createInitialSettings = (): Settings => {
    // Fix: Restore initialization of previously removed prompt settings to prevent crashes.
    const mainTraceV1 = createInitialVersion(SIMPLE_TRACE_V2_PROMPT, 'Main Text Trace v1');
    const simpleTraceV1 = createInitialVersion(SIMPLE_TRACE_V2_PROMPT, 'Simple Trace v1');
    const dynamicTraceV1 = createInitialVersion(DYNAMIC_SIMPLE_TRACE_PROMPT, 'Dynamic Trace v1');

    return {
        size: 1024,
        background: 'white',
        temperature: 0.0,
        temperatureEnabled: false,
        systemInstruction: SYSTEM_INSTRUCTION,
        systemInstructionEnabled: false,
        forceBlankCanvas: false,
        textModel: 'gemini-2.5-flash',
        includeOpposite: true,
        preferTracesOnly: true,
        streaming: false,
        freezeStyleBuckets: false,
        rememberFiles: true,
        autoRestore: true,
        autoAssignMargin: 0.1,
        useGeminiClassification: true,
        autoClassifyOnUpload: false,
        outputBackground: 'white',
        autoCleanTrace: false,
        mainTracePromptHistory: [mainTraceV1],
        activeMainTracePromptId: mainTraceV1.id,
        simpleTraceMainPromptHistory: [simpleTraceV1],
        activeSimpleTraceMainPromptId: simpleTraceV1.id,
        dynamicSimpleTraceMainPromptHistory: [dynamicTraceV1],
        activeDynamicSimpleTraceMainPromptId: dynamicTraceV1.id,
        activePromptSet: 'simpleTrace',
        directTraceReferenceCount: 0,
        gcsEnabled: false,
        gcsBucketName: '',
        gcsApiKey: '',
        presets: [],
        activePresetId: null,
        sandboxApiMode: 'conversational',
    };
};

export const INITIAL_SETTINGS: Settings = createInitialSettings();