import * as React from 'react';
import saveAs from 'file-saver';
import JSZip from 'jszip';
// Fix: Added TraceSideVersions to the type import to resolve the 'Cannot find name' error.
import type { Action, AppState, StoredTrace, StyleSet, Bucket, TraceGroup, TraceSideVersions, UnsavedTrace, GeminiTurn } from '../types';
import { dbService } from '../services/dbService';
import { TrashIcon, DownloadIcon, XIcon, InfoIcon, LayersIcon, StarIcon, ListBulletIcon, Squares2X2Icon, CheckIcon, WrenchScrewdriverIcon, Spinner, ChevronDownIcon, SparklesIcon } from './icons';
import { FileImagePreview, DbFileImagePreview } from './common';
// Fix: Replaced SIMPLE_TRACE_PROMPT with SIMPLE_TRACE_V2_PROMPT as it's the correct exported member.
import { BUCKETS, STANDARD_TEST_TRACE_PROMPT, SIMPLE_TRACE_V2_PROMPT, DYNAMIC_SIMPLE_TRACE_PROMPT, TRANSPARENT_BACKGROUND_INSTRUCTION, BLANK_CANVAS_INSTRUCTION } from '../constants';
import { cleanImageToOneBit } from '../utils/imageUtils';
import { dataUrlToFile, getApiImageParts } from '../utils/fileUtils';
import { groupTracesWithVersioning, suggestLogoTextFromFilename } from '../utils/textUtils';
import { geminiService } from '../services/geminiService';
import { generatePrompt } from '../utils/promptUtils';
import { EnhanceTraceModal } from './EnhanceTraceModal';

// Fix: Defined DownloadOption type to resolve 'Cannot find name' errors.
type DownloadOption = 'traces' | 'traces_meta' | 'full';


const TraceDetailsModal: React.FC<{
    group: TraceGroup;
    styleSets: StyleSet[];
    settings: AppState['settings'];
    onClose: () => void;
    onDelete: (ids: string[]) => void;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ group, styleSets, settings, onClose, onDelete, dispatch, addLog }) => {
    
    const [activeVersionA, setActiveVersionA] = React.useState(0);
    const [activeVersionB, setActiveVersionB] = React.useState(0);
    const [enhanceModalState, setEnhanceModalState] = React.useState<{ isOpen: boolean; trace: StoredTrace | null }>({ isOpen: false, trace: null });
    
    const [enhanceFiles, setEnhanceFiles] = React.useState<{ originalPhoto: File | null; initialTraceUrl: string | null }>({ originalPhoto: null, initialTraceUrl: null });

    const versionCountA = group.sides.A?.versions.length ?? 0;
    const versionCountB = group.sides.B?.versions.length ?? 0;
    const prevVersionCountA = React.useRef(versionCountA);
    const prevVersionCountB = React.useRef(versionCountB);

    React.useEffect(() => {
        if (versionCountA > prevVersionCountA.current) {
            setActiveVersionA(0);
        }
        prevVersionCountA.current = versionCountA;
    }, [versionCountA]);

    React.useEffect(() => {
        if (versionCountB > prevVersionCountB.current) {
            setActiveVersionB(0);
        }
        prevVersionCountB.current = versionCountB;
    }, [versionCountB]);

    const handleOpenEnhance = React.useCallback(async (trace: StoredTrace) => {
        addLog('INFO', 'Preparing enhancement co-pilot...');
        try {
            const photo = await dbService.getFileLocal(trace.candyImageKey);
            const traceFile = await dbService.getFileLocal(trace.traceImageKey);
            if (!photo || !traceFile) {
                throw new Error("Could not load files for enhancement.");
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setEnhanceFiles({ originalPhoto: photo, initialTraceUrl: reader.result as string });
                setEnhanceModalState({ isOpen: true, trace });
            };
            reader.readAsDataURL(traceFile);
        } catch (e) {
            addLog('ERROR', `Failed to prepare enhancement: ${(e as Error).message}`);
        }
    }, [addLog]);

    const handleUpdateFromEnhance = async (newImageUrl: string, fullPrompt: string) => {
        const originalTrace = enhanceModalState.trace;
        if (!originalTrace) return;

        addLog('INFO', `Saving enhanced trace for '${originalTrace.candyName}'...`);
        try {
            const traceImageFile = await dataUrlToFile(newImageUrl, 'enhanced_trace.png');
            const candyImageFile = await dbService.getFileLocal(originalTrace.candyImageKey);
            if (!candyImageFile) throw new Error("Could not find original candy photo to save with enhancement.");

            const newTrace: UnsavedTrace = {
                id: `enhance-${originalTrace.id}-${Date.now()}`,
                timestamp: Date.now(),
                candyName: originalTrace.candyName,
                side: originalTrace.side,
                traceImageFile,
                candyImageFile,
                prompt: fullPrompt,
                promptName: `Enhanced: ${originalTrace.promptName || 'Trace'}`,
                styleRefIds: originalTrace.styleRefIds,
                origin: 'enhancement',
                systemInstruction: originalTrace.systemInstruction,
                bucket: originalTrace.bucket,
            };
            const storedTrace = await dbService.saveTrace(newTrace);
            dispatch({ type: 'ADD_TO_ARCHIVE', payload: storedTrace });
            addLog('SUCCESS', `Saved enhanced trace for ${originalTrace.candyName} to archive.`);
        } catch (error) {
            addLog('ERROR', `Failed to save enhanced trace: ${(error as Error).message}`);
        } finally {
            setEnhanceModalState({ isOpen: false, trace: null });
        }
    };


    const renderSide = (sideVersions?: TraceSideVersions, activeIndex?: number, setActiveIndex?: (index: number) => void) => {
        if (!sideVersions || !setActiveIndex || activeIndex === undefined) {
            return (
                <div className="bg-gray-100 p-4 rounded-lg border flex items-center justify-center text-gray-500 h-full">
                    <p>Side not available.</p>
                </div>
            );
        }

        const selectedTrace = sideVersions.versions[activeIndex];

        return (
            <div className="flex flex-col space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold">Side {sideVersions.side}</h2>
                    {sideVersions.versions.length > 1 && (
                        <div className="flex items-center space-x-1 flex-wrap gap-y-1">
                            {sideVersions.versions.map((v, index) => {
                                let label = v.origin || 'trace';
                                if (v.origin === 'test' && v.testType) {
                                    label = `${v.testType} test`;
                                }
                                const versionNum = sideVersions.versions.length - index;
                                const fullLabel = `v${versionNum} (${label})`;

                                return (
                                    <button
                                        key={v.id}
                                        onClick={() => setActiveIndex(index)}
                                        className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${activeIndex === index ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                        title={new Date(v.timestamp).toLocaleString()}
                                    >
                                        {fullLabel}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                {selectedTrace && <SideDetail trace={selectedTrace} styleSets={styleSets} settings={settings} onDelete={() => onDelete([selectedTrace.id])} dispatch={dispatch} addLog={addLog} onOpenEnhance={handleOpenEnhance} />}
            </div>
        );
    }

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4" onClick={onClose}>
                <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-7xl max-h-[90vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center border-b pb-3 mb-4 flex-shrink-0">
                        <h2 className="text-2xl font-bold">{group.candyName}</h2>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XIcon className="w-6 h-6" /></button>
                    </div>
                    <div className="overflow-y-auto flex-grow pr-2 grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {renderSide(group.sides.A, activeVersionA, setActiveVersionA)}
                        {renderSide(group.sides.B, activeVersionB, setActiveVersionB)}
                    </div>
                </div>
            </div>
            {enhanceModalState.isOpen && enhanceModalState.trace && enhanceFiles.originalPhoto && enhanceFiles.initialTraceUrl && (
                <EnhanceTraceModal
                    candyName={enhanceModalState.trace.candyName}
                    side={enhanceModalState.trace.side}
                    originalPhoto={enhanceFiles.originalPhoto}
                    initialTraceUrl={enhanceFiles.initialTraceUrl}
                    originalPrompt={enhanceModalState.trace.prompt}
                    settings={settings}
                    onClose={() => setEnhanceModalState({ isOpen: false, trace: null })}
                    onUpdateTrace={handleUpdateFromEnhance}
                    addLog={addLog}
                />
            )}
        </>
    );
};

const SideDetail: React.FC<{
    trace: StoredTrace;
    styleSets: StyleSet[];
    settings: AppState['settings'];
    onDelete: () => void;
    onOpenEnhance: (trace: StoredTrace) => void;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ trace, styleSets, settings, onDelete, onOpenEnhance, dispatch, addLog }) => {

    const [retraceState, setRetraceState] = React.useState<{ status: 'idle' | 'tracing', type: string | null }>({ status: 'idle', type: null });
    const traceImageFile = React.useMemo(() => dbService.getFileLocal(trace.traceImageKey), [trace.traceImageKey]);
    const candyImageFile = React.useMemo(() => dbService.getFileLocal(trace.candyImageKey), [trace.candyImageKey]);

     const usedStyles = React.useMemo(() => {
        return trace.styleRefIds.map(id => styleSets.find(s => s.id === id || s.name === id)).filter((s): s is StyleSet => !!s);
    }, [trace.styleRefIds, styleSets]);

     const handleDownload = async () => {
        const file = await traceImageFile;
        if (file) {
            saveAs(file, `${trace.candyName}_Side_${trace.side}_trace_${trace.timestamp}.png`);
        }
    };

    const handleSendToStyles = async () => {
        const newStyleName = window.prompt("Enter a name for the new Style Set:", `${trace.candyName}`);
        if (!newStyleName || !newStyleName.trim()) return;
        
        addLog('INFO', `Creating new style set '${newStyleName}'...`);
        try {
            const cFile = await candyImageFile;
            const tFile = await traceImageFile;
            if (!cFile || !tFile) throw new Error("Could not retrieve image files from database.");
            
            const newStyleSet: StyleSet = {
                id: `style_${newStyleName.trim().replace(/\s+/g, '_')}_${Date.now()}`,
                name: newStyleName.trim(),
                bucket: trace.bucket || 'Unassigned',
                active: true, selected: false, isDetailsExpanded: false, classificationStatus: 'classified',
                A: {}, B: {}, similarityCheckStatus: 'idle',
            };
            
            const sideData = { photoFile: cFile, traceFile: tFile };
            if (trace.side === 'A') newStyleSet.A = sideData;
            else newStyleSet.B = sideData;
    
            dispatch({ type: 'ADD_STYLE_SETS', payload: [newStyleSet] });
            addLog('SUCCESS', `Successfully added '${newStyleName}' to the Style Library.`);
        } catch (error) {
            addLog('ERROR', `Failed to create style set: ${(error as Error).message}`);
        }
    };

    const toggleFavorite = async () => {
        const newIsFavorite = !trace.isFavorite;
        dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isFavorite: newIsFavorite }});
        try {
            await dbService.updateTrace({ id: trace.id, isFavorite: newIsFavorite });
        } catch(e) {
            addLog('ERROR', `Failed to update favorite status: ${(e as Error).message}`);
            dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isFavorite: !newIsFavorite }});
        }
    };

    const toggleApproved = async () => {
        const newIsApproved = !trace.isApproved;
        dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isApproved: newIsApproved }});
        try {
            await dbService.updateTrace({ id: trace.id, isApproved: newIsApproved });
        } catch(e) {
            addLog('ERROR', `Failed to update approval status: ${(e as Error).message}`);
            dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isApproved: !newIsApproved }});
        }
    };

    const handleRetrace = async (traceType: 'standard' | 'guided' | 'simple' | 'dynamic') => {
        setRetraceState({ status: 'tracing', type: traceType });
        addLog('INFO', `Re-running '${traceType}' trace for ${trace.candyName} (Side ${trace.side})...`);
    
        try {
            const candyPhoto = await dbService.getFileLocal(trace.candyImageKey);
            if (!candyPhoto) throw new Error("Original candy photo not found.");
    
            let newTrace: UnsavedTrace;
    
            if (traceType === 'standard' || traceType === 'guided') {
                let prompt: string;
                let promptName: string;
                
                if (traceType === 'standard') {
                    prompt = STANDARD_TEST_TRACE_PROMPT;
                    promptName = 'Standard Test Trace';
                } else { // guided
                    const activePrompt = settings.simpleTraceMainPromptHistory.find(p => p.id === settings.activeSimpleTraceMainPromptId);
                    if (activePrompt) {
                        prompt = activePrompt.content;
                        promptName = activePrompt.name;
                    } else {
                        addLog('WARN', 'Could not find active Simple Trace prompt. Falling back to default for Guided Test.');
                        prompt = SIMPLE_TRACE_V2_PROMPT;
                        promptName = 'Simple Trace v2 (Fallback)';
                    }
                }
                
                const startTime = Date.now();
                const result = await geminiService.performAndVerifyTestTrace(
                    candyPhoto,
                    settings.textModel,
                    prompt
                );
                const durationMs = Date.now() - startTime;
                
                const traceImageFile = await dataUrlToFile(result.imageUrl, `${trace.candyName}_${trace.side}_${traceType}_retrace.png`);
                
                newTrace = {
                    id: `retrace-${trace.id}-${traceType}-${Date.now()}`,
                    timestamp: Date.now(),
                    candyName: trace.candyName,
                    side: trace.side,
                    traceImageFile: traceImageFile,
                    candyImageFile: candyPhoto,
                    prompt: prompt,
                    promptName: `Retrace: ${promptName}`,
                    styleRefIds: [],
                    durationMs: durationMs,
                    origin: 'test',
                    testType: traceType,
                    bucket: trace.bucket,
                };
            } else { // 'simple' or 'dynamic'
                let promptTemplate: string;
                let promptName: string;

                if (traceType === 'simple') {
                    const activePrompt = settings.simpleTraceMainPromptHistory.find(p => p.id === settings.activeSimpleTraceMainPromptId);
                    if (!activePrompt) {
                        addLog('WARN', 'Could not find active Simple Trace prompt. Falling back to default.');
                        promptTemplate = SIMPLE_TRACE_V2_PROMPT;
                        promptName = 'Simple Trace v2 (Fallback)';
                    } else {
                        promptTemplate = activePrompt.content;
                        promptName = activePrompt.name;
                    }
                } else { // dynamic
                    const activePrompt = settings.dynamicSimpleTraceMainPromptHistory.find(p => p.id === settings.activeDynamicSimpleTraceMainPromptId);
                     if (!activePrompt) {
                        addLog('WARN', 'Could not find active Dynamic Simple Trace prompt. Falling back to default.');
                        promptTemplate = DYNAMIC_SIMPLE_TRACE_PROMPT;
                        promptName = 'Dynamic Simple Trace (Fallback)';
                    } else {
                        promptTemplate = activePrompt.content;
                        promptName = activePrompt.name;
                    }
                }
    
                let logoText = '';
                if (traceType === 'dynamic') {
                    logoText = suggestLogoTextFromFilename(trace.candyName);
                }
    
                let fullPrompt = generatePrompt(promptTemplate, { logoText });
                if (settings.outputBackground === 'transparent') fullPrompt += `\n\n${TRANSPARENT_BACKGROUND_INSTRUCTION}`;
                else if (settings.forceBlankCanvas) fullPrompt += `\n\n${BLANK_CANVAS_INSTRUCTION}`;
                
                const parts: GeminiTurn['parts'] = [];
                parts.push(await getApiImageParts(candyPhoto).then(({ data, mimeType }) => ({ inlineData: { data, mimeType }})));
                parts.push({ text: fullPrompt });
    
                const startTime = Date.now();
                const result = await geminiService.generateImageFromMultiModal([{ role: 'user', parts }], null);
                if (!result.imageUrl) throw new Error(`Image generation failed. API response: ${result.text || 'No text response'}`);
                
                let processedImageUrl = result.imageUrl;
                if (settings.autoCleanTrace) {
                    processedImageUrl = await cleanImageToOneBit(processedImageUrl, settings.outputBackground, settings.size);
                }
                const durationMs = Date.now() - startTime;
    
                const traceImageFile = await dataUrlToFile(processedImageUrl, `${trace.candyName}_${trace.side}_${traceType}_retrace.png`);
                
                newTrace = {
                    id: `retrace-${trace.id}-${traceType}-${Date.now()}`,
                    timestamp: Date.now(),
                    candyName: trace.candyName,
                    side: trace.side,
                    traceImageFile: traceImageFile,
                    candyImageFile: candyPhoto,
                    prompt: fullPrompt,
                    promptName: `Retrace: ${promptName}`,
                    styleRefIds: [],
                    durationMs: durationMs,
                    origin: 'sandbox',
                    bucket: trace.bucket,
                };
            }
    
            const storedTrace = await dbService.saveTrace(newTrace);
            dispatch({ type: 'ADD_TO_ARCHIVE', payload: storedTrace });
            addLog('SUCCESS', `Successfully re-traced ${trace.candyName} and saved new version to archive.`);
    
        } catch (e) {
            const err = e as Error;
            addLog('ERROR', `Retrace failed: ${err.message}`);
        } finally {
            setRetraceState({ status: 'idle', type: null });
        }
    };

    const retraceButtonClass = "inline-flex items-center justify-center w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:bg-gray-200 disabled:cursor-not-allowed";


    return (
        <div className="space-y-4">
            <div>
                <h3 className="font-semibold mb-2">Generated Trace</h3>
                 <DbFileImagePreview imageKey={trace.traceImageKey} className="w-full rounded-lg bg-gray-100 border" alt="Generated Trace" />
            </div>
            <div>
                <h3 className="font-semibold mb-2">Original Candy Photo</h3>
                <DbFileImagePreview imageKey={trace.candyImageKey} className="w-full rounded-lg bg-gray-100 border" alt="Original Candy" />
            </div>
            <div>
                <h3 className="font-semibold mb-2">Generation Details</h3>
                <div className="bg-gray-50 p-3 rounded-lg border text-sm space-y-1">
                    <p><strong>Timestamp:</strong> {new Date(trace.timestamp).toLocaleString()}</p>
                    <p><strong>Status:</strong> {trace.isApproved ? <span className="font-semibold text-green-600">Approved</span> : 'Pending Review'}</p>
                    {trace.durationMs && <p><strong>Generation Time:</strong> {(trace.durationMs / 1000).toFixed(2)}s</p>}
                    <div className="flex items-center space-x-4 pt-2 flex-wrap gap-y-2">
                        <button onClick={toggleApproved} className={`flex items-center ${trace.isApproved ? 'text-yellow-600 hover:underline' : 'text-green-600 hover:underline'}`}><CheckIcon className="w-4 h-4 mr-1"/> {trace.isApproved ? 'Un-approve' : 'Approve'}</button>
                        <button onClick={toggleFavorite} className="flex items-center text-yellow-500 hover:underline"><StarIcon className="w-4 h-4 mr-1" filled={trace.isFavorite}/> {trace.isFavorite ? 'Unfavorite' : 'Favorite'}</button>
                        <button onClick={() => onOpenEnhance(trace)} className="flex items-center text-purple-600 hover:underline"><SparklesIcon className="w-4 h-4 mr-1"/> Co-pilot Enhance</button>
                        <button onClick={handleDownload} className="flex items-center text-blue-600 hover:underline"><DownloadIcon className="w-4 h-4 mr-1"/> Download</button>
                        <button onClick={handleSendToStyles} className="flex items-center text-purple-600 hover:underline"><LayersIcon className="w-4 h-4 mr-1"/> To Styles</button>
                        <button onClick={() => { if(window.confirm('Delete this specific trace version permanently?')) onDelete() }} className="flex items-center text-red-600 hover:underline"><TrashIcon className="w-4 h-4 mr-1"/> Delete Version</button>
                    </div>
                </div>
            </div>
             <div>
                <h3 className="font-semibold mb-2">Re-run Trace</h3>
                <div className="bg-gray-50 p-3 rounded-lg border text-sm space-y-3">
                    <p className="text-xs text-gray-500">Generate a new version using a different method. The result will be added to this candy's version history.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button onClick={() => handleRetrace('standard')} disabled={retraceState.status === 'tracing'} className={retraceButtonClass}>
                            {retraceState.status === 'tracing' && retraceState.type === 'standard' ? <Spinner className="w-4 h-4 mr-2"/> : null} Standard Test
                        </button>
                        <button onClick={() => handleRetrace('guided')} disabled={retraceState.status === 'tracing'} className={retraceButtonClass}>
                            {retraceState.status === 'tracing' && retraceState.type === 'guided' ? <Spinner className="w-4 h-4 mr-2"/> : null} Guided Test
                        </button>
                        <button onClick={() => handleRetrace('simple')} disabled={retraceState.status === 'tracing'} className={retraceButtonClass}>
                            {retraceState.status === 'tracing' && retraceState.type === 'simple' ? <Spinner className="w-4 h-4 mr-2"/> : null} Simple Trace
                        </button>
                        <button onClick={() => handleRetrace('dynamic')} disabled={retraceState.status === 'tracing'} className={retraceButtonClass}>
                            {retraceState.status === 'tracing' && retraceState.type === 'dynamic' ? <Spinner className="w-4 h-4 mr-2"/> : null} Dynamic Simple Trace
                        </button>
                    </div>
                </div>
            </div>
             <div>
                <h3 className="font-semibold mb-2">Prompts Used</h3>
                <div className="bg-gray-50 p-3 rounded-lg border space-y-3">
                    {trace.promptName && (
                        <div>
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Prompt Name</h4>
                            <p className="text-sm font-semibold mt-1">{trace.promptName}</p>
                        </div>
                    )}
                    {trace.systemInstruction && (
                        <div>
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">System Instruction</h4>
                            <div className="bg-gray-100 p-2 rounded-md border mt-1 max-h-24 overflow-y-auto"><pre className="text-xs font-mono whitespace-pre-wrap break-words">{trace.systemInstruction}</pre></div>
                        </div>
                    )}
                    <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Main Prompt</h4>
                        <div className="bg-gray-100 p-2 rounded-md border mt-1 max-h-48 overflow-y-auto"><pre className="text-xs font-mono whitespace-pre-wrap break-words">{trace.prompt}</pre></div>
                    </div>
                </div>
            </div>
             <div>
                <h3 className="font-semibold mb-2">Style References Used</h3>
                <div className="bg-gray-50 p-3 rounded-lg border space-y-2">
                    {usedStyles.length > 0 ? usedStyles.map(style => (
                        <div key={style.id} className="flex items-center"><DbFileImagePreview imageKey={style.A.traceFile ? style.A.traceFile.name : (style.B.traceFile ? style.B.traceFile.name : '')} className="w-12 h-12 object-contain rounded-md mr-3 bg-white border" alt={style.name} /><p className="font-medium text-sm">{style.name}</p></div>
                    )) : <p className="text-sm text-gray-500">No style references found.</p>}
                </div>
            </div>
        </div>
    );
};


const TraceGroupCard: React.FC<{
    group: TraceGroup;
    isSelected: boolean;
    onSelect: (ids: string[], selected: boolean) => void;
    onViewDetails: (group: TraceGroup) => void;
    onToggleFavorite: (ids: string[], isFavorite: boolean) => void;
}> = ({ group, isSelected, onSelect, onViewDetails, onToggleFavorite }) => {
    
    const allTraceIds = [...(group.sides.A?.versions.map(v => v.id) || []), ...(group.sides.B?.versions.map(v => v.id) || [])];
    const isFavorite = group.isFavorite;
    const isApproved = group.isApproved;

    const latestA = group.sides.A?.versions[0];
    const latestB = group.sides.B?.versions[0];

    const versionCountA = group.sides.A?.versions.length || 0;
    const versionCountB = group.sides.B?.versions.length || 0;

    return (
        <div className="border rounded-lg p-3 group flex flex-col bg-white hover:shadow-lg hover:border-blue-500 transition-all relative">
            <input type="checkbox" checked={isSelected} onChange={(e) => onSelect(allTraceIds, e.target.checked)} onClick={e => e.stopPropagation()} className="absolute top-2 left-2 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 z-20" />
            
            {isApproved && (<div className="absolute top-2 right-2 z-20 p-1 rounded-full bg-green-100 text-green-800" title="Approved"><CheckIcon className="w-4 h-4"/></div>)}

            <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity z-10 pointer-events-none rounded-lg"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center space-x-3 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button onClick={() => onViewDetails(group)} className="bg-white/80 text-gray-900 rounded-lg px-4 py-2 text-sm font-semibold backdrop-blur-sm hover:bg-white">Details</button>
                <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(allTraceIds, !isFavorite); }} className={`p-2.5 rounded-full backdrop-blur-sm ${isFavorite ? 'bg-yellow-400/80 text-white' : 'bg-white/80 text-gray-600'} hover:bg-white`} title={isFavorite ? "Remove from favorites" : "Add to favorites"}>
                    <StarIcon className="w-5 h-5" filled={isFavorite} />
                </button>
            </div>
            
            <div className="w-full h-40 grid grid-cols-2 gap-2 mb-3">
                <div className="bg-gray-100 rounded-md flex items-center justify-center overflow-hidden relative">
                    {latestA ? <DbFileImagePreview imageKey={latestA.traceImageKey} className="w-full h-full object-contain" alt={`${group.candyName} Side A`} /> : <span className="text-gray-400 text-xs">Side A</span>}
                    {versionCountA > 0 && <span className="absolute bottom-1 right-1 bg-black/50 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">A (v{versionCountA})</span>}
                </div>
                 <div className="bg-gray-100 rounded-md flex items-center justify-center overflow-hidden relative">
                    {latestB ? <DbFileImagePreview imageKey={latestB.traceImageKey} className="w-full h-full object-contain" alt={`${group.candyName} Side B`} /> : <span className="text-gray-400 text-xs">Side B</span>}
                    {versionCountB > 0 && <span className="absolute bottom-1 right-1 bg-black/50 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">B (v{versionCountB})</span>}
                </div>
            </div>
            
            <div className="flex-grow">
                 <p className="text-sm font-semibold truncate">{group.candyName}</p>
                 <p className="text-xs text-gray-500 mt-1">{new Date(group.latestTimestamp).toLocaleDateString()}</p>
            </div>
        </div>
    );
};

const ExportDropdown: React.FC<{
    count: number;
    onExport: (mode: 'organized' | 'flat') => void;
    disabled: boolean;
}> = ({ count, onExport, disabled }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [ref]);

    return (
        <div className="relative inline-block text-left" ref={ref}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                disabled={disabled}
                className="inline-flex items-center rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-gray-600 disabled:bg-gray-300 disabled:text-gray-500"
            >
                <DownloadIcon className="w-4 h-4 mr-2"/>
                Download ({count})
                <ChevronDownIcon className="w-4 h-4 ml-2 -mr-1" />
            </button>
            {isOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-20">
                    <div className="py-1">
                        <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); onExport('organized'); setIsOpen(false); }}
                            className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100"
                            title="Traces in separate folders per candy"
                        >
                            <p className="font-medium">Export (Organized)</p>
                            <p className="text-xs text-gray-500">Traces in separate folders per candy</p>
                        </a>
                        <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); onExport('flat'); setIsOpen(false); }}
                            className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100"
                            title="All traces in root without folders"
                        >
                            <p className="font-medium">Export (Flat)</p>
                            <p className="text-xs text-gray-500">All traces in root without folders</p>
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export const TraceArchiveView: React.FC<{
    state: AppState;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ state, dispatch, addLog }) => {
    const { traceArchive, styleSets, settings } = state;
    const [selectedGroup, setSelectedGroup] = React.useState<TraceGroup | null>(null);
    const [lastCleanedTimestamp, setLastCleanedTimestamp] = React.useState<number>(0);
    
    const [activeTab, setActiveTab] = React.useState<'all' | 'work' | 'sandbox' | 'test'>('all');
    const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');
    const [isCleaning, setIsCleaning] = React.useState(false);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);
    
    const [searchTerm, setSearchTerm] = React.useState('');
    const [filterBucket, setFilterBucket] = React.useState<Bucket | 'All'>('All');
    const [filterSide, setFilterSide] = React.useState<'All' | 'A' | 'B'>('All');
    const [filterFavorites, setFilterFavorites] = React.useState<boolean>(false);
    const [filterApproved, setFilterApproved] = React.useState<boolean>(false);
    const [sortBy, setSortBy] = React.useState<'Recent' | 'Oldest' | 'Name' | 'Duration' | 'Favorites'>('Recent');
    const [startDate, setStartDate] = React.useState<string>('');
    const [endDate, setEndDate] = React.useState<string>('');

    const filteredAndSortedGroups = React.useMemo(() => {
        let traces = [...traceArchive];

        if (activeTab !== 'all') {
            traces = traces.filter(t => (t.origin || 'work') === activeTab);
        }
        
        let groups = groupTracesWithVersioning(traces, true);

        if (searchTerm) groups = groups.filter(g => g.candyName.toLowerCase().includes(searchTerm.toLowerCase()));
        if (filterBucket !== 'All') groups = groups.filter(g => g.bucket === filterBucket);
        if (filterSide !== 'All') groups = groups.filter(g => (filterSide === 'A' && g.sides.A) || (filterSide === 'B' && g.sides.B));
        if (filterFavorites) groups = groups.filter(g => g.isFavorite);
        if (filterApproved) groups = groups.filter(g => g.isApproved);
        if (startDate) {
            const startTimestamp = new Date(startDate).getTime();
            groups = groups.filter(g => g.latestTimestamp >= startTimestamp);
        }
        if (endDate) {
            const endTimestamp = new Date(endDate).setHours(23, 59, 59, 999);
            groups = groups.filter(g => g.latestTimestamp <= endTimestamp);
        }

        groups.sort((a, b) => {
            switch (sortBy) {
                case 'Oldest': return a.latestTimestamp - b.latestTimestamp;
                case 'Name': return a.candyName.localeCompare(b.candyName);
                // Duration sort might be less meaningful now, but kept for consistency
                // case 'Duration': return (a.durationMs || 0) - (b.durationMs || 0);
                case 'Favorites': return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || b.latestTimestamp - a.latestTimestamp;
                case 'Recent': default: return b.latestTimestamp - a.latestTimestamp;
            }
        });

        return groups;
    }, [traceArchive, activeTab, searchTerm, filterBucket, filterSide, filterFavorites, filterApproved, sortBy, startDate, endDate]);

    const selectedIds = React.useMemo(() => traceArchive.filter(t => t.selected).map(t => t.id), [traceArchive]);
    const bucketCounts = React.useMemo(() => traceArchive.reduce((acc, trace) => {
            const bucket = trace.bucket || 'Unassigned';
            acc[bucket] = (acc[bucket] || 0) + 1;
            return acc;
        }, {} as Record<Bucket | 'Unassigned', number>), [traceArchive]);

    const handleDelete = (ids: string[]) => {
        Promise.all(ids.map(id => dbService.deleteTrace(id))).then(() => {
            dispatch({ type: 'REMOVE_FROM_ARCHIVE', payload: ids });
            if (selectedGroup && ids.some(id => selectedGroup.sides.A?.versions.some(v => v.id === id) || selectedGroup.sides.B?.versions.some(v => v.id === id))) {
                setSelectedGroup(null);
            }
        }).catch(err => addLog('ERROR', `Failed to delete traces: ${err.message}`));
    };
    
    const handleToggleGroupSelection = (ids: string[], isSelected: boolean) => {
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION', payload: { ids, select: isSelected } });
    };

    const handleSelectAll = (select: boolean) => {
        const idsToUpdate = filteredAndSortedGroups.flatMap(g => [...(g.sides.A?.versions.map(v => v.id) || []), ...(g.sides.B?.versions.map(v => v.id) || [])]);
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION', payload: { ids: idsToUpdate, select } });
    };
    
    const handleToggleFavorite = (ids: string[], isFavorite: boolean) => {
        const tracesToUpdate = traceArchive.filter(t => ids.includes(t.id));
        tracesToUpdate.forEach(trace => {
            dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isFavorite }});
        });
    };

    const handleBulkApprovalUpdate = async (isApproved: boolean) => {
        if (selectedIds.length === 0) return;
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL', payload: { ids: selectedIds, isApproved } });
        try {
            await Promise.all(
                selectedIds.map(id => dbService.updateTrace({ id, isApproved }))
            );
            addLog('SUCCESS', `Successfully updated approval for ${selectedIds.length} trace(s).`);
        } catch (e) {
            addLog('ERROR', `Failed to save approval updates: ${(e as Error).message}`);
            // Revert on failure
            dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL', payload: { ids: selectedIds, isApproved: !isApproved } });
        }
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        if (window.confirm(`Are you sure you want to permanently delete ${selectedIds.length} trace version(s)? This cannot be undone.`)) {
            handleDelete(selectedIds);
        }
    };
    
    const handleDownload = async (mode: 'organized' | 'flat') => {
        if (selectedIds.length === 0) {
            addLog('WARN', 'No traces selected for download.');
            return;
        }
    
        addLog('INFO', `Preparing to download ${selectedIds.length} trace(s) in ${mode} structure...`);
        const zip = new JSZip();
        const selectedTraces = traceArchive.filter(t => selectedIds.includes(t.id));
    
        for (const trace of selectedTraces) {
            const traceFile = await dbService.getFileLocal(trace.traceImageKey);
            if (!traceFile) continue;

            const sanitizedName = trace.candyName.replace(/[/\\?%*:|"<>]/g, '-');
            const fileName = `${sanitizedName}_trace_${trace.side}_${trace.timestamp}.png`;
            
            if (mode === 'organized') {
                const folder = zip.folder(sanitizedName);
                if (!folder) continue;
                folder.file(fileName, traceFile);
            } else { // flat
                zip.file(fileName, traceFile);
            }
        }
        
        const zipFilename = mode === 'flat' 
            ? `TraceArchive_Flat_${Date.now()}.zip` 
            : `TraceArchive_Organized_${Date.now()}.zip`;
            
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, zipFilename);
        addLog('SUCCESS', `Downloading ${selectedIds.length} traces.`);
    };


    const handleCleanSelected = async () => {
        if (selectedIds.length === 0) return;
        setIsCleaning(true);
        addLog('INFO', `Starting 1-bit cleaning for ${selectedIds.length} trace(s)...`);
    
        let successCount = 0;
        for (const traceId of selectedIds) {
            const trace = traceArchive.find(t => t.id === traceId);
            if (!trace) continue;
            try {
                const originalFile = await dbService.getFileLocal(trace.traceImageKey);
                if (!originalFile) throw new Error("Could not find original trace file in DB.");
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(originalFile);
                });
                const cleanedUrl = await cleanImageToOneBit(dataUrl, settings.outputBackground, settings.size);
                const cleanedFile = await dataUrlToFile(cleanedUrl, originalFile.name);
                await dbService.overwriteLocalFile(trace.traceImageKey, cleanedFile);
                successCount++;
            } catch (error) {
                addLog('ERROR', `Failed to clean trace for ${trace.candyName}: ${(error as Error).message}`);
            }
        }
        addLog('SUCCESS', `Successfully cleaned ${successCount} of ${selectedIds.length} traces.`);
        setIsCleaning(false);
        setLastCleanedTimestamp(Date.now());
    };

    return (
        <div className="p-8 max-w-full mx-auto bg-gray-50 h-full flex flex-col">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Trace Archive</h1>
            <p className="text-base text-gray-500 mb-6">A persistent library of all generated trace images and their metadata.</p>
            
            <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg flex flex-col gap-4">
                 <div className="flex items-center gap-4">
                    <input type="search" placeholder="Search by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full sm:w-64 rounded-md border-gray-300 shadow-sm"/>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm"><option>Recent</option><option>Oldest</option><option>Name</option><option>Duration</option><option>Favorites</option></select>
                    <button onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)} className="flex items-center text-sm font-medium text-gray-700 hover:text-blue-600">
                        <ChevronDownIcon className="w-5 h-5 mr-1"/> Filters
                    </button>
                    <div className="flex-grow flex items-center justify-end">
                        <div className="flex items-center rounded-md shadow-sm bg-white border">
                            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-l-md ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><ListBulletIcon className="w-5 h-5"/></button>
                            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><Squares2X2Icon className="w-5 h-5"/></button>
                        </div>
                    </div>
                </div>

                {isFilterPanelOpen && (
                    <div className="border-t pt-3 flex items-center flex-wrap gap-x-6 gap-y-3">
                        <select value={filterBucket} onChange={e => setFilterBucket(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm">
                           <option value="All">All Buckets</option>
                           {BUCKETS.map(b => <option key={b} value={b}>{b} ({bucketCounts[b] || 0})</option>)}
                        </select>
                        <select value={filterSide} onChange={e => setFilterSide(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm"><option value="All">All Sides</option><option>A</option><option>B</option></select>
                        <label className="flex items-center text-sm"><input type="checkbox" checked={filterFavorites} onChange={e => setFilterFavorites(e.target.checked)} className="h-4 w-4 rounded border-gray-300 mr-1.5" /> Favorites</label>
                        <label className="flex items-center text-sm"><input type="checkbox" checked={filterApproved} onChange={e => setFilterApproved(e.target.checked)} className="h-4 w-4 rounded border-gray-300 mr-1.5" /> Approved</label>
                        <div className="flex items-center gap-x-2 border-l border-gray-200 pl-4">
                            <label htmlFor="start-date" className="text-sm font-medium text-gray-700">From:</label>
                            <input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="rounded-md border-gray-300 shadow-sm text-sm" />
                        </div>
                        <div className="flex items-center gap-x-2">
                            <label htmlFor="end-date" className="text-sm font-medium text-gray-700">To:</label>
                            <input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="rounded-md border-gray-300 shadow-sm text-sm" />
                        </div>
                        {(startDate || endDate) && (<button onClick={() => { setStartDate(''); setEndDate(''); }} className="text-sm text-blue-600 hover:underline">Clear Dates</button>)}
                    </div>
                )}
                 
                 <div className="border-t pt-3 flex items-center justify-between gap-x-4">
                    <div className="flex items-center gap-x-2">
                        <button onClick={() => handleSelectAll(true)} className="text-sm font-medium text-blue-600 hover:underline">Select All Visible</button>
                        <button onClick={() => handleSelectAll(false)} className="text-sm font-medium text-blue-600 hover:underline">Deselect All</button>
                    </div>
                     <div className="flex items-center gap-x-2">
                         <span className="text-sm font-medium text-gray-600">{selectedIds.length} selected</span>
                         <button onClick={() => handleBulkApprovalUpdate(true)} disabled={selectedIds.length === 0} className="inline-flex items-center rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-500 disabled:bg-gray-300"><CheckIcon className="w-4 h-4 mr-1"/> Approve</button>
                         <button onClick={() => handleBulkApprovalUpdate(false)} disabled={selectedIds.length === 0} className="inline-flex items-center rounded-md bg-yellow-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-yellow-500 disabled:bg-gray-300"><XIcon className="w-4 h-4 mr-1"/> Un-approve</button>
                         <button onClick={handleCleanSelected} disabled={selectedIds.length === 0 || isCleaning} className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">{isCleaning ? <Spinner className="w-4 h-4 mr-2"/> : <WrenchScrewdriverIcon className="w-4 h-4 mr-2"/>} Clean</button>
                         <ExportDropdown count={selectedIds.length} onExport={handleDownload} disabled={selectedIds.length === 0} />
                        <button onClick={handleDeleteSelected} disabled={selectedIds.length === 0} className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-500 disabled:bg-gray-300"><TrashIcon className="w-4 h-4 mr-2"/> Delete</button>
                     </div>
                </div>
            </div>

            <div className="flex border-b border-gray-200">
                <button onClick={() => setActiveTab('all')} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'all' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>All ({traceArchive.length})</button>
                <button onClick={() => setActiveTab('work')} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'work' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Work Queue</button>
                <button onClick={() => setActiveTab('sandbox')} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'sandbox' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Sandbox</button>
                <button onClick={() => setActiveTab('test')} className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'test' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Tests</button>
            </div>

            {filteredAndSortedGroups.length > 0 ? (
                <div key={lastCleanedTimestamp} className="flex-grow overflow-y-auto pr-4 -mr-4 pt-4">
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                            {filteredAndSortedGroups.map(group => {
                                const allIds = [...(group.sides.A?.versions.map(v => v.id) || []), ...(group.sides.B?.versions.map(v => v.id) || [])];
                                const isSelected = allIds.every(id => selectedIds.includes(id));
                                return <TraceGroupCard key={group.groupKey} group={group} isSelected={isSelected} onSelect={handleToggleGroupSelection} onViewDetails={setSelectedGroup} onToggleFavorite={handleToggleFavorite} />
                            })}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-center text-gray-500 p-4">List view is under construction. Please use Grid view.</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-grow flex flex-col items-center justify-center bg-white border-2 border-dashed rounded-lg text-center p-8 mt-4">
                    <InfoIcon className="w-12 h-12 text-gray-300 mb-4" /><h3 className="text-xl font-semibold text-gray-700">No Traces Found</h3><p className="text-gray-500 mt-2 max-w-md">{traceArchive.length > 0 ? "Your search and filter criteria didn't match any traces." : "Generated traces will appear here."}</p>
                </div>
            )}

            {selectedGroup && (
                <TraceDetailsModal group={selectedGroup} styleSets={styleSets} settings={settings} onClose={() => setSelectedGroup(null)} onDelete={handleDelete} dispatch={dispatch} addLog={addLog} />
            )}
        </div>
    );
};