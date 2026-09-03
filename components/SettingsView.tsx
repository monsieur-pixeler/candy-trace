import * as React from 'react';
import { dbService } from '../services/dbService';
import { backupService } from '../services/backupService';
import type { Action, AppState, WorkspaceBackup } from '../types';
import { ChevronDownIcon, ChevronUpIcon, InfoIcon, Spinner, CheckIcon, ErrorIcon, DatabaseIcon, TrashIcon, RefreshIcon } from './icons';
import { PromptEditor } from './PromptEditor';
import { TabButton, Modal } from './common';
import { gcsService } from '../services/gcsService';
import { ApiKeySettings } from './ApiKeySettings';

const LocalSnapshots: React.FC<{ state: AppState; dispatch: React.Dispatch<Action> }> = ({ state, dispatch }) => {
    const [snapshots, setSnapshots] = React.useState<WorkspaceBackup[]>([]);
    const [newName, setNewName] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(true);
    const addLog = (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => dispatch({ type: 'ADD_LOG', payload: { level, message } });

    const fetchSnapshots = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const backupList = await dbService.getNamedBackups();
            setSnapshots(backupList);
        } catch (e) {
            addLog('ERROR', `Failed to load local snapshots: ${(e as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [addLog]);

    React.useEffect(() => {
        fetchSnapshots();
    }, [fetchSnapshots]);

    const handleSave = async () => {
        if (!newName.trim()) {
            alert('Please enter a name for the snapshot.');
            return;
        }
        setIsLoading(true);
        addLog('INFO', `Saving local snapshot: "${newName.trim()}"...`);
        try {
            await dbService.saveNamedBackup(newName.trim(), state);
            addLog('SUCCESS', `Snapshot "${newName.trim()}" saved successfully.`);
            setNewName('');
            await fetchSnapshots();
        } catch (e) {
            addLog('ERROR', `Failed to save snapshot: ${(e as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoad = (id: string, name: string) => {
        if (window.confirm(`This will overwrite your current workspace with the snapshot "${name}". Unsaved changes will be lost. Are you sure?`)) {
            addLog('INFO', `Loading snapshot "${name}"...`);
            localStorage.setItem('__backup_to_load__', id);
            window.location.reload();
        }
    };
    
    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`Are you sure you want to permanently delete the snapshot "${name}"? This action cannot be undone.`)) {
            setIsLoading(true);
            addLog('INFO', `Deleting snapshot "${name}"...`);
            try {
                await dbService.deleteNamedBackup(id);
                addLog('SUCCESS', `Snapshot "${name}" deleted.`);
                await fetchSnapshots();
            } catch (e) {
                addLog('ERROR', `Failed to delete snapshot: ${(e as Error).message}`);
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="border-t border-gray-200 pt-8">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Local Snapshots</h3>
            <p className="mt-1 text-sm text-gray-500">Save or load a "build" of your entire workspace. This is useful for preserving your data in ephemeral preview environments.</p>
            <div className="mt-4 space-y-4">
                <div>
                    <label htmlFor="snapshotName" className="block text-sm font-medium text-gray-700">New Snapshot Name</label>
                    <div className="mt-1 flex space-x-2">
                        <input type="text" id="snapshotName" value={newName} onChange={e => setNewName(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" placeholder="e.g., My Test Data"/>
                        <button onClick={handleSave} disabled={!newName.trim() || isLoading} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">
                            {isLoading && snapshots.length > 0 ? <Spinner className="w-5 h-5 mr-2" /> : null} Save Current Workspace
                        </button>
                    </div>
                </div>
                <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700">Saved Snapshots</h4>
                    {isLoading && snapshots.length === 0 ? (
                        <p className="text-sm text-gray-500 mt-2">Loading snapshots...</p>
                    ) : snapshots.length === 0 ? (
                        <p className="text-sm text-gray-500 mt-2">No snapshots saved yet.</p>
                    ) : (
                        <ul className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-2">
                            {snapshots.map(s => (
                                <li key={s.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-md border">
                                    <div>
                                        <p className="font-semibold">{s.name}</p>
                                        <p className="text-xs text-gray-500">{new Date(s.timestamp).toLocaleString()}</p>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <button onClick={() => handleLoad(s.id, s.name)} disabled={isLoading} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:bg-gray-300">Load</button>
                                        <button onClick={() => handleDelete(s.id, s.name)} disabled={isLoading} className="p-2 text-gray-500 hover:text-red-600 disabled:text-gray-300"><TrashIcon className="w-5 h-5"/></button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

const UltimateRecoveryTool: React.FC<{ addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void }> = ({ addLog }) => {
    const [scanStatus, setScanStatus] = React.useState<'idle' | 'scanning' | 'scanned' | 'error'>('idle');
    const [scanLogs, setScanLogs] = React.useState<string[]>([]);
    const [scanResults, setScanResults] = React.useState<dbService.recovery.RawScanResult[]>([]);
    const [scanError, setScanError] = React.useState<string | null>(null);
    const [migrationState, setMigrationState] = React.useState<Record<string, { status: 'idle' | 'migrating' | 'complete' | 'error', message?: string }>>({});
  
    const handleScan = async () => {
        setScanStatus('scanning');
        setScanError(null);
        setScanLogs([]);
        setScanResults([]);
        setMigrationState({});
        addLog('INFO', 'Starting data exploration...');
        try {
            const { results, logs } = await dbService.recovery.fullRawStorageScan();
            setScanLogs(logs);
            setScanResults(results);
            setScanStatus('scanned');
            if (results.length > 0) {
                addLog('SUCCESS', `Data explorer found ${results.length} non-empty data store(s).`);
            } else {
                addLog('INFO', 'Exploration complete. No data stores were found.');
            }
        } catch (err) {
            const error = err as Error;
            setScanStatus('error');
            setScanError(error.message);
            setScanLogs(prev => [...prev, `FATAL ERROR: ${error.message}`]);
            addLog('ERROR', `Data exploration failed: ${error.message}`);
        }
    };

    const handleRecover = async (result: dbService.recovery.RawScanResult, recoverAs: 'pills' | 'styles' | 'traces') => {
        if (!window.confirm(`Are you sure you want to recover the data from "${result.storeName}" as a ${recoverAs} library? This will merge the data and cannot be undone.`)) {
            return;
        }

        setMigrationState(prev => ({ ...prev, [result.id]: { status: 'migrating' } }));
        addLog('INFO', `Attempting to recover data from "${result.storeName}" as ${recoverAs}...`);

        try {
            const count = await dbService.recovery.runMigration(result, recoverAs);
            if (count > 0) {
                setMigrationState(prev => ({ ...prev, [result.id]: { status: 'complete', message: `Added ${count} new items.` } }));
                addLog('SUCCESS', `Recovery successful: Added ${count} new ${recoverAs}. Please reload the application.`);
                alert(`Recovery successful! Added ${count} new items. The application will now reload to apply the changes.`);
                window.location.reload();
            } else {
                setMigrationState(prev => ({ ...prev, [result.id]: { status: 'complete', message: `Completed. No new items were added (duplicates may have been skipped).` } }));
                addLog('INFO', `Recovery from "${result.storeName}" complete. No new items were added.`);
            }
        } catch(e) {
            const err = e as Error;
            setMigrationState(prev => ({ ...prev, [result.id]: { status: 'error', message: err.message } }));
            addLog('ERROR', `Recovery from "${result.storeName}" failed: ${err.message}`);
        }
    };
  
    return (
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-lg font-medium leading-6 text-gray-900">Ultimate Recovery Tool</h3>
        <p className="mt-1 text-sm text-gray-500">This tool explores all browser storage for this site and shows you any data it finds. You can then choose how to recover it.</p>
        <div className="mt-4 p-4 border rounded-lg bg-gray-50/70 space-y-4">
            <div className="text-center">
                <button onClick={handleScan} disabled={scanStatus === 'scanning'} className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-gray-400">
                    {scanStatus === 'scanning' ? <Spinner className="w-5 h-5 mr-2 -ml-1" /> : <DatabaseIcon className="w-5 h-5 mr-2 -ml-1" />}
                    Explore All Storage
                </button>
            </div>

            {(scanStatus === 'scanning' || scanLogs.length > 0) && (
                <div>
                    <h4 className="text-sm font-semibold text-gray-700">Exploration Log</h4>
                    <pre className="mt-2 bg-gray-900 text-white p-3 rounded-md text-xs font-mono max-h-48 overflow-y-auto">{scanLogs.join('\n')}{scanStatus === 'scanning' ? '\nScanning...' : ''}</pre>
                </div>
            )}
            
            {scanStatus === 'error' && <p className="text-red-600 text-sm font-medium">Scan failed: {scanError}</p>}
            
            {scanStatus === 'scanned' && (
                <div className="space-y-4">
                    {scanResults.length > 0 ? (
                        <>
                            <p className="text-sm font-semibold text-green-800 bg-green-100 p-2 rounded-md">Success! The explorer found the following data stores:</p>
                            <div className="space-y-4">
                                {scanResults.map(result => (
                                    <div key={result.id} className="p-4 bg-white rounded-lg border shadow-sm">
                                        <div className="grid grid-cols-12 gap-4 items-start">
                                            <div className="col-span-12 md:col-span-4">
                                                <h4 className="font-semibold text-gray-800 truncate">{result.storeName}</h4>
                                                <p className="text-xs font-mono text-gray-500 truncate">DB: {result.dbName}</p>
                                                <p className="text-sm text-gray-600 mt-2">Found <span className="font-bold">{result.itemCount}</span> item(s)</p>
                                            </div>
                                            <div className="col-span-12 md:col-span-5">
                                                <p className="text-xs font-semibold text-gray-500 mb-1">Data Preview (First Item):</p>
                                                <pre className="text-xs font-mono bg-gray-100 p-2 rounded border max-h-32 overflow-y-auto">{result.dataPreview}</pre>
                                            </div>
                                            <div className="col-span-12 md:col-span-3 space-y-2">
                                                 <p className="text-xs font-semibold text-gray-500 mb-1">Actions:</p>
                                                 <div className="relative group w-full">
                                                    <button disabled={migrationState[result.id]?.status === 'migrating'} className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none disabled:bg-gray-200">
                                                        Recover As... <ChevronDownIcon className="w-5 h-5 ml-2 -mr-1" />
                                                    </button>
                                                    <div className="absolute left-0 bottom-full mb-2 w-full rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
                                                        <div className="py-1">
                                                            <a href="#" onClick={e => {e.preventDefault(); handleRecover(result, 'pills')}} className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100">Pill Library</a>
                                                            <a href="#" onClick={e => {e.preventDefault(); handleRecover(result, 'styles')}} className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100">Style Library</a>
                                                            <a href="#" onClick={e => {e.preventDefault(); handleRecover(result, 'traces')}} className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100">Trace Archive</a>
                                                        </div>
                                                    </div>
                                                </div>
                                                {migrationState[result.id] && (
                                                    <div className="mt-2 text-xs flex items-center">
                                                        {migrationState[result.id].status === 'migrating' && <><Spinner className="w-4 h-4 mr-1"/><span>Migrating...</span></>}
                                                        {migrationState[result.id].status === 'complete' && <><CheckIcon className="w-4 h-4 mr-1 text-green-600"/> <span className="text-green-700">{migrationState[result.id].message}</span></>}
                                                        {migrationState[result.id].status === 'error' && <><ErrorIcon className="w-4 h-4 mr-1 text-red-600"/> <span className="text-red-700 truncate">{migrationState[result.id].message}</span></>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-gray-700">Exploration complete. No data was found in any IndexedDB or localStorage for this application.</p>
                    )}
                </div>
            )}
        </div>
      </div>
    );
};
  
export const SettingsView: React.FC<{ 
    state: AppState; 
    dispatch: React.Dispatch<Action>;
    onManualSave: () => Promise<void>;
}> = ({ state, dispatch, onManualSave }) => {
    const { settings } = state;
    const [activeTab, setActiveTab] = React.useState<'apikey' | 'processing' | 'prompts' | 'data' | 'presets'>('apikey');
    const [presetName, setPresetName] = React.useState('');
    const [selectedPresetId, setSelectedPresetId] = React.useState<string>('');
    const [validationStatus, setValidationStatus] = React.useState<'idle' | 'validating' | 'success' | 'error'>('idle');
    const [validationMessage, setValidationMessage] = React.useState<string>('');
    const [isExporting, setIsExporting] = React.useState(false);
    const [isImporting, setIsImporting] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        setValidationStatus('idle');
    }, [settings.gcsBucketName, settings.gcsApiKey]);
    
    const handleManualSave = async () => {
        setIsSaving(true);
        await onManualSave();
        setIsSaving(false);
    };

    const handleTestConnection = async () => {
        if (!settings.gcsBucketName || !settings.gcsApiKey) {
            setValidationStatus('error');
            setValidationMessage('Bucket name and API key are required.');
            return;
        }
        setValidationStatus('validating');
        setValidationMessage('');
        try {
            await gcsService.testConnection(settings.gcsBucketName, settings.gcsApiKey);
            setValidationStatus('success');
            setValidationMessage('Connection successful!');
        } catch (e) {
            setValidationStatus('error');
            setValidationMessage(`Connection failed. Check console for details.`);
            console.error(e);
        }
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            await backupService.exportFullWorkspace(state);
        } catch (error) {
            console.error("Export failed:", error);
            alert(`Export failed: ${(error as Error).message}`);
        } finally {
            setIsExporting(false);
        }
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!window.confirm("DANGER: Importing a workspace backup will completely overwrite all current data in this application. This action cannot be undone. Are you sure you want to proceed?")) {
            return;
        }
        
        setIsImporting(true);
        try {
            await backupService.importFullWorkspace(file);
            alert("Import successful! The application will now reload with the new workspace.");
            window.location.reload();
        } catch (error) {
            console.error("Import failed:", error);
            alert(`Import failed: ${(error as Error).message}`);
            setIsImporting(false);
        }
        // No finally block, as success causes a reload.
    };


    React.useEffect(() => {
        if (settings.activePresetId) {
            setSelectedPresetId(settings.activePresetId);
            const activePreset = settings.presets.find(p => p.id === settings.activePresetId);
            if (activePreset) {
                setPresetName(activePreset.name);
            }
        } else {
             setSelectedPresetId('');
             setPresetName('');
        }
    }, [settings.activePresetId, settings.presets]);

    const handleSavePreset = () => {
        if (!presetName.trim()) {
            alert('Please enter a name for the preset.');
            return;
        }
        dispatch({ type: 'SAVE_SETTINGS_AS_PRESET', payload: { name: presetName.trim() } });
        alert(`Preset '${presetName.trim()}' saved!`);
    };

    const handleLoadPreset = () => {
        if (!selectedPresetId) return;
        dispatch({ type: 'LOAD_SETTINGS_PRESET', payload: selectedPresetId });
        alert('Preset loaded!');
    };

    const handleDeletePreset = () => {
        if (!selectedPresetId) return;
        if (window.confirm('Are you sure you want to delete this preset?')) {
            dispatch({ type: 'DELETE_SETTINGS_PRESET', payload: selectedPresetId });
            alert('Preset deleted.');
        }
    };
    
    const handleForceUpdatePrompts = () => {
        dispatch({ type: 'FORCE_UPDATE_PROMPTS', payload: { silent: false } });
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'apikey':
                return <ApiKeySettings />;
            case 'processing':
                return (
                    <div className="space-y-8">
                        <div>
                             <h3 className="text-lg font-medium leading-6 text-gray-900">Processing Engine</h3>
                             <p className="mt-1 text-sm text-gray-500">Configure core AI generation and workload settings.</p>
                             <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="temperature" className="block text-sm font-medium text-gray-700">Temperature: {settings.temperatureEnabled ? settings.temperature.toFixed(1) : 'Disabled'}</label>
                                    <input id="temperature" type="range" min="0" max="2" step="0.1" value={settings.temperature} disabled={!settings.temperatureEnabled} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { temperature: parseFloat(e.target.value) } })} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"/>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Temperature Control</label>
                                     <div className="flex items-center mt-2">
                                        <input id="tempEnabled" type="checkbox" checked={settings.temperatureEnabled} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { temperatureEnabled: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                        <label htmlFor="tempEnabled" className="ml-2 block text-sm text-gray-900">Enable Temperature</label>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <div className="flex items-center">
                                        <input id="autoClassifyOnUpload" type="checkbox" checked={settings.autoClassifyOnUpload} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { autoClassifyOnUpload: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                        <label htmlFor="autoClassifyOnUpload" className="ml-2 block text-sm font-medium text-gray-900">Auto-classify new candies on upload</label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 ml-6">If disabled, classification can be run manually or after traceability tests.</p>
                                </div>
                                <div className="md:col-span-2">
                                    <label htmlFor="systemInstruction" className="block text-sm font-medium text-gray-700">System Instruction</label>
                                    <textarea
                                        id="systemInstruction"
                                        rows={6}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
                                        value={settings.systemInstruction}
                                        onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { systemInstruction: e.target.value }})}
                                    />
                                    <div className="flex items-center mt-2">
                                        <input id="systemInstructionEnabled" type="checkbox" checked={settings.systemInstructionEnabled} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { systemInstructionEnabled: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                        <label htmlFor="systemInstructionEnabled" className="ml-2 block text-sm text-gray-900">Enable System Instruction</label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Controls whether the global system instruction is sent with image generation requests.</p>
                                </div>
                             </div>
                        </div>
                        <div className="border-t border-gray-200 pt-8">
                             <h3 className="text-lg font-medium leading-6 text-gray-900">Output Formatting</h3>
                             <p className="mt-1 text-sm text-gray-500">Control the final appearance of the generated PNG files.</p>
                             <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Output Background</label>
                                    <div className="flex items-center space-x-4 mt-2">
                                        <label className="flex items-center">
                                            <input type="radio" value="white" checked={settings.outputBackground === 'white'} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { outputBackground: 'white' }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                            <span className="ml-2 text-sm text-gray-900">White</span>
                                        </label>
                                        <label className="flex items-center">
                                            <input type="radio" value="transparent" checked={settings.outputBackground === 'transparent'} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { outputBackground: 'transparent' }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                            <span className="ml-2 text-sm text-gray-900">Transparent</span>
                                        </label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Choose between a solid white or transparent background for the final PNG.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Post-Processing</label>
                                    <div className="flex items-center mt-2">
                                        <input id="autoCleanTrace" type="checkbox" checked={settings.autoCleanTrace} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { autoCleanTrace: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                        <label htmlFor="autoCleanTrace" className="ml-2 block text-sm text-gray-900">Auto-clean to pure 1-bit</label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Automatically processes the AI's output to remove noise and enforce pure black and white/transparent pixels.</p>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Clean Output Prompt</label>
                                    <div className="flex items-center mt-2">
                                        <input id="forceBlankCanvas" type="checkbox" checked={settings.forceBlankCanvas} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { forceBlankCanvas: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                        <label htmlFor="forceBlankCanvas" className="ml-2 block text-sm text-gray-900">Instruct AI to use a clean canvas</label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Adds a critical instruction for the AI to draw only the trace on a pure white background, preventing it from including parts of the original photo. The 'Output Background' setting above takes precedence.</p>
                                </div>
                             </div>
                        </div>
                        <div className="border-t border-gray-200 pt-8">
                             <h3 className="text-lg font-medium leading-6 text-gray-900">Style Guidance</h3>
                             <p className="mt-1 text-sm text-gray-500">Control how the AI uses style references.</p>
                             <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Style Reference</label>
                                    <div className="flex items-center space-x-4 mt-2">
                                        <label className="flex items-center">
                                            <input type="radio" value={0} checked={settings.directTraceReferenceCount === 0} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { directTraceReferenceCount: 0 }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                            <span className="ml-2 text-sm text-gray-900">Disabled (Text Prompt Only)</span>
                                        </label>
                                        <label className="flex items-center">
                                            <input type="radio" value={1} checked={settings.directTraceReferenceCount === 1} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { directTraceReferenceCount: 1 }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                            <span className="ml-2 text-sm text-gray-900">1 Trace Image</span>
                                        </label>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Choose whether to guide the AI with a style trace image or only with the text prompt.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Global Active Prompt Set</label>
                                    <div className="flex items-center space-x-4 mt-2 flex-wrap gap-y-2">
                                        <label className="flex items-center">
                                            <input type="radio" value="simpleTrace" checked={settings.activePromptSet === 'simpleTrace'} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { activePromptSet: 'simpleTrace' }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"/> 
                                            <span className="ml-2 text-sm">Simple Trace</span>
                                        </label>
                                        <label className="flex items-center">
                                            <input type="radio" value="dynamicSimpleTrace" checked={settings.activePromptSet === 'dynamicSimpleTrace'} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { activePromptSet: 'dynamicSimpleTrace' }})} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"/> 
                                            <span className="ml-2 text-sm">Dynamic Trace</span>
                                        </label>
                                    </div>
                                </div>
                             </div>
                        </div>
                    </div>
                );
            case 'prompts':
                return (
                    <div className="space-y-6">
                        {/* Fix: Corrected promptHistoryKey to match the expanded PromptHistoryKey type. */}
                        <PromptEditor label="Simple Trace Prompt" promptHistory={settings.simpleTraceMainPromptHistory} activePromptId={settings.activeSimpleTraceMainPromptId} promptHistoryKey="simpleTraceMainPromptHistory" activePromptIdKey="activeSimpleTraceMainPromptId" dispatch={dispatch} />
                        {/* Fix: Corrected promptHistoryKey to match the expanded PromptHistoryKey type. */}
                        <PromptEditor label="Dynamic Simple Trace Prompt" promptHistory={settings.dynamicSimpleTraceMainPromptHistory} activePromptId={settings.activeDynamicSimpleTraceMainPromptId} promptHistoryKey="dynamicSimpleTraceMainPromptHistory" activePromptIdKey="activeDynamicSimpleTraceMainPromptId" dispatch={dispatch} />
                    </div>
                );
            case 'data':
                return (
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-lg font-medium leading-6 text-gray-900">Cloud Storage (Google Cloud Storage)</h3>
                            <p className="mt-1 text-sm text-gray-500">Optionally, sync your workspace with a GCS bucket.</p>
                            <div className="mt-4 space-y-4">
                                <div className="flex items-center">
                                    <input id="gcsEnabled" type="checkbox" checked={settings.gcsEnabled} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { gcsEnabled: e.target.checked } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                                    <label htmlFor="gcsEnabled" className="ml-2 block text-sm text-gray-900">Enable GCS Sync</label>
                                </div>
                                {settings.gcsEnabled && (
                                    <>
                                        <div>
                                            <label htmlFor="gcsBucket" className="block text-sm font-medium text-gray-700">GCS Bucket Name</label>
                                            <input type="text" id="gcsBucket" value={settings.gcsBucketName} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { gcsBucketName: e.target.value }})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" />
                                        </div>
                                        <div>
                                            <label htmlFor="gcsApiKey" className="block text-sm font-medium text-gray-700">GCS API Key</label>
                                            <input type="password" id="gcsApiKey" value={settings.gcsApiKey} onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { gcsApiKey: e.target.value }})} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" />
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button onClick={handleTestConnection} disabled={validationStatus === 'validating'} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">
                                                {validationStatus === 'validating' ? <Spinner className="w-5 h-5 mr-2" /> : null}
                                                Test Connection
                                            </button>
                                            {validationStatus === 'success' && <div className="flex items-center text-green-600"><CheckIcon className="w-5 h-5 mr-1"/>{validationMessage}</div>}
                                            {validationStatus === 'error' && <div className="flex items-center text-red-600"><ErrorIcon className="w-5 h-5 mr-1"/>{validationMessage}</div>}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        <LocalSnapshots state={state} dispatch={dispatch} />
                        <div className="border-t border-gray-200 pt-8">
                            <h3 className="text-lg font-medium leading-6 text-gray-900">Prompt Management</h3>
                            <p className="mt-1 text-sm text-gray-500">Ensure your workspace is using the latest built-in prompts from the application code.</p>
                            <div className="mt-4">
                                <button onClick={handleForceUpdatePrompts} className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
                                   <RefreshIcon className="w-5 h-5 mr-2 -ml-1" /> Update Prompts to Latest Versions
                                </button>
                            </div>
                        </div>
                        <div className="border-t border-gray-200 pt-8">
                            <h3 className="text-lg font-medium leading-6 text-gray-900">Workspace Backup & Restore</h3>
                            <p className="mt-1 text-sm text-gray-500">Export your entire workspace (libraries, work queue, settings, traces) to a .zip file, or import from a backup.</p>
                            <div className="mt-4 flex items-center space-x-4">
                                <button onClick={handleExport} disabled={isExporting} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">
                                    {isExporting ? <Spinner className="w-5 h-5 mr-2" /> : null} Export Workspace
                                </button>
                                <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50">
                                    {isImporting ? <Spinner className="w-5 h-5 mr-2" /> : null} Import Workspace
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleImport} accept=".zip" className="hidden" />
                            </div>
                        </div>
                        <div className="border-t border-gray-200 pt-8">
                            <h3 className="text-lg font-medium leading-6 text-gray-900">Manual Save</h3>
                            <p className="mt-1 text-sm text-gray-500">Manually trigger a save of the current session to local storage or GCS (if enabled).</p>
                            <div className="mt-4">
                                <button onClick={handleManualSave} disabled={isSaving} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">
                                   {isSaving ? <Spinner className="w-5 h-5 mr-2" /> : null} Save Session Now
                                </button>
                            </div>
                        </div>
                        <UltimateRecoveryTool addLog={(level, message) => dispatch({ type: 'ADD_LOG', payload: { level, message } })} />
                    </div>
                );
            case 'presets':
                return (
                    <div>
                        <h3 className="text-lg font-medium leading-6 text-gray-900">Settings Presets</h3>
                        <p className="mt-1 text-sm text-gray-500">Save your current settings as a named preset for quick recall.</p>
                        <div className="mt-4 space-y-4">
                            <div>
                                <label htmlFor="presetName" className="block text-sm font-medium text-gray-700">Preset Name</label>
                                <div className="mt-1 flex space-x-2">
                                    <input type="text" id="presetName" value={presetName} onChange={e => setPresetName(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" placeholder="e.g., High Quality Production"/>
                                    <button onClick={handleSavePreset} disabled={!presetName.trim()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300">Save/Update</button>
                                </div>
                            </div>
                            <div className="border-t pt-4">
                                <label htmlFor="loadPreset" className="block text-sm font-medium text-gray-700">Load or Delete Preset</label>
                                <div className="mt-1 flex space-x-2">
                                    <select id="loadPreset" value={selectedPresetId} onChange={e => setSelectedPresetId(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm sm:text-sm">
                                        <option value="" disabled>-- Select a preset --</option>
                                        {settings.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                    <button onClick={handleLoadPreset} disabled={!selectedPresetId} className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:bg-gray-300">Load</button>
                                    <button onClick={handleDeletePreset} disabled={!selectedPresetId} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:bg-gray-300">Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto">
            <h1 className="text-3xl font-bold mb-4">Settings</h1>
            <div className="flex border-b mb-6">
                <TabButton name="API Key" id="apikey" activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton name="Processing" id="processing" activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton name="Prompts" id="prompts" activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton name="Data & Backups" id="data" activeTab={activeTab} setActiveTab={setActiveTab} />
                <TabButton name="Presets" id="presets" activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md border">
                {renderContent()}
            </div>
        </div>
    );
};