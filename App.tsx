import * as React from 'react';
import { appReducer, initialState } from './reducer';
import type { AppState, View } from './types';
import { dbService } from './services/dbService';
import { INITIAL_SETTINGS, INITIAL_PILLS } from './constants';
import { Dashboard } from './components/Dashboard';
import { CandiesView } from './components/CandiesView';
import { WorkView } from './components/WorkView';
import { StylesView } from './components/StylesView';
import { SettingsView } from './components/SettingsView';
import { SandboxView } from './components/SandboxView';
import { TraceArchiveView } from './components/TraceLogView';
import { ApprovedLibraryView } from './components/ApprovedLibraryView';
import { NavItem } from './components/common';
import { ChartBarIcon, PackageIcon, PaletteIcon, ClipboardListIcon, BeakerIcon, SettingsIcon, Spinner, ArchiveBoxIcon, CheckBadgeIcon } from './components/icons';
import { useProcessingQueue } from './hooks/useProcessingQueue';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast';

const App: React.FC = () => {
    const [state, dispatch] = React.useReducer(appReducer, initialState);
    const [view, setView] = React.useState<View>('dashboard');
    const [isInitialized, setIsInitialized] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const lastSavedState = React.useRef<string | null>(null);
    const isSavingRef = React.useRef(false); // Add a ref to act as a save lock

    const addLog = React.useCallback((level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => {
        dispatch({ type: 'ADD_LOG', payload: { level, message } });
    }, []);

    // Activate the processing queue hook to listen for and process jobs.
    useProcessingQueue(state, dispatch, addLog);
    
    const handleSaveChanges = React.useCallback(async (isManual: boolean = false) => {
        if (isSavingRef.current && !isManual) {
            return; // Prevent concurrent auto-saves
        }
        isSavingRef.current = true;
        const logPrefix = isManual ? 'Manual save:' : 'Auto-save:';
        try {
            addLog('INFO', `${logPrefix} Saving session...`);
            
            const currentStateToSave = {
                workPairs: state.workPairs,
                pillLibrary: state.pillLibrary,
                styleSets: state.styleSets,
                settings: state.settings,
                traceArchive: state.traceArchive,
            };
            
            const currentStateString = JSON.stringify(currentStateToSave);

            await Promise.all([
                dbService.savePillLibrary(currentStateToSave.pillLibrary, currentStateToSave.settings),
                dbService.saveStyleSets(currentStateToSave.styleSets, currentStateToSave.settings),
                dbService.saveWorkSession(currentStateToSave.workPairs, currentStateToSave.settings),
                dbService.saveSettingsLocal(currentStateToSave.settings)
            ]);
            
            // Only now is the state genuinely persisted. Marking it saved before the
            // await meant a rejected write (quota exceeded, blocked IndexedDB, expired
            // GCS token) was recorded as a success and never retried — the user kept
            // working and lost everything on reload. Concurrency is already handled by
            // isSavingRef above, so this does not reintroduce a race.
            lastSavedState.current = currentStateString;

            dispatch({ type: 'SET_LAST_SAVE', payload: Date.now() });
            addLog('SUCCESS', `${logPrefix} Session saved successfully.`);
        } catch (e) {
            addLog('ERROR', `${logPrefix} Save failed: ${(e as Error).message}`);
        } finally {
            isSavingRef.current = false; // Release the lock
        }
    }, [state.workPairs, state.pillLibrary, state.styleSets, state.settings, state.traceArchive, addLog]);

    React.useEffect(() => {
        const initialize = async () => {
            try {
                addLog('INFO', 'Initializing session...');
                const backupToLoadId = localStorage.getItem('__backup_to_load__');

                if (backupToLoadId) {
                    localStorage.removeItem('__backup_to_load__');
                    addLog('INFO', `Attempting to restore workspace from local snapshot ID: ${backupToLoadId}`);
                    const restoredState = await dbService.restoreNamedBackup(backupToLoadId);

                    if (restoredState) {
                        dispatch({ type: 'INITIALIZE_STATE', payload: restoredState });
                        dispatch({ type: 'FORCE_UPDATE_PROMPTS', payload: { silent: true } });
                        lastSavedState.current = JSON.stringify({
                            workPairs: restoredState.workPairs || [],
                            pillLibrary: restoredState.pillLibrary || [],
                            styleSets: restoredState.styleSets || [],
                            settings: restoredState.settings || INITIAL_SETTINGS,
                            traceArchive: restoredState.traceArchive || [],
                        });
                        addLog('SUCCESS', 'Successfully restored workspace from snapshot.');
                        return; // Exit here, initialization is done.
                    } else {
                        addLog('ERROR', `Snapshot with ID ${backupToLoadId} not found. Proceeding with normal startup.`);
                    }
                }
                
                const localSettings = await dbService.getSettingsLocal();
                const settingsToUse = { ...INITIAL_SETTINGS, ...localSettings };

                if (settingsToUse.autoRestore) {
                    addLog('INFO', 'Auto-restore enabled. Loading data from storage...');
                    const [pills, styles, session, traces] = await Promise.all([
                        dbService.getPillLibrary(settingsToUse),
                        dbService.getStyleSets(settingsToUse),
                        dbService.restoreWorkSession(settingsToUse),
                        dbService.getTraces(),
                    ]);
                    
                    const restoredState: Partial<AppState> = {
                        pillLibrary: pills && pills.length > 0 ? pills : INITIAL_PILLS,
                        styleSets: styles,
                        workPairs: session?.workPairs || [],
                        traceArchive: traces.map(t => ({ ...t, selected: false, bucket: t.bucket || 'Unassigned' })),
                        settings: session?.settings ? { ...settingsToUse, ...session.settings } : settingsToUse
                    };
                    dispatch({ type: 'INITIALIZE_STATE', payload: restoredState });
                    addLog('INFO', 'Checking for prompt updates...');
                    dispatch({ type: 'FORCE_UPDATE_PROMPTS', payload: { silent: true } });
                    
                    // Prime the last saved state to prevent an immediate auto-save on load
                    lastSavedState.current = JSON.stringify({
                        workPairs: restoredState.workPairs || [],
                        pillLibrary: restoredState.pillLibrary || [],
                        styleSets: restoredState.styleSets || [],
                        settings: restoredState.settings || INITIAL_SETTINGS,
                        traceArchive: restoredState.traceArchive || [],
                    });

                    addLog('SUCCESS', `Restored session. Found ${pills.length > 0 ? pills.length : INITIAL_PILLS.length} candies, ${styles.length} styles, ${session?.workPairs?.length || 0} work items, and ${traces.length} archived traces.`);
                } else {
                     addLog('INFO', 'Auto-restore disabled. Starting with default state.');
                     dispatch({ type: 'INITIALIZE_STATE', payload: { settings: settingsToUse, pillLibrary: INITIAL_PILLS } });
                     addLog('INFO', 'Checking for prompt updates...');
                     dispatch({ type: 'FORCE_UPDATE_PROMPTS', payload: { silent: true } });
                     
                     // Prime the last saved state for a fresh session
                     lastSavedState.current = JSON.stringify({
                        workPairs: [],
                        pillLibrary: INITIAL_PILLS,
                        styleSets: [],
                        settings: settingsToUse,
                        traceArchive: [],
                     });
                }
            } catch (e) {
                const err = e as Error;
                addLog('ERROR', `Initialization failed: ${err.message}`);
                setError(`Failed to initialize application. Check console for details. Error: ${err.message}`);
            } finally {
                setIsInitialized(true);
            }
        };
        initialize();
    }, [addLog]);

    React.useEffect(() => {
        if (!isInitialized) return;

        // Intelligent Save: Check if any background operations are in progress.
        const isBusy =
            isSavingRef.current ||
            state.isQueueRunning ||
            state.processingQueue.length > 0 ||
            state.pillLibrary.some(p => 
                p.classificationStatus === 'classifying' || 
                p.qualityAnalysisStatus === 'analyzing' ||
                p.traceabilityTestA.status === 'testing' ||
                p.traceabilityTestB.status === 'testing' ||
                p.guidedTraceabilityTestA.status === 'testing' ||
                p.guidedTraceabilityTestB.status === 'testing'
            ) ||
            state.styleSets.some(s => s.classificationStatus === 'classifying') ||
            state.workPairs.some(wp =>
                wp.sideComparisonStatus === 'comparing' ||
                wp.A.status === 'processing' || wp.A.status === 'queued' ||
                wp.B.status === 'processing' || wp.B.status === 'queued' ||
                // Fix: Removed checks for 'styleMatchStatus' as the property is obsolete.
                wp.A.logoExtractionStatus === 'extracting' ||
                wp.B.logoExtractionStatus === 'extracting'
            );

        // If the app is busy, defer auto-saving.
        if (isBusy) {
            return;
        }

        const currentState = JSON.stringify({
            workPairs: state.workPairs,
            pillLibrary: state.pillLibrary,
            styleSets: state.styleSets,
            settings: state.settings,
            traceArchive: state.traceArchive,
        });

        if (currentState === lastSavedState.current) return;

        const saveTimer = setTimeout(() => {
            handleSaveChanges(false);
        }, 5000); // Increased debounce time to 5 seconds

        return () => clearTimeout(saveTimer);
    }, [state, isInitialized, handleSaveChanges]);

    const renderView = () => {
        switch (view) {
            case 'dashboard': return <Dashboard state={state} setView={setView} />;
            case 'candies': return <CandiesView state={state} dispatch={dispatch} addLog={addLog} setView={setView} />;
            case 'work': return <WorkView state={state} dispatch={dispatch} addLog={addLog} setView={setView} />;
            case 'styles': return <StylesView state={state} dispatch={dispatch} addLog={addLog} />;
            case 'settings': return <SettingsView state={state} dispatch={dispatch} onManualSave={() => handleSaveChanges(true)} />;
            case 'sandbox': return <SandboxView state={state} dispatch={dispatch} addLog={addLog} />;
            case 'traceArchive': return <TraceArchiveView state={state} dispatch={dispatch} addLog={addLog} />;
            case 'approvedLibrary': return <ApprovedLibraryView state={state} dispatch={dispatch} addLog={addLog} />;
            default: return <Dashboard state={state} setView={setView} />;
        }
    };
    
    if (error) {
        return (
            <div className="flex items-center justify-center h-screen bg-red-50 text-red-800">
                <div className="text-center p-8 border border-red-200 rounded-lg bg-white shadow-lg">
                    <h1 className="text-2xl font-bold mb-4">Application Error</h1>
                    <p className="mb-4">A critical error occurred and the application cannot continue.</p>
                    <pre className="p-4 bg-red-100 text-left rounded text-sm">{error}</pre>
                </div>
            </div>
        );
    }

    if (!isInitialized) {
        return (
             <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
                <Spinner className="w-12 h-12 text-blue-600" />
                <p className="mt-4 text-lg text-gray-600">Initializing Application...</p>
            </div>
        );
    }

    return (
        <ToastProvider>
            <div className="flex h-screen bg-gray-100 font-sans">
                <div className="flex flex-col w-64 bg-gray-800 text-white">
                    <div className="flex items-center justify-center h-20 border-b border-gray-700">
                        <h1 className="text-2xl font-bold">Candy Trace v0.5</h1>
                    </div>
                    <nav className="flex-1 px-4 py-4 space-y-2">
                        <NavItem icon={ChartBarIcon} label="Dashboard" isActive={view === 'dashboard'} onClick={() => setView('dashboard')} />
                        
                        <p className="px-4 pt-4 pb-2 text-xs font-bold text-gray-400 uppercase">Libraries</p>
                        <NavItem icon={PackageIcon} label="Candy Library" isActive={view === 'candies'} onClick={() => setView('candies')} count={state.pillLibrary.length} />
                        <NavItem icon={PaletteIcon} label="Style Library" isActive={view === 'styles'} onClick={() => setView('styles')} count={state.styleSets.length} />
                        <NavItem icon={ArchiveBoxIcon} label="Trace Archive" isActive={view === 'traceArchive'} onClick={() => setView('traceArchive')} count={state.traceArchive.length} />
                        <NavItem icon={CheckBadgeIcon} label="Approved Library" isActive={view === 'approvedLibrary'} onClick={() => setView('approvedLibrary')} count={state.traceArchive.filter(t => t.isApproved).length} />

                        <p className="px-4 pt-4 pb-2 text-xs font-bold text-gray-400 uppercase">Workflow</p>
                        <NavItem icon={ClipboardListIcon} label="Work Queue" isActive={view === 'work'} onClick={() => setView('work')} count={state.workPairs.length} />
                        <NavItem icon={BeakerIcon} label="Sandbox" isActive={view === 'sandbox'} onClick={() => setView('sandbox')} />
                        <NavItem icon={SettingsIcon} label="Settings" isActive={view === 'settings'} onClick={() => setView('settings')} />
                    </nav>
                </div>
                <main className="flex-1 overflow-y-auto">
                    {renderView()}
                </main>
            </div>
            <ToastContainer />
        </ToastProvider>
    );
};

export default App;