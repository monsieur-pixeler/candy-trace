import * as React from 'react';
import saveAs from 'file-saver';
import JSZip from 'jszip';
// Fix: Added TraceSideVersions to the type import to resolve the 'Cannot find name' error.
import type { Action, AppState, StoredTrace, StyleSet, Bucket, TraceGroup, TraceSideVersions } from '../types';
import { dbService } from '../services/dbService';
import { TrashIcon, DownloadIcon, XIcon, InfoIcon, StarIcon, ListBulletIcon, Squares2X2Icon, CheckIcon, ChevronDownIcon } from './icons';
import { FileImagePreview, DbFileImagePreview } from './common';
import { BUCKETS } from '../constants';
import { groupTracesWithVersioning } from '../utils/textUtils';

const TraceDetailsModal: React.FC<{
    group: TraceGroup;
    styleSets: StyleSet[];
    onClose: () => void;
    onDelete: (ids: string[]) => void;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ group, styleSets, onClose, onDelete, dispatch, addLog }) => {
    
    const [activeVersionA, setActiveVersionA] = React.useState(0);
    const [activeVersionB, setActiveVersionB] = React.useState(0);

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
                        <div className="flex items-center space-x-1">
                            {sideVersions.versions.map((v, index) => (
                                <button
                                    key={v.id}
                                    onClick={() => setActiveIndex(index)}
                                    className={`px-3 py-1 text-xs font-semibold rounded-full ${activeIndex === index ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                >
                                    v{sideVersions.versions.length - index}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {selectedTrace && <SideDetail trace={selectedTrace} styleSets={styleSets} onDelete={() => onDelete([selectedTrace.id])} dispatch={dispatch} addLog={addLog} />}
            </div>
        );
    }

    return (
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
    );
};

const SideDetail: React.FC<{
    trace: StoredTrace;
    styleSets: StyleSet[];
    onDelete: () => void;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ trace, styleSets, onDelete, dispatch, addLog }) => {

    const traceImageFile = React.useMemo(() => dbService.getFileLocal(trace.traceImageKey), [trace.traceImageKey]);
    const candyImageFile = React.useMemo(() => dbService.getFileLocal(trace.candyImageKey), [trace.candyImageKey]);

    const usedStyles = React.useMemo(() => trace.styleRefIds.map(id => styleSets.find(s => s.id === id)).filter((s): s is StyleSet => !!s), [trace.styleRefIds, styleSets]);

    const handleDownload = async () => { const file = await traceImageFile; if (file) saveAs(file, `${trace.candyName}_Side_${trace.side}_trace_${trace.timestamp}.png`); };
    
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
        dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isApproved: newIsApproved } });
        try {
            await dbService.updateTrace({ id: trace.id, isApproved: newIsApproved });
        } catch (e) {
            addLog('ERROR', `Failed to save approval status: ${(e as Error).message}`);
            dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id: trace.id, isApproved: !newIsApproved }});
        }
    };

    return (
        <div className="space-y-4">
            <div><h3 className="font-semibold mb-2">Approved Trace</h3><DbFileImagePreview imageKey={trace.traceImageKey} className="w-full rounded-lg bg-gray-100 border" alt="Generated Trace" /></div>
            <div><h3 className="font-semibold mb-2">Original Photo</h3><DbFileImagePreview imageKey={trace.candyImageKey} className="w-full rounded-lg bg-gray-100 border" alt="Original Candy" /></div>
            <div><h3 className="font-semibold mb-2">Details</h3><div className="bg-gray-50 p-3 rounded-lg border text-sm space-y-2"><p><strong>Status:</strong> <span className="font-semibold text-green-600">Approved</span></p><div className="flex items-center space-x-4 pt-2 flex-wrap gap-y-2"><button onClick={toggleApproved} className="inline-flex items-center rounded-md bg-yellow-100 px-3 py-2 text-sm font-semibold text-yellow-800 shadow-sm hover:bg-yellow-200"><CheckIcon className="w-4 h-4 mr-1"/> Un-approve</button><button onClick={toggleFavorite} className="inline-flex items-center rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-200"><StarIcon className="w-4 h-4 mr-1" filled={trace.isFavorite}/> {trace.isFavorite ? 'Unfavorite' : 'Favorite'}</button><button onClick={handleDownload} className="inline-flex items-center rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-200"><DownloadIcon className="w-4 h-4 mr-1"/> Download</button><button onClick={() => { if(window.confirm('Delete trace?')) onDelete() }} className="inline-flex items-center rounded-md bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 shadow-sm hover:bg-red-200"><TrashIcon className="w-4 h-4 mr-1"/> Delete</button></div></div></div>
            <div><h3 className="font-semibold mb-2">Style References</h3><div className="bg-gray-50 p-3 rounded-lg border space-y-2">{usedStyles.length > 0 ? usedStyles.map(style => (<div key={style.id} className="flex items-center"><DbFileImagePreview imageKey={style.A.traceFile?.name || style.B.traceFile?.name || ''} className="w-12 h-12 object-contain rounded-md mr-3 bg-white border" alt={style.name} /><p className="font-medium text-sm">{style.name}</p></div>)) : <p className="text-sm text-gray-500">No style references.</p>}</div></div>
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
    const latestA = group.sides.A?.versions[0];
    const latestB = group.sides.B?.versions[0];

    return (
        <div className="border rounded-lg p-3 group flex flex-col bg-white hover:shadow-lg hover:border-blue-500 transition-all relative">
            <input type="checkbox" checked={isSelected} onChange={(e) => onSelect(allTraceIds, e.target.checked)} onClick={e => e.stopPropagation()} className="absolute top-2 left-2 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 z-20" />
            <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity z-10 pointer-events-none rounded-lg"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center space-x-3 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button onClick={() => onViewDetails(group)} className="bg-white/80 text-gray-900 rounded-lg px-4 py-2 text-sm font-semibold backdrop-blur-sm hover:bg-white">Details</button>
                <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(allTraceIds, !isFavorite); }} className={`p-2.5 rounded-full backdrop-blur-sm ${isFavorite ? 'bg-yellow-400/80 text-white' : 'bg-white/80 text-gray-600'} hover:bg-white`} title={isFavorite ? "Unfavorite" : "Favorite"}>
                    <StarIcon className="w-5 h-5" filled={isFavorite} />
                </button>
            </div>
            <div className="w-full h-40 grid grid-cols-2 gap-2 mb-3">
                <div className="bg-gray-100 rounded-md flex items-center justify-center overflow-hidden">{latestA ? <DbFileImagePreview imageKey={latestA.traceImageKey} className="w-full h-full object-contain" alt={`${group.candyName} Side A`} /> : <span className="text-gray-400 text-xs">Side A</span>}</div>
                <div className="bg-gray-100 rounded-md flex items-center justify-center overflow-hidden">{latestB ? <DbFileImagePreview imageKey={latestB.traceImageKey} className="w-full h-full object-contain" alt={`${group.candyName} Side B`} /> : <span className="text-gray-400 text-xs">Side B</span>}</div>
            </div>
            <div className="flex-grow"><p className="text-sm font-semibold truncate">{group.candyName}</p><p className="text-xs text-gray-500 mt-1">{new Date(group.latestTimestamp).toLocaleDateString()}</p></div>
        </div>
    );
};

const ExportDropdown: React.FC<{
    count: number;
    onExport: (mode: 'organized' | 'flat' | 'organized_meta') => void;
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
                        <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); onExport('organized_meta'); setIsOpen(false); }}
                            className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100"
                            title="Traces and metadata in separate folders per candy"
                        >
                            <p className="font-medium">Export (Organized + Metadata)</p>
                            <p className="text-xs text-gray-500">Traces and metadata in separate folders per candy</p>
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export const ApprovedLibraryView: React.FC<{
    state: AppState;
    dispatch: React.Dispatch<Action>;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ state, dispatch, addLog }) => {
    const { traceArchive, styleSets } = state;
    const [selectedGroup, setSelectedGroup] = React.useState<TraceGroup | null>(null);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);
    
    const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');
    const [searchTerm, setSearchTerm] = React.useState('');
    const [filterBucket, setFilterBucket] = React.useState<Bucket | 'All'>('All');
    const [filterFavorites, setFilterFavorites] = React.useState<boolean>(false);
    const [sortBy, setSortBy] = React.useState<'Recent' | 'Oldest' | 'Name' | 'Favorites'>('Recent');

    const approvedTraces = React.useMemo(() => traceArchive.filter(t => t.isApproved), [traceArchive]);
    
     const bucketCounts = React.useMemo(() => {
        return approvedTraces.reduce((acc, trace) => {
            const bucket = trace.bucket || 'Unassigned';
            acc[bucket] = (acc[bucket] || 0) + 1;
            return acc;
        }, {} as Record<Bucket | 'Unassigned', number>);
    }, [approvedTraces]);

    const filteredAndSortedGroups = React.useMemo(() => {
        let groups = groupTracesWithVersioning(approvedTraces);
        if (searchTerm) groups = groups.filter(g => g.candyName.toLowerCase().includes(searchTerm.toLowerCase()));
        if (filterBucket !== 'All') groups = groups.filter(g => g.bucket === filterBucket);
        if (filterFavorites) groups = groups.filter(g => g.isFavorite);
        groups.sort((a, b) => {
            switch (sortBy) {
                case 'Oldest': return a.latestTimestamp - b.latestTimestamp;
                case 'Name': return a.candyName.localeCompare(b.candyName);
                case 'Favorites': return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || b.latestTimestamp - a.latestTimestamp;
                case 'Recent': default: return b.latestTimestamp - a.latestTimestamp;
            }
        });
        return groups;
    }, [approvedTraces, searchTerm, filterBucket, filterFavorites, sortBy]);

    const selectedIds = React.useMemo(() => approvedTraces.filter(t => t.selected).map(t => t.id), [approvedTraces]);

    const handleDelete = (ids: string[]) => {
        Promise.all(ids.map(id => dbService.deleteTrace(id))).then(() => {
            dispatch({ type: 'REMOVE_FROM_ARCHIVE', payload: ids });
            if (selectedGroup && ids.some(id => selectedGroup.sides.A?.versions.some(v => v.id === id) || selectedGroup.sides.B?.versions.some(v => v.id === id))) {
                setSelectedGroup(null);
            }
        }).catch(err => addLog('ERROR', `Failed to delete traces: ${err.message}`));
    };
    
    const handleToggleGroupSelection = (ids: string[], isSelected: boolean) => {
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION', payload: { ids, select: isSelected }});
    };

    const handleSelectAll = (select: boolean) => {
        const idsToUpdate = filteredAndSortedGroups.flatMap(g => [...(g.sides.A?.versions.map(v => v.id) || []), ...(g.sides.B?.versions.map(v => v.id) || [])]);
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_SELECTION', payload: { ids: idsToUpdate, select } });
    };
    
    const handleToggleFavorite = (ids: string[], isFavorite: boolean) => {
        ids.forEach(id => dispatch({ type: 'UPDATE_ARCHIVE_ITEM', payload: { id, isFavorite }}));
    };

    const handleBulkUnapprove = async () => {
        if (selectedIds.length === 0) return;
        dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL', payload: { ids: selectedIds, isApproved: false } });
        try {
            await Promise.all(
                selectedIds.map(id => dbService.updateTrace({ id, isApproved: false }))
            );
            addLog('SUCCESS', `Un-approved ${selectedIds.length} trace(s). They have been returned to the main archive.`);
        } catch (e) {
            addLog('ERROR', `Failed to save un-approval updates: ${(e as Error).message}`);
            // Revert
            dispatch({ type: 'BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL', payload: { ids: selectedIds, isApproved: true } });
        }
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        if (window.confirm(`Delete ${selectedIds.length} trace(s)?`)) handleDelete(selectedIds);
    };
    
    const handleStartDownload = async (mode: 'organized' | 'flat' | 'organized_meta') => {
        const selectedTraces = approvedTraces.filter(t => selectedIds.includes(t.id));

        if (selectedTraces.length === 0) {
            addLog('WARN', 'No approved traces selected for download.');
            return;
        }
    
        // Group selected traces and find the latest for each candy/side combination
        const latestTracesMap = new Map<string, StoredTrace>();
        for (const trace of selectedTraces) {
            const key = `${trace.candyName}-${trace.side}`;
            const existing = latestTracesMap.get(key);
            if (!existing || trace.timestamp > existing.timestamp) {
                latestTracesMap.set(key, trace);
            }
        }
        const tracesToDownload = Array.from(latestTracesMap.values());

        addLog('INFO', `Preparing to download ${tracesToDownload.length} approved trace(s) in ${mode} structure...`);
        const zip = new JSZip();
    
        for (const trace of tracesToDownload) {
            const traceFile = await dbService.getFileLocal(trace.traceImageKey);
            if (!traceFile) continue;

            const sanitizedName = trace.candyName.replace(/[/\\?%*:|"<>]/g, '-');
            const fileName = `${sanitizedName}_trace_${trace.side}.png`;
            
            let target: JSZip | null = zip;
            if (mode === 'organized' || mode === 'organized_meta') {
                target = zip.folder(sanitizedName);
            }
            if (!target) continue;

            target.file(fileName, traceFile);

            if (mode === 'organized_meta') {
                const metadata = {
                    candyName: trace.candyName,
                    side: trace.side,
                    timestamp: trace.timestamp,
                    promptName: trace.promptName,
                    systemInstruction: trace.systemInstruction,
                    prompt: trace.prompt,
                    styleRefIds: trace.styleRefIds,
                    durationMs: trace.durationMs,
                    origin: trace.origin,
                    bucket: trace.bucket,
                };
                const metadataFileName = `${sanitizedName}_trace_${trace.side}_metadata.json`;
                target.file(metadataFileName, JSON.stringify(metadata, null, 2));
            }
        }
    
        const zipFilename =
            mode === 'flat' ? `ApprovedLibrary_Flat_${Date.now()}.zip`
          : mode === 'organized' ? `ApprovedLibrary_Organized_${Date.now()}.zip`
          : `ApprovedLibrary_WithMetadata_${Date.now()}.zip`;
            
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, zipFilename);
        addLog('SUCCESS', `Downloading ${tracesToDownload.length} traces.`);
    };

    return (
        <div className="p-8 max-w-full mx-auto bg-gray-50 h-full flex flex-col">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Approved Library</h1>
            <p className="text-base text-gray-500 mb-6">A curated collection of all traces marked as final and production-ready.</p>
            
            <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg flex flex-col gap-4">
                 <div className="flex items-center gap-4">
                    <input type="search" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full sm:w-64 rounded-md border-gray-300 shadow-sm"/>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm"><option>Recent</option><option>Oldest</option><option>Name</option><option>Favorites</option></select>
                    <button onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)} className="flex items-center text-sm font-medium text-gray-700 hover:text-blue-600"><ChevronDownIcon className="w-5 h-5 mr-1"/> Filters</button>
                    <div className="flex-grow flex items-center justify-end"><div className="flex items-center rounded-md shadow-sm bg-white border"><button onClick={() => setViewMode('list')} className={`p-1.5 rounded-l-md ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><ListBulletIcon className="w-5 h-5"/></button><button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><Squares2X2Icon className="w-5 h-5"/></button></div></div>
                </div>

                {isFilterPanelOpen && (<div className="border-t pt-3 flex items-center gap-4"><select value={filterBucket} onChange={e => setFilterBucket(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm"><option value="All">All Buckets</option>{BUCKETS.map(b => <option key={b} value={b}>{b} ({bucketCounts[b] || 0})</option>)}</select><label className="flex items-center text-sm"><input type="checkbox" checked={filterFavorites} onChange={e => setFilterFavorites(e.target.checked)} className="h-4 w-4 rounded border-gray-300 mr-1.5" /> Favorites</label></div>)}
                 
                 <div className="border-t pt-3 flex items-center justify-between gap-x-4">
                    <div className="flex items-center gap-x-2"><button onClick={() => handleSelectAll(true)} className="text-sm font-medium text-blue-600 hover:underline">Select All</button><button onClick={() => handleSelectAll(false)} className="text-sm font-medium text-blue-600 hover:underline">Deselect All</button></div>
                    <div className="flex items-center gap-x-2">
                        <span className="text-sm font-medium text-gray-600">{selectedIds.length} selected</span>
                        <button onClick={handleBulkUnapprove} disabled={selectedIds.length === 0} className="inline-flex items-center rounded-md bg-yellow-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-yellow-500 disabled:bg-gray-300"><CheckIcon className="w-4 h-4 mr-1"/> Un-approve</button>
                        <ExportDropdown count={selectedIds.length} onExport={handleStartDownload} disabled={selectedIds.length === 0} />
                        <button onClick={handleDeleteSelected} disabled={selectedIds.length === 0} className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-500 disabled:bg-gray-300"><TrashIcon className="w-4 h-4 mr-2"/> Delete</button>
                    </div>
                </div>
            </div>

            {filteredAndSortedGroups.length > 0 ? (
                <div className="flex-grow overflow-y-auto pr-4 -mr-4 pt-4">
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                            {filteredAndSortedGroups.map(group => {
                                const allIds = [...(group.sides.A?.versions.map(v => v.id) || []), ...(group.sides.B?.versions.map(v => v.id) || [])];
                                const isSelected = allIds.every(id => selectedIds.includes(id));
                                return <TraceGroupCard key={group.groupKey} group={group} isSelected={isSelected} onSelect={handleToggleGroupSelection} onViewDetails={setSelectedGroup} onToggleFavorite={handleToggleFavorite} />
                            })}
                        </div>
                    ) : (
                        <div className="space-y-2"><p className="text-center text-gray-500 p-4">List view is under construction.</p></div>
                    )}
                </div>
            ) : (
                <div className="flex-grow flex flex-col items-center justify-center bg-white border-2 border-dashed rounded-lg text-center p-8"><CheckIcon className="w-12 h-12 text-gray-300 mb-4" /><h3 className="text-xl font-semibold text-gray-700">Library is Empty</h3><p className="text-gray-500 mt-2 max-w-md">Approve traces from the Work Queue or Trace Archive to add them here.</p></div>
            )}

            {selectedGroup && <TraceDetailsModal group={selectedGroup} styleSets={styleSets} onClose={() => setSelectedGroup(null)} onDelete={handleDelete} dispatch={dispatch} addLog={addLog} />}
        </div>
    );
};