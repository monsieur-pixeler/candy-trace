import type { Action, AppState, LogEntry, PromptVersion, SettingsPreset, StoredTrace, TraceabilityResult, WorkSide, Bucket } from './types';
import { DYNAMIC_SIMPLE_TRACE_PROMPT, INITIAL_SETTINGS, SIMPLE_TRACE_V2_PROMPT } from './constants';
import { syncPillsWithTraces } from './utils/traceSyncUtils';

/**
 * Unique id for a log entry. `Date.now()` alone collides whenever two entries are
 * pushed in the same millisecond, which React then reports as duplicate keys.
 */
let logSeq = 0;
function newLogId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    logSeq += 1;
    return `log_${Date.now()}_${logSeq}`;
}


export const initialState: AppState = {
    pillLibrary: [],
    styleSets: [],
    workPairs: [],
    traceArchive: [],
    settings: INITIAL_SETTINGS,
    // Fix: Add 'as const' to ensure 'level' is typed as a literal, not a general string.
    log: [{ id: newLogId(), level: 'INFO' as const, message: 'Application starting...', ts: Date.now() }],
    processingQueue: [],
    // Fix: Add missing 'isQueueRunning' property to conform to AppState type.
    isQueueRunning: false,
    lastSessionSave: null,
    sandboxInitialData: null,
};

const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

export function appReducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case 'INITIALIZE_STATE': {
            const newState = { ...state, ...action.payload };
            if (newState.pillLibrary.length > 0 && newState.traceArchive.length > 0) {
                const updatedPills = syncPillsWithTraces(newState.pillLibrary, newState.traceArchive);
                return { ...newState, pillLibrary: updatedPills };
            }
            return newState;
        }
        
        case 'ADD_PILLS': {
            const newPills = action.payload.map(p => ({
                ...p,
                traceabilityTestA: initialTraceabilityResult,
                traceabilityTestB: initialTraceabilityResult,
                guidedTraceabilityTestA: initialTraceabilityResult,
                guidedTraceabilityTestB: initialTraceabilityResult,
            }));
            return { ...state, pillLibrary: [...state.pillLibrary, ...newPills] };
        }
        case 'SET_PILLS':
            return { ...state, pillLibrary: action.payload };
        case 'UPDATE_PILL':
            return { ...state, pillLibrary: state.pillLibrary.map(p => p.id === action.payload.id ? { ...p, ...action.payload } : p) };
        case 'REMOVE_PILL':
            return { ...state, pillLibrary: state.pillLibrary.filter(p => p.id !== action.payload) };
        case 'BULK_UPDATE_PILLS_BUCKET':
            return { ...state, pillLibrary: state.pillLibrary.map(p => action.payload.ids.includes(p.id) ? { ...p, bucket: action.payload.bucket } : p) };
        case 'BULK_SELECT_PILLS_IN_BUCKET':
            return { ...state, pillLibrary: state.pillLibrary.map(p => p.bucket === action.payload.bucket ? { ...p, selected: action.payload.select } : p) };
        case 'BULK_SELECT_PILLS_BY_STATUS':
             return { ...state, pillLibrary: state.pillLibrary.map(p => p.traceStatus === action.payload.status ? { ...p, selected: action.payload.select } : p) };

        case 'ADD_STYLE_SETS':
            return { ...state, styleSets: [...state.styleSets, ...action.payload] };
        case 'SET_STYLE_SETS':
            return { ...state, styleSets: action.payload };
        case 'UPDATE_STYLE_SET':
            return { ...state, styleSets: state.styleSets.map(s => s.id === action.payload.id ? { ...s, ...action.payload } : s) };
        case 'BULK_UPDATE_STYLE_SETS_BUCKET':
             return { ...state, styleSets: state.styleSets.map(s => action.payload.ids.includes(s.id) ? { ...s, bucket: action.payload.bucket } : s) };
        case 'REMOVE_STYLE_SET':
            return { ...state, styleSets: state.styleSets.filter(s => s.id !== action.payload) };
        case 'RESET_STYLE_SET_CLASSIFICATION':
            return { ...state, styleSets: state.styleSets.map(s => ({...s, classificationStatus: 'idle' })) };
        case 'BULK_SELECT_STYLES_IN_BUCKET':
             return { ...state, styleSets: state.styleSets.map(s => s.bucket === action.payload.bucket ? { ...s, selected: action.payload.select } : s) };
        case 'BULK_UPDATE_STYLE_SETS_ACTIVE':
            return { ...state, styleSets: state.styleSets.map(s => action.payload.ids.includes(s.id) ? { ...s, active: action.payload.active } : s) };

        case 'ADD_WORK_PAIRS':
            return { ...state, workPairs: [...state.workPairs, ...action.payload] };
        case 'UPDATE_WORK_PAIR':
            return { ...state, workPairs: state.workPairs.map(wp => wp.id === action.payload.id ? { ...wp, ...action.payload } : wp) };
        case 'REMOVE_WORK_PAIR':
            return { ...state, workPairs: state.workPairs.filter(wp => wp.id !== action.payload) };
        case 'SET_WORK_PAIRS':
            return { ...state, workPairs: action.payload };
        case 'UPDATE_WORK_SIDE':
            return {
                ...state,
                workPairs: state.workPairs.map(wp => {
                    if (wp.id === action.payload.workPairId) {
                        return { ...wp, [action.payload.side]: { ...wp[action.payload.side], ...action.payload.data } };
                    }
                    return wp;
                })
            };
        case 'BULK_UPDATE_WORK_SIDES_BUCKET': {
            const newWorkPairs = state.workPairs.map(wp => {
                if (action.payload.workPairIds.includes(wp.id)) {
                    return {
                        ...wp,
                        A: { ...wp.A, bucket: action.payload.bucket },
                        B: { ...wp.B, bucket: action.payload.bucket }
                    };
                }
                return wp;
            });
            return { ...state, workPairs: newWorkPairs };
        }
        case 'BULK_UPDATE_WORK_SIDES_REF_COUNT': {
             const newWorkPairs = state.workPairs.map(wp => {
                if (action.payload.workPairIds.includes(wp.id)) {
                    // This logic is now moot but kept for type safety. It will have no effect.
                    const newA = { ...wp.A };
                    const newB = { ...wp.B };
                    return { ...wp, A: newA, B: newB };
                }
                return wp;
            });
            return { ...state, workPairs: newWorkPairs };
        }
        case 'BULK_SELECT_WORK_PAIRS_IN_BUCKET':
            return { ...state, workPairs: state.workPairs.map(wp => (wp.A.bucket === action.payload.bucket) ? { ...wp, selected: action.payload.select } : wp) };
        case 'BULK_RETRACE_WORK_PAIRS': {
            return {
                ...state,
                workPairs: state.workPairs.map(wp => {
                    if (action.payload.ids.includes(wp.id)) {
                        const retraceSide = (side: 'A' | 'B'): WorkSide => {
                            const currentSide = wp[side];
                            if (currentSide.status === 'done' || currentSide.status === 'error') {
                                // Explicitly copy properties to avoid losing any during the spread operation.
                                const newSide: WorkSide = {
                                    originalFile: currentSide.originalFile,
                                    status: 'idle', // Reset status
                                    error: undefined, // Clear error
                                    pngUrl: currentSide.pngUrl, // Explicitly preserve the trace preview
                                    stage1PngUrl: currentSide.stage1PngUrl, // Explicitly preserve stage 1 trace
                                    gens: currentSide.gens,
                                    bucket: currentSide.bucket,
                                    classificationStatus: currentSide.classificationStatus,
                                    classificationError: currentSide.classificationError,
                                    logoText: currentSide.logoText,
                                    logoExtractionStatus: currentSide.logoExtractionStatus,
                                    logoExtractionError: currentSide.logoExtractionError,
                                    styleRefIds: currentSide.styleRefIds,
                                };
                                return newSide;
                            }
                            return currentSide;
                        };
                        return { ...wp, A: retraceSide('A'), B: retraceSide('B') };
                    }
                    return wp;
                })
            };
        }

        case 'UPDATE_SETTINGS':
            return { 
                ...state, 
                settings: { 
                    ...state.settings, 
                    ...action.payload, 
                    activePresetId: null 
                } 
            };
        case 'SAVE_SETTINGS_AS_PRESET': {
            const { name } = action.payload;
            const existingPreset = state.settings.presets.find(p => p.name === name);
            const { presets, activePresetId, ...settingsToSave } = state.settings;
            let newPresets: SettingsPreset[];
            let newActiveId: string;

            if (existingPreset) {
                const updatedPreset = { ...existingPreset, settings: settingsToSave };
                newPresets = state.settings.presets.map(p => p.id === existingPreset.id ? updatedPreset : p);
                newActiveId = existingPreset.id;
            } else {
                const newPreset: SettingsPreset = { id: `preset_${Date.now()}`, name, settings: settingsToSave };
                newPresets = [...state.settings.presets, newPreset];
                newActiveId = newPreset.id;
            }
            return {
                ...state,
                settings: { ...state.settings, presets: newPresets, activePresetId: newActiveId }
            };
        }
        case 'LOAD_SETTINGS_PRESET': {
            const preset = state.settings.presets.find(p => p.id === action.payload);
            if (!preset) return state;
            const { gcsApiKey, presets } = state.settings;
            return {
                ...state,
                settings: { ...state.settings, ...preset.settings, gcsApiKey, presets, activePresetId: preset.id }
            };
        }
        case 'DELETE_SETTINGS_PRESET': {
            const newPresets = state.settings.presets.filter(p => p.id !== action.payload);
            const newActiveId = state.settings.activePresetId === action.payload ? null : state.settings.activePresetId;
            return {
                ...state,
                settings: { ...state.settings, presets: newPresets, activePresetId: newActiveId }
            };
        }
        case 'ADD_PROMPT_VERSION':
            return {
                ...state,
                settings: {
                    ...state.settings,
                    [action.payload.promptKey]: [...(state.settings[action.payload.promptKey] || []), action.payload.version]
                }
            };
        case 'FORCE_UPDATE_PROMPTS': {
            const { settings } = state;
            let updatedSettings = { ...settings };
            const newLogs: Omit<LogEntry, 'ts' | 'id'>[] = [];

            const createNewVersion = (content: string, name: string): PromptVersion => ({
                id: `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                timestamp: Date.now(),
                name,
                content
            });

            // Check Simple Trace Prompt
            const hasLatestSimple = settings.simpleTraceMainPromptHistory.some(p => p.content.trim() === SIMPLE_TRACE_V2_PROMPT.trim());
            if (!hasLatestSimple) {
                const newVersion = createNewVersion(SIMPLE_TRACE_V2_PROMPT, 'Simple Trace (v0.5 Update)');
                updatedSettings = {
                    ...updatedSettings,
                    simpleTraceMainPromptHistory: [newVersion, ...settings.simpleTraceMainPromptHistory],
                    activeSimpleTraceMainPromptId: newVersion.id
                };
                newLogs.push({ level: 'SUCCESS', message: 'Updated Simple Trace prompt to the latest version.' });
            }

            // Check Dynamic Simple Trace Prompt
            const hasLatestDynamic = settings.dynamicSimpleTraceMainPromptHistory.some(p => p.content.trim() === DYNAMIC_SIMPLE_TRACE_PROMPT.trim());
            if (!hasLatestDynamic) {
                const newVersion = createNewVersion(DYNAMIC_SIMPLE_TRACE_PROMPT, 'Dynamic Trace (v0.5 Update)');
                updatedSettings = {
                    ...updatedSettings,
                    dynamicSimpleTraceMainPromptHistory: [newVersion, ...settings.dynamicSimpleTraceMainPromptHistory],
                    activeDynamicSimpleTraceMainPromptId: newVersion.id
                };
                newLogs.push({ level: 'SUCCESS', message: 'Updated Dynamic Trace prompt to the latest version.' });
            }

            if (newLogs.length > 0) {
                const newLogEntries = newLogs.map(log => ({ ...log, id: newLogId(), ts: Date.now() }));
                return { 
                    ...state, 
                    settings: updatedSettings,
                    log: [...newLogEntries, ...state.log].slice(0, 200)
                };
            } else {
                if (!action.payload?.silent) {
                    // Fix: Add 'as const' to ensure 'level' is typed as a literal, not a general string. This resolves the type error.
                    const noChangeLog = { id: newLogId(), level: 'INFO' as const, message: 'All prompts are already up-to-date.', ts: Date.now() };
                    return { ...state, log: [noChangeLog, ...state.log].slice(0, 200) };
                }
            }
            return state;
        }
        case 'ADD_LOG': {
            const newLog = [{ ...action.payload, id: newLogId(), ts: Date.now() }, ...state.log];
            if (newLog.length > 200) newLog.length = 200;
            return { ...state, log: newLog };
        }
        case 'CLEAR_LOG':
            return { ...state, log: [] };
        case 'SET_PROCESSING_QUEUE':
            return { ...state, processingQueue: action.payload };
        case 'DEQUEUE_JOB':
            return { ...state, processingQueue: state.processingQueue.slice(1) };
        case 'SET_LAST_SAVE':
            return { ...state, lastSessionSave: action.payload };
        case 'SET_SANDBOX_INITIAL_DATA':
            return { ...state, sandboxInitialData: action.payload };
        
        case 'SET_TRACE_ARCHIVE': {
            const newArchive = action.payload.map(t => ({...t, isFavorite: t.isFavorite ?? false, isApproved: t.isApproved ?? false}));
            const updatedPills = syncPillsWithTraces(state.pillLibrary, newArchive);
            return { ...state, traceArchive: newArchive.sort((a,b) => b.timestamp - a.timestamp), pillLibrary: updatedPills };
        }
        case 'ADD_TO_ARCHIVE': {
            const newTrace = { ...action.payload, isFavorite: action.payload.isFavorite ?? false, isApproved: action.payload.isApproved ?? false };
            let newArchive: StoredTrace[];
            if (state.traceArchive.some(t => t.id === newTrace.id)) {
                newArchive = state.traceArchive.map(t => t.id === newTrace.id ? newTrace : t);
            } else {
                newArchive = [newTrace, ...state.traceArchive];
            }
            newArchive.sort((a,b) => b.timestamp - a.timestamp);
            const updatedPills = syncPillsWithTraces(state.pillLibrary, newArchive);
            return { ...state, traceArchive: newArchive, pillLibrary: updatedPills };
        }
        case 'UPDATE_ARCHIVE_ITEM': {
            const newArchive = state.traceArchive.map(t => t.id === action.payload.id ? { ...t, ...action.payload } : t);
            const updatedPills = syncPillsWithTraces(state.pillLibrary, newArchive);
            return { ...state, traceArchive: newArchive, pillLibrary: updatedPills };
        }
        case 'REMOVE_FROM_ARCHIVE': {
            const newArchive = state.traceArchive.filter(t => !action.payload.includes(t.id));
            const updatedPills = syncPillsWithTraces(state.pillLibrary, newArchive);
            return { ...state, traceArchive: newArchive, pillLibrary: updatedPills };
        }
        case 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION':
            return { ...state, traceArchive: state.traceArchive.map(t => action.payload.ids.includes(t.id) ? { ...t, selected: action.payload.select } : t) };
        case 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL': {
            const newArchive = state.traceArchive.map(t => action.payload.ids.includes(t.id) ? { ...t, isApproved: action.payload.isApproved } : t);
            const updatedPills = syncPillsWithTraces(state.pillLibrary, newArchive);
            return { ...state, traceArchive: newArchive, pillLibrary: updatedPills };
        }
        
        case 'SYNC_PILLS_WITH_TRACES': {
            const updatedPills = syncPillsWithTraces(state.pillLibrary, state.traceArchive);
            return { ...state, pillLibrary: updatedPills };
        }

        case 'START_QUEUE':
            return { ...state, isQueueRunning: true };
        case 'STOP_QUEUE':
            return { ...state, isQueueRunning: false };

        case 'BULK_AUTO_MATCH_STYLES': {
            const { styleSets, settings } = state;
            const activeStylesByBucket = styleSets.reduce((acc, style) => {
                if (style.active) {
                    if (!acc[style.bucket]) acc[style.bucket] = [];
                    acc[style.bucket].push(style.id);
                }
                return acc;
            }, {} as Record<Bucket, string[]>);

            const newWorkPairs = state.workPairs.map(wp => {
                if (action.payload.workPairIds.includes(wp.id)) {
                    const matchStyles = (side: WorkSide): string[] => {
                        const potentialIds = activeStylesByBucket[side.bucket] || [];
                        if (potentialIds.length === 0) return [];
                        
                        const shuffled = [...potentialIds].sort(() => 0.5 - Math.random());
                        return shuffled.slice(0, settings.directTraceReferenceCount);
                    };

                    return {
                        ...wp,
                        A: { ...wp.A, styleRefIds: matchStyles(wp.A) },
                        B: { ...wp.B, styleRefIds: matchStyles(wp.B) }
                    };
                }
                return wp;
            });
            return { ...state, workPairs: newWorkPairs };
        }

        case 'BULK_APPROVE_WORK_ITEMS': {
            const { workPairs, traceArchive } = state;
            const workPairIdsToApprove = new Set(action.payload.workPairIds);
            
            const completedSides: { candyName: string; side: 'A' | 'B' }[] = [];
            workPairs.forEach(wp => {
                if (workPairIdsToApprove.has(wp.id)) {
                    if (wp.A.status === 'done') completedSides.push({ candyName: wp.name, side: 'A' });
                    if (wp.B.status === 'done') completedSides.push({ candyName: wp.name, side: 'B' });
                }
            });

            const traceIdsToApprove = new Set<string>();
            completedSides.forEach(({ candyName, side }) => {
                const latestTraceForSide = traceArchive
                    .filter(t => t.candyName === candyName && t.side === side && t.origin === 'work')
                    .sort((a, b) => b.timestamp - a.timestamp)[0];
                
                if (latestTraceForSide) {
                    traceIdsToApprove.add(latestTraceForSide.id);
                }
            });
            
            if (traceIdsToApprove.size > 0) {
                const newTraceArchive = traceArchive.map(t =>
                    traceIdsToApprove.has(t.id) ? { ...t, isApproved: true } : t
                );
                const updatedPills = syncPillsWithTraces(state.pillLibrary, newTraceArchive);
                return { ...state, traceArchive: newTraceArchive, pillLibrary: updatedPills };
            }
            return state;
        }

        default:
            return state;
    }
}