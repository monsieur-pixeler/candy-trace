import * as React from 'react';
import type { Action, AppState, Bucket, GenHistory, View, WorkPair, WorkSide, StyleSet, ProcessingJob } from '../types';
import { BUCKETS } from '../constants';
import { RefreshIcon, TrashIcon, SendIcon, CogIcon, ChevronDownIcon, ChevronUpIcon, SparklesIcon, PlayIcon, StopIcon, DownloadIcon, CheckBadgeIcon, XIcon, LayersIcon, Spinner } from './icons';
import { StatusIcon, FileImagePreview, ActionBar, ActionBarLabel, ActionBarButton, ActionBarIconButton, ActionBarDropdown, ActionBarDivider } from './common';
import { EnhanceTraceModal } from './EnhanceTraceModal';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import { geminiService } from '../services/geminiService';

const GenHistoryModal: React.FC<{
    history: GenHistory[];
    onClose: () => void;
}> = ({ history, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">Generation History</h2>
                <div className="overflow-y-auto space-y-4">
                    {history.map((gen, index) => (
                        <div key={gen.timestamp} className="p-4 border rounded-lg">
                            <h3 className="font-semibold">Generation {history.length - index} ({new Date(gen.timestamp).toLocaleString()})</h3>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div>
                                    <p className="text-sm font-medium">Result:</p>
                                    <img src={gen.imageUrl} alt={`Generation ${index}`} className="mt-1 rounded-md border w-full"/>
                                </div>
                                <div className="text-xs space-y-2">
                                    <p><strong>Duration:</strong> {(gen.durationMs || 0) / 1000}s</p>
                                    {gen.styleRefName && <p><strong>Style Ref:</strong> {gen.styleRefName}</p>}
                                    <div>
                                        <p><strong>Prompt:</strong></p>
                                        <pre className="mt-1 p-2 bg-gray-100 rounded text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{gen.prompt}</pre>
                                    </div>
                                    {gen.textResponse && (
                                        <div>
                                            <p><strong>Text Response:</strong></p>
                                            <p className="mt-1 p-2 bg-gray-100 rounded text-xs">{gen.textResponse}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )).reverse()}
                </div>
            </div>
        </div>
    );
};

const StylePickerModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    styleSets: StyleSet[];
    assignedIds: string[];
    onAssign: (ids: string[]) => void;
    maxSelection: number;
}> = ({ isOpen, onClose, styleSets, assignedIds, onAssign, maxSelection }) => {
    const [selectedIds, setSelectedIds] = React.useState(new Set(assignedIds));
    const activeStyles = styleSets.filter(s => s.active);

    const handleToggle = (id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                if (newSet.size < maxSelection) {
                    newSet.add(id);
                }
            }
            return newSet;
        });
    };

    const handleConfirm = () => {
        onAssign(Array.from(selectedIds));
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b pb-3 mb-4">
                    <h2 className="text-2xl font-bold">Assign Style References ({selectedIds.size}/{maxSelection})</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XIcon className="w-6 h-6" /></button>
                </div>
                <div className="overflow-y-auto grid grid-cols-2 md:grid-cols-4 gap-4">
                    {activeStyles.map(style => (
                        <div key={style.id} onClick={() => handleToggle(style.id)} className={`p-2 border-2 rounded-lg cursor-pointer ${selectedIds.has(style.id) ? 'border-blue-500' : 'border-transparent hover:border-gray-200'}`}>
                            <FileImagePreview file={style.A.traceFile || style.B.traceFile} alt={style.name} className="w-full h-32 object-contain rounded bg-gray-100" />
                            <p className="text-sm font-medium mt-2 truncate">{style.name}</p>
                        </div>
                    ))}
                </div>
                <div className="mt-6 flex justify-end">
                    <button onClick={handleConfirm} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">Confirm</button>
                </div>
            </div>
        </div>
    );
};

export const WorkView: React.FC<{
    state: AppState;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
    setView: (view: View) => void;
}> = ({ state, dispatch, addLog, setView }) => {
    const { workPairs, settings, processingQueue, isQueueRunning, styleSets } = state;
    const [selectedWorkPairId, setSelectedWorkPairId] = React.useState<string | null>(null);
    const [collapsedBuckets, setCollapsedBuckets] = React.useState<Set<string>>(new Set());
    const [historyModal, setHistoryModal] = React.useState<{ isOpen: boolean, history: GenHistory[] }>({ isOpen: false, history: [] });
    const [enhanceModal, setEnhanceModal] = React.useState<{ isOpen: boolean; workPair: WorkPair | null; side: 'A' | 'B' | null }>({ isOpen: false, workPair: null, side: null });
    const [stylePickerModal, setStylePickerModal] = React.useState<{ isOpen: boolean; side: 'A' | 'B' | null }>({ isOpen: false, side: null });

    const selectedWorkPair = workPairs.find(wp => wp.id === selectedWorkPairId);
    const selectedWorkPairIds = workPairs.filter(wp => wp.selected).map(wp => wp.id);

    const handleExtractText = async (workPairId: string, side: 'A' | 'B') => {
        const workPair = workPairs.find(wp => wp.id === workPairId);
        if (!workPair) return;

        const workSide = workPair[side];
        if (!workSide.originalFile) {
            addLog('WARN', `Cannot extract text for ${workPair.name} (Side ${side}): no original file.`);
            return;
        }

        addLog('INFO', `Manually extracting text for ${workPair.name} (Side ${side})...`);
        dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'extracting', logoExtractionError: undefined } } });

        try {
            const result = await geminiService.extractTextFromImage(workSide.originalFile, settings.textModel);
            const logoText = result.extractedText;
            dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'extracted', logoText } } });
            addLog('INFO', `Extracted text "${logoText}" for ${workPair.name} (Side ${side}).`);
        } catch (e) {
            const err = e as Error;
            dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { logoExtractionStatus: 'error', logoExtractionError: err.message } } });
            addLog('ERROR', `Failed to extract text for ${workPair.name} (Side ${side}): ${err.message}`);
        }
    };

    const toggleBucket = (bucket: string) => {
        setCollapsedBuckets(prev => {
            const newSet = new Set(prev);
            if (newSet.has(bucket)) newSet.delete(bucket); else newSet.add(bucket);
            return newSet;
        });
    };
    
    const handleQueueSelected = (ids: string[]) => {
        const jobs: ProcessingJob[] = ids.flatMap(id => {
            const wp = workPairs.find(p => p.id === id);
            if (!wp) return [];
            const newJobs: ProcessingJob[] = [];
            if (wp.A.originalFile && (wp.A.status === 'idle' || wp.A.status === 'error')) newJobs.push({ workPairId: id, side: 'A' as const });
            if (wp.B.originalFile && (wp.B.status === 'idle' || wp.B.status === 'error')) newJobs.push({ workPairId: id, side: 'B' as const });
            return newJobs;
        });
        
        if (jobs.length > 0) {
            dispatch({ type: 'SET_PROCESSING_QUEUE', payload: [...processingQueue, ...jobs] });
            jobs.forEach(job => dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId: job.workPairId, side: job.side, data: { status: 'queued' } } }));
            addLog('INFO', `Added ${jobs.length} job(s) to the processing queue.`);
        } else {
            addLog('WARN', 'No selected items are ready to be queued (must be Idle or Error).');
        }
    };
    
    const handleTraceSide = (workPairId: string, side: 'A' | 'B') => {
        const wp = workPairs.find(p => p.id === workPairId);
        if (!wp) return;

        const sideData = wp[side];
        if (sideData.originalFile && (sideData.status === 'idle' || sideData.status === 'error' || sideData.status === 'done')) {
            const job: ProcessingJob = { workPairId, side };
            dispatch({ type: 'SET_PROCESSING_QUEUE', payload: [...processingQueue, job] });
            dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { status: 'queued' } } });
            addLog('INFO', `Added 1 job (${wp.name} - Side ${side}) to the processing queue.`);
        } else {
            addLog('WARN', `Could not queue ${wp.name} - Side ${side}. Status is not Idle, Error, or Done.`);
        }
    };

    const handleUpdateTrace = (workPairId: string, side: 'A' | 'B', newImageUrl: string, fullPrompt: string) => {
        const workPair = workPairs.find(wp => wp.id === workPairId);
        if (!workPair) return;

        const oldHistory = workPair[side].gens;
        const newHistoryEntry: GenHistory = {
            timestamp: Date.now(),
            stage: 'single', // or a new stage for enhancement
            imageUrl: newImageUrl,
            prompt: fullPrompt,
            durationMs: oldHistory[oldHistory.length - 1]?.durationMs, // carry over
        };

        dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId, side, data: { pngUrl: newImageUrl, gens: [...oldHistory, newHistoryEntry] } } });
        addLog('SUCCESS', `Trace for ${workPair.name} (Side ${side}) updated from Co-pilot.`);
        setEnhanceModal({ isOpen: false, workPair: null, side: null });
    };

    const handleExportCompleted = async (mode: 'organized' | 'flat') => {
        const workPairsToExport = workPairs.filter(wp => selectedWorkPairIds.includes(wp.id) && (wp.A.status === 'done' || wp.B.status === 'done'));

        if (workPairsToExport.length === 0) {
            addLog('WARN', 'No completed work pairs selected for export.');
            return;
        }

        const zip = new JSZip();
        addLog('INFO', `Packaging ${workPairsToExport.length} completed work pair(s) for download.`);

        for (const wp of workPairsToExport) {
            const sanitizedName = wp.name.replace(/[/\\?%*:|"<>]/g, '-');
            const target = mode === 'organized' ? zip.folder(sanitizedName) : zip;

            if (!target) continue;
            
            if (wp.A.status === 'done' && wp.A.pngUrl) {
                const response = await fetch(wp.A.pngUrl);
                const blob = await response.blob();
                target.file(`${sanitizedName}_side_A.png`, blob);
            }
            if (wp.B.status === 'done' && wp.B.pngUrl) {
                const response = await fetch(wp.B.pngUrl);
                const blob = await response.blob();
                target.file(`${sanitizedName}_side_B.png`, blob);
            }
        }
        
        const zipFilename = mode === 'flat' 
            ? `WorkQueue_Completed_Flat_${Date.now()}.zip` 
            : `WorkQueue_Completed_${Date.now()}.zip`;
        
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, zipFilename);
        addLog('SUCCESS', `Downloaded ${workPairsToExport.length} completed work pair(s) as ${mode === 'organized' ? 'organized in folders' : 'a flat structure'}.`);
    };

    const handleAssignStyles = (ids: string[]) => {
        if (!selectedWorkPair || !stylePickerModal.side) return;
        dispatch({ type: 'UPDATE_WORK_SIDE', payload: { workPairId: selectedWorkPair.id, side: stylePickerModal.side, data: { styleRefIds: ids } }});
    };

    const completedSelectedCount = selectedWorkPairIds.filter(id => {
        const wp = workPairs.find(p => p.id === id);
        return wp && (wp.A.status === 'done' || wp.B.status === 'done');
    }).length;
    
    const sideButtonBase = "inline-flex items-center justify-center w-full rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:bg-gray-300";

    const bucketOptions = BUCKETS.map(b => ({ label: b, value: b }));
    const exportOptions = [
        { label: 'Export (Organized)', value: 'organized', description: 'Traces in folders per candy' },
        { label: 'Export (Flat)', value: 'flat', description: 'All traces in root folder' }
    ];

    return (
        <div className="flex h-full bg-gray-50">
            <div className="w-[40%] p-4 border-r border-gray-200 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold">Work Queue</h1>
                    {isQueueRunning ? (
                        <ActionBarButton variant="destructive" onClick={() => dispatch({ type: 'STOP_QUEUE' })} icon={StopIcon}>
                            Stop Queue ({processingQueue.length})
                        </ActionBarButton>
                    ) : (
                        <ActionBarButton
                            variant="primary"
                            onClick={() => dispatch({ type: 'START_QUEUE' })}
                            disabled={processingQueue.length === 0}
                            icon={PlayIcon}
                        >
                            Start Queue
                        </ActionBarButton>
                    )}
                </div>
                {processingQueue.length > 0 && <div className="mb-4 text-center text-sm text-blue-600"><CogIcon className="w-4 h-4 mr-2 inline animate-spin"/>Processing... ({processingQueue.length} job(s) left)</div>}

                <ActionBar>
                    <ActionBarLabel>{selectedWorkPairIds.length} of {workPairs.length} selected</ActionBarLabel>
                    <ActionBarButton variant="text" onClick={() => dispatch({ type: 'SET_WORK_PAIRS', payload: workPairs.map(wp => ({ ...wp, selected: false })) })} disabled={selectedWorkPairIds.length === 0}>Deselect All</ActionBarButton>
                    <ActionBarDropdown
                        label="Assign to Bucket"
                        options={bucketOptions}
                        onSelect={(bucket) => dispatch({ type: 'BULK_UPDATE_WORK_SIDES_BUCKET', payload: { workPairIds: selectedWorkPairIds, bucket: bucket as Bucket } })}
                        disabled={selectedWorkPairIds.length === 0}
                    />
                    <ActionBarIconButton icon={TrashIcon} label="Delete Selected" variant="destructive" onClick={() => selectedWorkPairIds.forEach(id => dispatch({ type: 'REMOVE_WORK_PAIR', payload: id }))} disabled={selectedWorkPairIds.length === 0} />
                    <ActionBarDivider />
                    <ActionBarButton icon={LayersIcon} onClick={() => dispatch({ type: 'BULK_AUTO_MATCH_STYLES', payload: { workPairIds: selectedWorkPairIds }})} disabled={selectedWorkPairIds.length === 0}>Auto-match Styles</ActionBarButton>
                    <ActionBarButton icon={RefreshIcon} onClick={() => dispatch({ type: 'BULK_RETRACE_WORK_PAIRS', payload: { ids: selectedWorkPairIds } })} disabled={selectedWorkPairIds.length === 0}>Retrace</ActionBarButton>
                    <ActionBarDropdown
                        label={`Export Completed (${completedSelectedCount})`}
                        options={exportOptions}
                        onSelect={(mode) => handleExportCompleted(mode as 'organized' | 'flat')}
                        disabled={completedSelectedCount === 0}
                    />
                    <ActionBarButton icon={CheckBadgeIcon} onClick={() => dispatch({ type: 'BULK_APPROVE_WORK_ITEMS', payload: { workPairIds: selectedWorkPairIds }})} disabled={completedSelectedCount === 0}>Approve</ActionBarButton>
                    <ActionBarButton icon={SendIcon} variant="primary" onClick={() => handleQueueSelected(selectedWorkPairIds)} disabled={selectedWorkPairIds.length === 0}>Queue</ActionBarButton>
                </ActionBar>

                <div className="flex-grow overflow-y-auto pr-2 mt-4">
                    {BUCKETS.map(bucket => {
                        const pairsInBucket = workPairs.filter(wp => wp.A.bucket === bucket);
                        if (pairsInBucket.length === 0) return null;
                        
                        const isCollapsed = collapsedBuckets.has(bucket);
                        const allSelectedInBucket = pairsInBucket.every(p => p.selected);

                        return (
                            <div key={bucket}>
                                <div className="flex items-center justify-between my-2 sticky top-0 bg-gray-50 py-1">
                                    <div className="flex items-center"><input type="checkbox" checked={allSelectedInBucket} onChange={() => dispatch({ type: 'BULK_SELECT_WORK_PAIRS_IN_BUCKET', payload: { bucket, select: !allSelectedInBucket } })} className="h-4 w-4 rounded border-gray-300 mr-2"/><h3 className="text-lg font-semibold">{bucket} ({pairsInBucket.length})</h3></div>
                                    <button onClick={() => toggleBucket(bucket)}>{isCollapsed ? <ChevronDownIcon className="w-5 h-5"/> : <ChevronUpIcon className="w-5 h-5"/>}</button>
                                </div>
                                {!isCollapsed && pairsInBucket.map(wp => (
                                    <div key={wp.id} onClick={() => setSelectedWorkPairId(wp.id)} className={`flex items-center p-2 rounded-md cursor-pointer mb-1 ${selectedWorkPairId === wp.id ? 'bg-blue-100' : 'hover:bg-gray-100'}`}>
                                        <input type="checkbox" checked={wp.selected} onChange={e => dispatch({ type: 'UPDATE_WORK_PAIR', payload: { id: wp.id, selected: e.target.checked } })} onClick={e => e.stopPropagation()} className="mr-3 h-4 w-4 rounded border-gray-300"/>
                                        <FileImagePreview file={wp.A.originalFile || wp.B.originalFile} className="w-12 h-12 object-cover rounded-md mr-3 bg-white" alt={wp.name}/>
                                        <p className="flex-grow font-medium">{wp.name}</p>
                                        <div className="flex items-center space-x-2"><StatusIcon status={wp.A.status} error={wp.A.error}/><StatusIcon status={wp.B.status} error={wp.B.error}/></div>
                                    </div>
                                ))}
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="w-[60%] p-6 bg-white overflow-y-auto">
                {selectedWorkPair ? (
                    <div className="space-y-6">
                        <h2 className="text-3xl font-bold">{selectedWorkPair.name}</h2>
                        <div className="p-3 bg-gray-50 rounded-lg border text-sm"><p><strong>Bucket:</strong> {selectedWorkPair.A.bucket}</p></div>
                        <div className="grid grid-cols-2 gap-6">
                            {(['A', 'B'] as const).map(s => {
                                const sideData = selectedWorkPair[s];
                                const assignedStyles = (sideData.styleRefIds || []).map(id => styleSets.find(ss => ss.id === id)).filter(Boolean) as StyleSet[];
                                const isDynamicTrace = (sideData.promptSetOverride || settings.activePromptSet) === 'dynamicSimpleTrace';
                                return (
                                <div key={s} className="space-y-4 p-4 border rounded-lg bg-gray-50/50">
                                    <h3 className="text-xl font-semibold border-b pb-2">Side {s}</h3>
                                    <div><p className="font-medium text-sm mb-2">Original Photo</p><FileImagePreview file={sideData.originalFile} className="rounded-lg w-full" alt={`Side ${s} Photo`}/></div>
                                    <div><p className="font-medium text-sm mb-2">Generated Trace</p><div className="w-full aspect-square bg-white rounded-lg flex items-center justify-center p-2 border">{sideData.pngUrl ? <img src={sideData.pngUrl} className="max-w-full max-h-full object-contain" alt={`Side ${s} Trace`}/> : <p className="text-gray-500 text-sm">Not generated</p>}</div></div>
                                    <div><p className="font-medium text-sm mb-2">Assigned Styles ({assignedStyles.length}/{settings.directTraceReferenceCount})</p><div className="p-2 bg-white border rounded-md space-y-1">{assignedStyles.length > 0 ? assignedStyles.map(st => <p key={st.id} className="text-xs">{st.name}</p>) : <p className="text-xs text-gray-500">None</p>}<button onClick={() => setStylePickerModal({ isOpen: true, side: s})} className="text-xs text-blue-600 hover:underline mt-1">Manage Styles</button></div></div>
                                    <div>
                                        <label htmlFor={`prompt-set-${s}`} className="font-medium text-sm mb-2 block">Prompt Set</label>
                                        <select
                                            id={`prompt-set-${s}`}
                                            value={sideData.promptSetOverride || 'default'}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                dispatch({
                                                    type: 'UPDATE_WORK_SIDE',
                                                    payload: {
                                                        workPairId: selectedWorkPair.id,
                                                        side: s,
                                                        data: {
                                                            promptSetOverride: value === 'default' ? undefined : (value as 'simpleTrace' | 'dynamicSimpleTrace')
                                                        }
                                                    }
                                                });
                                            }}
                                            className="w-full rounded-md border-gray-300 shadow-sm text-sm"
                                        >
                                            <option value="default">Default ({settings.activePromptSet === 'simpleTrace' ? 'Simple Trace' : 'Dynamic Trace'})</option>
                                            <option value="simpleTrace">Simple Trace</option>
                                            <option value="dynamicSimpleTrace">Dynamic Trace</option>
                                        </select>
                                    </div>
                                     {isDynamicTrace && (
                                        <div>
                                            <label htmlFor={`logo-text-${s}`} className="font-medium text-sm mb-2 block">Logo Text</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    id={`logo-text-${s}`}
                                                    value={sideData.logoText || ''}
                                                    onChange={(e) => dispatch({
                                                        type: 'UPDATE_WORK_SIDE',
                                                        payload: {
                                                            workPairId: selectedWorkPair.id,
                                                            side: s,
                                                            data: { logoText: e.target.value }
                                                        }
                                                    })}
                                                    className="w-full rounded-md border-gray-300 shadow-sm text-sm"
                                                    placeholder="Manually enter text/logo..."
                                                />
                                                <button
                                                    onClick={() => handleExtractText(selectedWorkPair.id, s)}
                                                    disabled={sideData.logoExtractionStatus === 'extracting'}
                                                    className="p-2 rounded-md bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50"
                                                    title="Run Automatic Text Extraction (OCR)"
                                                >
                                                    {sideData.logoExtractionStatus === 'extracting' ? <Spinner className="w-5 h-5"/> : <RefreshIcon className="w-5 h-5"/>}
                                                </button>
                                            </div>
                                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                                <span>OCR Status: {sideData.logoExtractionStatus}</span>
                                                <StatusIcon status={sideData.logoExtractionStatus} error={sideData.logoExtractionError} />
                                            </div>
                                            {sideData.logoExtractionError && <p className="text-xs text-red-500 mt-1">{sideData.logoExtractionError}</p>}
                                        </div>
                                    )}
                                    <div className="p-3 bg-white rounded-lg border text-sm space-y-2">
                                        <div className="flex justify-between items-center"><p><strong>Status:</strong> <span className="capitalize font-semibold">{sideData.status}</span></p><StatusIcon status={sideData.status} error={sideData.error} /></div>
                                        {sideData.error && <p className="text-red-600"><strong>Error:</strong> {sideData.error}</p>}
                                        <div className="flex flex-col gap-2 pt-2 border-t">
                                            <button onClick={() => handleTraceSide(selectedWorkPair.id, s)} disabled={['queued', 'processing', 'processing_stage1', 'processing_stage2'].includes(sideData.status)} className={`${sideButtonBase} bg-blue-600 hover:bg-blue-500`}><SendIcon className="w-4 h-4 mr-2"/> {sideData.status === 'done' ? 'Retrace This Side' : 'Trace This Side'}</button>
                                            <button onClick={() => { if(sideData.pngUrl) saveAs(sideData.pngUrl, `${selectedWorkPair.name}_${s}.png`)}} disabled={sideData.status !== 'done'} className={`${sideButtonBase} bg-gray-700 hover:bg-gray-600`}><DownloadIcon className="w-4 h-4 mr-2"/> Download Trace</button>
                                            <button onClick={() => dispatch({type: 'BULK_APPROVE_WORK_ITEMS', payload: {workPairIds: [selectedWorkPair.id]}})} disabled={sideData.status !== 'done'} className={`${sideButtonBase} bg-green-600 hover:bg-green-500`}><CheckBadgeIcon className="w-4 h-4 mr-2"/> Approve</button>
                                            <button onClick={() => setEnhanceModal({isOpen: true, workPair: selectedWorkPair, side: s})} disabled={sideData.status !== 'done'} className={`${sideButtonBase} bg-purple-600 hover:bg-purple-500`}><SparklesIcon className="w-4 h-4 mr-2"/> Co-pilot Enhance</button>
                                            <button onClick={() => setHistoryModal({ isOpen: true, history: sideData.gens })} disabled={sideData.gens.length === 0} className="text-sm text-blue-600 hover:underline">View History ({sideData.gens.length})</button>
                                        </div>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-500"><p>Select an item from the queue to see details.</p></div>
                )}
            </div>
            {historyModal.isOpen && <GenHistoryModal history={historyModal.history} onClose={() => setHistoryModal({ isOpen: false, history: [] })} />}
            {enhanceModal.isOpen && enhanceModal.workPair && enhanceModal.side && (() => {
                const workSide = enhanceModal.workPair[enhanceModal.side!];
                if (!workSide.originalFile || !workSide.pngUrl) return null;
                return (
                    <EnhanceTraceModal
                        candyName={enhanceModal.workPair.name}
                        side={enhanceModal.side!}
                        originalPhoto={workSide.originalFile}
                        initialTraceUrl={workSide.pngUrl}
                        originalPrompt={workSide.gens[workSide.gens.length - 1]?.prompt || 'No prompt found.'}
                        settings={settings}
                        onClose={() => setEnhanceModal({ isOpen: false, workPair: null, side: null })}
                        // Fix: The `onUpdateTrace` prop from EnhanceTraceModal provides 2 arguments, but `handleUpdateTrace` expects 4.
                        // This inline function captures the necessary context (workPairId, side) from the modal state to call `handleUpdateTrace` correctly.
                        onUpdateTrace={(newImageUrl, fullPrompt) => {
                            if (enhanceModal.workPair && enhanceModal.side) {
                                handleUpdateTrace(enhanceModal.workPair.id, enhanceModal.side, newImageUrl, fullPrompt);
                            }
                        }}
                        addLog={addLog}
                    />
                );
            })()}
            {stylePickerModal.isOpen && selectedWorkPair && stylePickerModal.side && (
                <StylePickerModal isOpen={true} onClose={() => setStylePickerModal({ isOpen: false, side: null})} styleSets={styleSets} assignedIds={selectedWorkPair[stylePickerModal.side].styleRefIds || []} onAssign={handleAssignStyles} maxSelection={settings.directTraceReferenceCount}/>
            )}
        </div>
    );
};
