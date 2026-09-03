import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import { BUCKETS, INITIAL_SETTINGS } from '../constants';
import { geminiService } from '../services/geminiService';
import type { Action, AppState, Side, StyleSet, Bucket } from '../types';
import { parseStyleFilename } from '../utils/fileUtils';
import { TrashIcon, ChevronDownIcon, ChevronUpIcon, ListBulletIcon, Squares2X2Icon } from './icons';
import { StatusIcon, FileImagePreview, ActionBar, ActionBarLabel, ActionBarButton, ActionBarDropdown, ActionBarIconButton } from './common';

const API_REQUEST_DELAY_MS = 1500; // Add a safe delay between sequential API calls to avoid rate-limiting.

export const StylesView: React.FC<{ state: AppState; dispatch: React.Dispatch<Action>; addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void }> = ({ state, dispatch, addLog }) => {
    const [selectedStyleId, setSelectedStyleId] = React.useState<string | null>(null);
    const [collapsedBuckets, setCollapsedBuckets] = React.useState<Set<string>>(new Set());
    
    // --- FIX: Add safe fallbacks for state slices to prevent crash on initial render ---
    const styleSets = state?.styleSets ?? [];
    const settings = state?.settings ?? INITIAL_SETTINGS;

    const [searchTerm, setSearchTerm] = React.useState('');
    const [filterActive, setFilterActive] = React.useState<'All' | 'Active' | 'Inactive'>('All');
    const [sortBy, setSortBy] = React.useState<'name' | 'id'>('name');
    const [viewMode, setViewMode] = React.useState<'list' | 'grid'>('list');

    const selectedStyle = styleSets.find(s => s.id === selectedStyleId) || null;
    const selectedStyleIds = styleSets.filter(s => s.selected).map(s => s.id);

    const filteredAndSortedStyles = React.useMemo(() => {
        let styles = [...styleSets];
        if (searchTerm) {
            styles = styles.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        if (filterActive !== 'All') {
            const isActive = filterActive === 'Active';
            styles = styles.filter(s => s.active === isActive);
        }
        if (sortBy === 'name') {
            styles.sort((a, b) => a.name.localeCompare(b.name));
        } else { // 'id' for "recent"
            styles.sort((a, b) => b.id.localeCompare(a.id));
        }
        return styles;
    }, [styleSets, searchTerm, filterActive, sortBy]);

    const toggleBucket = (bucket: string) => {
        setCollapsedBuckets(prev => {
            const newSet = new Set(prev);
            if (newSet.has(bucket)) {
                newSet.delete(bucket);
            } else {
                newSet.add(bucket);
            }
            return newSet;
        });
    };

    const onDrop = React.useCallback(async (acceptedFiles: File[]) => {
        addLog('INFO', `Processing ${acceptedFiles.length} uploaded style files.`);
        const stylesMap: Map<string, Partial<StyleSet>> = new Map();

        for (const file of acceptedFiles) {
            const parsed = parseStyleFilename(file.name);
            if (!parsed) {
                addLog('WARN', `Skipping file with invalid name format: ${file.name}`);
                continue;
            }
            const { name, side, type } = parsed;
            if (!stylesMap.has(name)) {
                stylesMap.set(name, {
                    id: `style_${name}_${Date.now()}`,
                    name,
                    bucket: 'Unassigned',
                    active: true,
                    selected: false,
                    isDetailsExpanded: false,
                    classificationStatus: 'idle',
                    A: {},
                    B: {},
                    similarityCheckStatus: 'idle',
                });
            }
            const style = stylesMap.get(name)!;
            const styleSide: Partial<Side> = side === 'A' ? style.A : style.B;
            if (type === 'photo') {
                styleSide.photoFile = file;
            } else {
                styleSide.traceFile = file;
            }
        }

        const newStyles = Array.from(stylesMap.values()) as StyleSet[];
        if (newStyles.length > 0) {
            dispatch({ type: 'ADD_STYLE_SETS', payload: newStyles });
            addLog('SUCCESS', `Added ${newStyles.length} new style sets.`);
            
            for (const style of newStyles) {
                const photoToClassify = style.A.photoFile || style.B.photoFile;
                if (photoToClassify && settings.useGeminiClassification) {
                    dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: style.id, classificationStatus: 'classifying' } });
                    try {
                        const { bucket } = await geminiService.classifyObjectShape(photoToClassify, settings.temperatureEnabled ? settings.temperature : undefined, settings.textModel);
                        dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: style.id, bucket, classificationStatus: 'classified' } });
                        addLog('INFO', `Auto-classified style '${style.name}' as '${bucket}'.`);
                    } catch (e) {
                        const err = e as Error;
                        dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: style.id, classificationStatus: 'error', classificationError: err.message } });
                        addLog('ERROR', `Failed to auto-classify style '${style.name}': ${err.message}`);
                    }
                    // Delay to avoid hitting API rate limits during batch uploads.
                    if (newStyles.indexOf(style) < newStyles.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
                    }
                }
            }
        }
    }, [addLog, dispatch, settings]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] } });

    const bucketOptions = BUCKETS.map(b => ({ label: b, value: b }));

    return (
        <div className="flex h-full bg-gray-50">
            <div className="w-[40%] p-4 border-r border-gray-200 flex flex-col">
                <h1 className="text-2xl font-bold mb-4">Style Library</h1>
                 <div {...getRootProps()} className={`p-6 border-2 border-dashed rounded-lg text-center cursor-pointer mb-4 ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}>
                    <input {...getInputProps()} />
                     <p>Drop style photos & traces here</p>
                </div>
                 <div className="mb-4 p-2 bg-gray-100 rounded-md border flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-4">
                        <input type="search" placeholder="Search by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full sm:w-48 rounded-md border-gray-300 shadow-sm text-sm" />
                        <div className="flex items-center gap-2">
                            <select value={filterActive} onChange={e => setFilterActive(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm">
                                <option value="All">All Statuses</option>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm">
                                <option value="name">Sort by Name</option>
                                <option value="id">Sort by Recent</option>
                            </select>
                            <div className="flex items-center rounded-md shadow-sm bg-white border">
                                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-l-md ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><ListBulletIcon className="w-5 h-5"/></button>
                                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><Squares2X2Icon className="w-5 h-5"/></button>
                            </div>
                        </div>
                    </div>
                </div>
                <ActionBar>
                    <ActionBarLabel>{selectedStyleIds.length} of {styleSets.length} selected</ActionBarLabel>
                    <ActionBarButton variant="text" onClick={() => dispatch({ type: 'SET_STYLE_SETS', payload: styleSets.map(s => ({ ...s, selected: false })) })} disabled={selectedStyleIds.length === 0}>Deselect All</ActionBarButton>
                    <ActionBarButton onClick={() => dispatch({ type: 'BULK_UPDATE_STYLE_SETS_ACTIVE', payload: { ids: selectedStyleIds, active: true }})} disabled={selectedStyleIds.length === 0}>Activate</ActionBarButton>
                    <ActionBarButton onClick={() => dispatch({ type: 'BULK_UPDATE_STYLE_SETS_ACTIVE', payload: { ids: selectedStyleIds, active: false }})} disabled={selectedStyleIds.length === 0}>Deactivate</ActionBarButton>
                    <ActionBarDropdown label="Assign to Bucket" options={bucketOptions} onSelect={(bucket) => dispatch({ type: 'BULK_UPDATE_STYLE_SETS_BUCKET', payload: { ids: selectedStyleIds, bucket: bucket as Bucket }})} disabled={selectedStyleIds.length === 0} />
                    <ActionBarIconButton icon={TrashIcon} label="Delete Selected" variant="destructive" onClick={() => selectedStyleIds.forEach(id => dispatch({ type: 'REMOVE_STYLE_SET', payload: id }))} disabled={selectedStyleIds.length === 0} />
                </ActionBar>
                <div className="flex-grow overflow-y-auto pr-2 mt-4">
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {filteredAndSortedStyles.map(style => {
                                const thumbnailFile = style.A.traceFile || style.B.traceFile || style.A.photoFile || style.B.photoFile;
                                return (
                                    <div key={style.id} onClick={() => setSelectedStyleId(style.id)} className={`p-2 rounded-lg cursor-pointer relative group ${selectedStyleId === style.id ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'}`}>
                                        <input type="checkbox" checked={style.selected} onChange={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: style.id, selected: !style.selected }})}} className="absolute top-2 left-2 z-10 h-4 w-4 rounded border-gray-300 opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}/>
                                        <div className="w-full h-24 bg-white rounded-md flex items-center justify-center overflow-hidden mb-2">
                                            <FileImagePreview file={thumbnailFile} className="w-full h-full object-contain" alt={`${style.name} thumbnail`} />
                                        </div>
                                        <p className="font-medium text-xs text-center truncate">{style.name}</p>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        BUCKETS.map(bucket => {
                             const stylesInBucket = filteredAndSortedStyles.filter(s => s.bucket === bucket);
                            if (stylesInBucket.length === 0) return null;

                            const selectedInBucketCount = stylesInBucket.filter(p => p.selected).length;
                            const allSelected = stylesInBucket.length > 0 && selectedInBucketCount === stylesInBucket.length;
                            const someSelected = selectedInBucketCount > 0 && !allSelected;
                            const isCollapsed = collapsedBuckets.has(bucket);

                            return (
                                 <div key={bucket}>
                                    <div className="flex items-center justify-between my-2 sticky top-0 bg-gray-50 py-1 px-1 rounded z-10">
                                        <div className="flex items-center gap-x-2">
                                             <input type="checkbox" title={`Select all in ${bucket}`} ref={el => { if (el) (el as any).indeterminate = someSelected; }} checked={allSelected} onChange={() => dispatch({ type: 'BULK_SELECT_STYLES_IN_BUCKET', payload: { bucket, select: !allSelected } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                            <button className="flex-grow text-left" onClick={() => toggleBucket(bucket)}>
                                                <h3 className="text-lg font-semibold">{bucket} ({stylesInBucket.length})</h3>
                                            </button>
                                        </div>
                                        <button onClick={() => toggleBucket(bucket)} className="p-1 rounded-full hover:bg-gray-200">
                                            {isCollapsed ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronUpIcon className="w-5 h-5" />}
                                        </button>
                                    </div>
                                    {!isCollapsed && stylesInBucket.map(style => {
                                        const thumbnailFile = style.A.traceFile || style.B.traceFile || style.A.photoFile || style.B.photoFile;
                                        return (
                                            <div key={style.id} onClick={() => setSelectedStyleId(style.id)} className={`flex items-center p-2 rounded-md cursor-pointer mb-1 ${selectedStyleId === style.id ? 'bg-blue-100' : 'hover:bg-gray-100'}`}>
                                                <input type="checkbox" checked={style.selected} onChange={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: style.id, selected: !style.selected }})}} className="mr-3 h-4 w-4 rounded border-gray-300"/>
                                                <FileImagePreview file={thumbnailFile} className="w-12 h-12 object-contain rounded-md mr-3 bg-white border border-gray-200" alt={`${style.name} thumbnail`}/>
                                                <div className="flex-grow">
                                                    <p className="font-medium">{style.name}</p>
                                                    <p className="text-sm text-gray-500 capitalize">{style.classificationStatus || 'idle'}</p>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <div className={`w-3 h-3 rounded-full ${style.active ? 'bg-green-500' : 'bg-gray-400'}`} title={style.active ? 'Active' : 'Inactive'}></div>
                                                    <StatusIcon status={style.classificationStatus || 'idle'} error={style.classificationError} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
             <div className="w-[60%] p-6 bg-white overflow-y-auto">
                 {selectedStyle ? (
                    <div className="space-y-6">
                        <div className="flex justify-between items-start">
                             <input type="text" value={selectedStyle.name} onChange={e => dispatch({type: 'UPDATE_STYLE_SET', payload: {id: selectedStyle.id, name: e.target.value}})} className="text-3xl font-bold border-b-2 border-transparent focus:border-blue-500 outline-none"/>
                            <button onClick={() => dispatch({ type: 'REMOVE_STYLE_SET', payload: selectedStyle.id })} className="p-2 text-gray-500 hover:text-red-600"><TrashIcon className="w-6 h-6"/></button>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-2">Details</h4>
                            <div className="p-4 bg-gray-50 rounded-lg border space-y-2">
                                <div className="flex items-center">
                                    <label htmlFor="styleActive" className="mr-2 font-medium">Active:</label>
                                    <input type="checkbox" id="styleActive" checked={selectedStyle.active} onChange={e => dispatch({ type: 'UPDATE_STYLE_SET', payload: { id: selectedStyle.id, active: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                </div>
                                <p><strong>Bucket:</strong> {selectedStyle.bucket}</p>
                                <p><strong>Classification:</strong> {selectedStyle.classificationStatus || 'idle'}</p>
                                {selectedStyle.classificationError && <p className="text-red-600"><strong>Error:</strong> {selectedStyle.classificationError}</p>}
                            </div>
                        </div>
                         <div className="grid grid-cols-2 gap-6">
                            <div>
                                <h4 className="font-semibold mb-2">Side A Photo</h4>
                                <FileImagePreview file={selectedStyle.A.photoFile} className="rounded-lg w-full" alt="Side A Photo" />
                            </div>
                             <div>
                                <h4 className="font-semibold mb-2">Side A Trace</h4>
                                <FileImagePreview file={selectedStyle.A.traceFile} className="rounded-lg w-full" alt="Side A Trace" />
                            </div>
                         </div>
                    </div>
                 ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                        <p>Select a style from the list to see its details.</p>
                    </div>
                 )}
            </div>
        </div>
    );
};
