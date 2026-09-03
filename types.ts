import type { Part } from '@google/genai';

// ===================================================================================
//
//                                   TYPE DEFINITIONS
//
// ===================================================================================

// --- Base Types & Enums ---

export type Bucket = 'Round' | 'Oval/Oblong' | 'Square' | 'Rect/Logo' | 'Bar/Brick (Horizontal)' | 'Bar/Brick (Vertical)' | 'Shield/Emblem' | 'Crest/Badge' | 'Face/Head' | 'Hex/Polygon' | 'Diamond/Kite' | 'Triangle' | 'Rocket' | 'Bottle' | 'Bag' | 'Heart' | 'Tab/Quarter' | 'Novelty/Other' | 'Unassigned';
export type View = 'dashboard' | 'candies' | 'work' | 'styles' | 'settings' | 'sandbox' | 'traceArchive' | 'approvedLibrary';
export type TextModel = 'gemini-2.5-flash';
// Fix: Expand PromptHistoryKey to include all valid prompt history keys.
export type PromptHistoryKey = 'mainTracePromptHistory' | 'simpleTraceMainPromptHistory' | 'dynamicSimpleTraceMainPromptHistory';

// --- Data Structures ---

export type PromptVersion = {
  id: string;
  timestamp: number;
  name: string;
  content: string;
};

export type Side = {
    photoFile?: File;
    traceFile?: File;
};

export type PillSide = {
    originalFile?: File;
};

export type StyleSet = {
    id: string;
    name: string;
    bucket: Bucket;
    active: boolean;
    selected: boolean;
    isDetailsExpanded: boolean;
    classificationStatus: 'idle' | 'classifying' | 'classified' | 'error';
    classificationError?: string;
    A: Partial<Side>;
    B: Partial<Side>;
    similarityCheckStatus: 'idle' | 'checking' | 'checked' | 'error';
    similarityError?: string;
    isSimilarTo?: string[]; // Array of similar style set IDs
};

export type TraceabilityResult = {
    status: 'idle' | 'testing' | 'verified' | 'failed' | 'error';
    testImageUrl?: string;
    failureReason?: string;
    testError?: string;
};

export type Pill = {
    id: string;
    name: string;
    selected: boolean;
    isDetailsExpanded: boolean;
    bucket: Bucket;
    classificationStatus: 'idle' | 'classifying' | 'classified' | 'error';
    classificationError?: string;
    traceStatus: 'Untraced' | 'In Queue' | 'Completed';
    qualityAnalysisStatus: 'idle' | 'analyzing' | 'analyzed' | 'error';
    qualityAnalysisResult?: 'Good' | 'Poor' | 'Uncertain';
    qualityAnalysisReasoning?: string;
    qualityAnalysisError?: string;
    traceabilityTestA: TraceabilityResult;
    traceabilityTestB: TraceabilityResult;
    guidedTraceabilityTestA: TraceabilityResult;
    guidedTraceabilityTestB: TraceabilityResult;
    A: Partial<PillSide>;
    B: Partial<PillSide>;
    approvalStatus?: 'none' | 'pending' | 'partial' | 'full';
    latestTraceA?: { traceImageKey: string; isApproved: boolean; };
    latestTraceB?: { traceImageKey: string; isApproved: boolean; };
};

export type GenHistory = {
    timestamp: number;
    stage: 'stage1' | 'stage2' | 'single';
    imageUrl: string;
    prompt: string;
    textResponse?: string;
    durationMs?: number;
    styleRefId?: string;
    styleRefName?: string;
    styleRefImageUrl?: string;
};

export type WorkSide = {
    originalFile?: File;
    status: 'idle' | 'queued' | 'processing' | 'processing_stage1' | 'processing_stage2' | 'done' | 'error';
    error?: string;
    pngUrl?: string;
    stage1PngUrl?: string;
    gens: GenHistory[];
    bucket: Bucket;
    classificationStatus: string;
    classificationError?: string;
    logoText?: string;
    logoExtractionStatus: 'idle' | 'extracting' | 'extracted' | 'error';
    logoExtractionError?: string;
    promptSetOverride?: 'simpleTrace' | 'dynamicSimpleTrace'; // Kept for potential future use or specific overrides, though main UI is simplified.
    simpleTracePromptIdOverride?: string;
    dynamicSimpleTracePromptIdOverride?: string;
    styleRefIds?: string[];
};

export type WorkPair = {
    id: string;
    name: string;
    selected: boolean;
    isDetailsExpanded: boolean;
    sideComparisonStatus: 'idle' | 'comparing' | 'compared' | 'error';
    sideComparisonError?: string;
    areSidesDifferent?: boolean;
    A: WorkSide;
    B: WorkSide;
};

export type UnsavedTrace = {
    id: string;
    timestamp: number;
    candyName: string;
    side: 'A' | 'B';
    traceImageFile: File;
    candyImageFile: File;
    prompt: string;
    promptName?: string;
    styleRefIds: string[];
    durationMs?: number;
    selected?: boolean;
    origin: 'work' | 'sandbox' | 'test' | 'manual' | 'enhancement';
    systemInstruction?: string;
    bucket?: Bucket;
    isApproved?: boolean;
    isFavorite?: boolean;
    testType?: 'standard' | 'guided';
};

export type StoredTrace = {
    id: string;
    timestamp: number;
    candyName: string;
    side: 'A' | 'B';
    traceImageKey: string;
    candyImageKey: string;
    prompt: string;
    promptName?: string;
    styleRefIds: string[];
    durationMs?: number;
    selected: boolean;
    origin: 'work' | 'sandbox' | 'test' | 'manual' | 'enhancement';
    systemInstruction?: string;
    bucket?: Bucket;
    isFavorite?: boolean;
    isApproved?: boolean;
    testType?: 'standard' | 'guided';
};

// --- NEW: Trace Grouping & Versioning Types (centralized) ---
export type TraceVersion = StoredTrace;

export type TraceSideVersions = {
    side: 'A' | 'B';
    versions: TraceVersion[];
};

export type TraceGroup = {
    groupKey: string; // candyName
    candyName: string;
    bucket: Bucket;
    isFavorite: boolean; // Is any version a favorite?
    isApproved?: boolean; // Are ALL available sides having at least one approved version?
    latestTimestamp: number;
    sides: {
        A?: TraceSideVersions;
        B?: TraceSideVersions;
    };
};


export type SettingsPreset = {
    id: string;
    name: string;
    settings: Omit<Settings, 'presets' | 'activePresetId' | 'gcsApiKey'>;
};

export type Settings = {
    size: number;
    background: string;
    temperature: number;
    temperatureEnabled: boolean;
    systemInstruction: string;
    systemInstructionEnabled: boolean;
    forceBlankCanvas: boolean;
    textModel: TextModel;
    includeOpposite: boolean;
    preferTracesOnly: boolean;
    streaming: boolean;
    freezeStyleBuckets: boolean;
    rememberFiles: boolean;
    autoRestore: boolean;
    autoAssignMargin: number;
    useGeminiClassification: boolean;
    autoClassifyOnUpload: boolean;
    outputBackground: 'white' | 'transparent';
    autoCleanTrace: boolean;
    mainTracePromptHistory: PromptVersion[];
    activeMainTracePromptId: string;
    // Fix: Add back prompt-related settings to resolve type errors. These were likely removed by mistake.
    simpleTraceMainPromptHistory: PromptVersion[];
    activeSimpleTraceMainPromptId: string;
    dynamicSimpleTraceMainPromptHistory: PromptVersion[];
    activeDynamicSimpleTraceMainPromptId: string;
    activePromptSet: 'simpleTrace' | 'dynamicSimpleTrace';
    directTraceReferenceCount: 0 | 1;
    gcsEnabled: boolean;
    gcsBucketName: string;
    gcsApiKey: string;
    presets: SettingsPreset[];
    activePresetId: string | null;
    sandboxApiMode: 'direct' | 'conversational';
};

export type LogEntry = {
    /** Unique per entry — several entries can share the same millisecond. */
    id: string;
    ts: number;
    level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
    message: string;
};

export type ToastMessage = {
    id: number;
    type: 'success' | 'error' | 'info';
    message: string;
    duration?: number;
};

export type ProcessingJob = {
    workPairId: string;
    side: 'A' | 'B';
};

export type SandboxSessionTurn = {
    id: string;
    userInput: {
        text: string;
        isInitialPrompt: boolean;
    };
    modelOutput: {
        finalImageUrl: string | null;
        responseText: string | null;
        error: string | null;
    };
    status: 'pending' | 'complete' | 'error';
};

export type EnhanceSessionTurn = {
    id: string;
    userInput: {
        text: string;
    };
    modelOutput: {
        imageUrl: string | null;
        responseText: string | null;
        error: string | null;
    };
    status: 'pending' | 'complete' | 'error';
};

export type SandboxSessionData = {
    candyPhoto: File | null;
    styleTraces: File[];
    mainPrompt: string;
    systemInstruction: string;
    sessionTurns: SandboxSessionTurn[];
};

export type SerializedSandboxSessionData = {
    candyPhotoKey?: string;
    styleTraceKeys: string[];
    mainPrompt: string;
    systemInstruction: string;
    sessionTurns: SandboxSessionTurn[];
};

export type AppState = {
    pillLibrary: Pill[];
    styleSets: StyleSet[];
    workPairs: WorkPair[];
    traceArchive: StoredTrace[];
    settings: Settings;
    log: LogEntry[];
    processingQueue: ProcessingJob[];
    isQueueRunning: boolean;
    lastSessionSave: number | null;
    sandboxInitialData: SandboxSessionData | null;
};

export type GeminiTurn = {
    role: 'user' | 'model';
    parts: Part[];
};

export type WorkspaceBackup = {
    id: string;
    name: string;
    timestamp: number;
};

// --- Reducer Action ---

export type Action =
    | { type: 'INITIALIZE_STATE'; payload: Partial<AppState> }
    | { type: 'ADD_PILLS'; payload: Pill[] }
    | { type: 'SET_PILLS'; payload: Pill[] }
    | { type: 'UPDATE_PILL'; payload: Partial<Pill> & { id: string } }
    | { type: 'REMOVE_PILL'; payload: string }
    | { type: 'BULK_UPDATE_PILLS_BUCKET'; payload: { ids: string[]; bucket: Bucket } }
    | { type: 'BULK_SELECT_PILLS_IN_BUCKET'; payload: { bucket: Bucket; select: boolean } }
    | { type: 'BULK_SELECT_PILLS_BY_STATUS'; payload: { status: Pill['traceStatus']; select: boolean } }
    | { type: 'ADD_STYLE_SETS'; payload: StyleSet[] }
    | { type: 'SET_STYLE_SETS'; payload: StyleSet[] }
    | { type: 'UPDATE_STYLE_SET'; payload: Partial<StyleSet> & { id: string } }
    | { type: 'BULK_UPDATE_STYLE_SETS_BUCKET'; payload: { ids: string[]; bucket: Bucket } }
    | { type: 'REMOVE_STYLE_SET'; payload: string }
    | { type: 'RESET_STYLE_SET_CLASSIFICATION' }
    | { type: 'BULK_SELECT_STYLES_IN_BUCKET'; payload: { bucket: Bucket; select: boolean } }
    | { type: 'BULK_UPDATE_STYLE_SETS_ACTIVE'; payload: { ids: string[]; active: boolean } }
    | { type: 'ADD_WORK_PAIRS'; payload: WorkPair[] }
    | { type: 'UPDATE_WORK_PAIR'; payload: Partial<WorkPair> & { id: string } }
    | { type: 'REMOVE_WORK_PAIR'; payload: string }
    | { type: 'SET_WORK_PAIRS'; payload: WorkPair[] }
    | { type: 'UPDATE_WORK_SIDE'; payload: { workPairId: string; side: 'A' | 'B'; data: Partial<WorkSide> } }
    | { type: 'BULK_UPDATE_WORK_SIDES_BUCKET'; payload: { workPairIds: string[]; bucket: Bucket } }
    | { type: 'BULK_UPDATE_WORK_SIDES_REF_COUNT'; payload: { workPairIds: string[]; refCount: number } } // This is now unused but harmless to keep.
    | { type: 'BULK_SELECT_WORK_PAIRS_IN_BUCKET'; payload: { bucket: Bucket; select: boolean } }
    | { type: 'BULK_RETRACE_WORK_PAIRS'; payload: { ids: string[] } }
    | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
    | { type: 'SAVE_SETTINGS_AS_PRESET'; payload: { name: string } }
    | { type: 'LOAD_SETTINGS_PRESET'; payload: string }
    | { type: 'DELETE_SETTINGS_PRESET'; payload: string }
    // Fix: Simplify the ADD_PROMPT_VERSION payload by using the expanded PromptHistoryKey type.
    | { type: 'ADD_PROMPT_VERSION'; payload: { promptKey: PromptHistoryKey; version: PromptVersion } }
    | { type: 'ADD_LOG'; payload: Omit<LogEntry, 'ts' | 'id'> }
    | { type: 'CLEAR_LOG' }
    | { type: 'SET_PROCESSING_QUEUE'; payload: ProcessingJob[] }
    | { type: 'DEQUEUE_JOB' }
    | { type: 'SET_LAST_SAVE'; payload: number }
    | { type: 'SET_SANDBOX_INITIAL_DATA'; payload: SandboxSessionData | null }
    | { type: 'SET_TRACE_ARCHIVE'; payload: StoredTrace[] }
    | { type: 'ADD_TO_ARCHIVE'; payload: StoredTrace }
    | { type: 'UPDATE_ARCHIVE_ITEM'; payload: Partial<StoredTrace> & { id: string } }
    | { type: 'REMOVE_FROM_ARCHIVE'; payload: string[] }
    | { type: 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION'; payload: { ids: string[]; select: boolean } }
    | { type: 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL'; payload: { ids: string[]; isApproved: boolean } }
    | { type: 'FORCE_UPDATE_PROMPTS'; payload?: { silent: boolean } }
    | { type: 'BULK_AUTO_MATCH_STYLES'; payload: { workPairIds: string[] } }
    | { type: 'START_QUEUE' }
    | { type: 'STOP_QUEUE' }
    | { type: 'BULK_APPROVE_WORK_ITEMS'; payload: { workPairIds: string[] } }
    | { type: 'SYNC_PILLS_WITH_TRACES' };

// --- Workspace Backup Types ---

export type SerializedPillSide = {
    originalFile?: string; // path in zip
};

export type SerializedPill = Omit<Pill, 'A' | 'B' | 'selected' | 'isDetailsExpanded' | 'A.originalFile' | 'B.originalFile' | 'approvalStatus' | 'latestTraceA' | 'latestTraceB'> & {
    A: Partial<SerializedPillSide>;
    B: Partial<SerializedPillSide>;
};

export type SerializedSide = {
    photoFile?: string; // path in zip
    traceFile?: string; // path in zip
};

export type SerializedStyleSet = Omit<StyleSet, 'A' | 'B' | 'selected' | 'isDetailsExpanded' | 'A.photoFile' | 'B.photoFile' | 'A.traceFile' | 'B.traceFile'> & {
    A: Partial<SerializedSide>;
    B: Partial<SerializedSide>;
};

export type SerializedWorkSide = Omit<WorkSide, 'originalFile'> & {
    originalFile?: string; // path in zip
};

export type SerializedWorkPair = Omit<WorkPair, 'A' | 'B' | 'selected' | 'isDetailsExpanded'> & {
    A: SerializedWorkSide;
    B: SerializedWorkSide;
};

export type SerializedStoredTrace = Omit<StoredTrace, 'traceImageKey' | 'candyImageKey' | 'selected'> & {
    traceImageFile: string; // path in zip
    candyImageFile: string; // path in zip
};

export type BackupManifest = {
    version: string;
    pillLibrary: SerializedPill[];
    styleSets: SerializedStyleSet[];
    workPairs: SerializedWorkPair[];
    traceArchive: SerializedStoredTrace[];
    settings: Settings;
};