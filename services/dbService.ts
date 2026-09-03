import { type IDBPDatabase, openDB } from 'idb';
import { gcsService } from './gcsService';
import type { AppState, Pill, SandboxSessionData, SerializedSandboxSessionData, Settings, StoredTrace, StyleSet, WorkPair, UnsavedTrace, TraceabilityResult, WorkspaceBackup } from '../types';
import { INITIAL_SETTINGS, SYSTEM_INSTRUCTION } from '../constants';

export namespace dbService {
    const DB_NAME = 'pill-trace-db';
    const DB_VERSION = 10;
    const FILE_STORE = 'files';
    const PILL_LIBRARY_STORE = 'pill-library';
    const STYLE_SETS_STORE = 'style-sets';
    const TRACE_LOG_STORE = 'trace-log';
    const WORK_SESSION_STORE = 'meta';
    const WORKSPACE_BACKUPS_STORE = 'workspace-backups';

    const PILL_LIBRARY_KEY = 'pills';
    const STYLE_LIBRARY_KEY = 'library';
    const WORK_SESSION_KEY = 'manifest';
    const MANUAL_BACKUP_KEY = 'manual-backup';
    const SETTINGS_KEY = 'settings';
    const SANDBOX_SESSION_KEY = 'sandbox-session';

    let dbPromise: Promise<IDBPDatabase> | null = null;

    function getDb(): Promise<IDBPDatabase> {
      if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
          upgrade(db, oldVersion, newVersion, tx) {
            console.log(`Upgrading database from version ${oldVersion} to ${newVersion}...`);

            // Handle fresh install (oldVersion is 0)
            if (oldVersion === 0) {
                console.log("Performing initial database setup: creating all object stores.");
                db.createObjectStore(FILE_STORE);
                db.createObjectStore(WORK_SESSION_STORE);
                db.createObjectStore(STYLE_SETS_STORE);
                db.createObjectStore(PILL_LIBRARY_STORE);
                db.createObjectStore(TRACE_LOG_STORE, { keyPath: 'id' });
                db.createObjectStore(WORKSPACE_BACKUPS_STORE, { keyPath: 'id' });
                console.log("Initial database setup complete.");
                // No data migration is needed for a fresh install.
                return;
            }

            // --- Handle upgrades from existing versions ---

            // --- 1. Schema Migration: Handle store renames from versions < 9 ---
            if (oldVersion < 9) {
                // This logic is designed to be non-destructive. It copies data from old stores
                // to new stores but does NOT delete the old stores, maximizing data safety.
                const storesToMigrate = [
                    {
                        newName: PILL_LIBRARY_STORE, // 'pill-library'
                        oldNames: ['Pill Library', 'pill library'],
                        key: PILL_LIBRARY_KEY, // 'pills'
                        options: {},
                        copyLogic: 'key-value' as const
                    },
                    {
                        newName: STYLE_SETS_STORE, // 'style-sets'
                        oldNames: ['Style Library', 'style library'],
                        key: STYLE_LIBRARY_KEY, // 'library'
                        options: {},
                        copyLogic: 'key-value' as const
                    },
                    {
                        newName: TRACE_LOG_STORE, // 'trace-log'
                        oldNames: ['Trace Archive', 'trace archive'],
                        options: { keyPath: 'id' },
                        copyLogic: 'get-all' as const
                    },
                    {
                        newName: WORK_SESSION_STORE, // 'meta'
                        oldNames: ['Work Session', 'work session'],
                        options: {},
                        copyLogic: 'cursor' as const
                    }
                ];

                for (const definition of storesToMigrate) {
                    const oldStoreName = definition.oldNames.find(name => db.objectStoreNames.contains(name));
                    const newStoreExists = db.objectStoreNames.contains(definition.newName);

                    if (oldStoreName) {
                        console.log(`Found old store '${oldStoreName}'. Migrating data to '${definition.newName}'.`);
                        if (!newStoreExists) {
                            db.createObjectStore(definition.newName, definition.options);
                        }
                        
                        const oldStore = tx.objectStore(oldStoreName);
                        const newStore = tx.objectStore(definition.newName);

                        switch (definition.copyLogic) {
                            case 'key-value':
                                oldStore.get(definition.key!).then(data => {
                                    if (data) newStore.put(data, definition.key!);
                                });
                                break;
                            case 'get-all':
                                oldStore.getAll().then(items => {
                                    if (items) {
                                        for (const item of items) {
                                            newStore.put(item);
                                        }
                                    }
                                });
                                break;
                            case 'cursor':
                                oldStore.openCursor().then(function cursorIterate(cursor) {
                                    if (!cursor) return;
                                    newStore.put(cursor.value, cursor.key);
                                    cursor.continue().then(cursorIterate);
                                });
                                break;
                        }
                    } else if (!newStoreExists) {
                        // This case should only be hit if upgrading from an intermediate broken state.
                        console.log(`Creating missing store '${definition.newName}'.`);
                        db.createObjectStore(definition.newName, definition.options);
                    }
                }
            }
            
            // --- 2. Schema Migration for version 10 ---
            if (oldVersion < 10) {
                if (!db.objectStoreNames.contains(WORKSPACE_BACKUPS_STORE)) {
                    console.log(`Creating new store '${WORKSPACE_BACKUPS_STORE}'.`);
                    db.createObjectStore(WORKSPACE_BACKUPS_STORE, { keyPath: 'id' });
                }
            }

            // --- 3. Perform data structure migration (add new fields to existing data) ---
            // This runs on any upgrade path from v1+, as new fields might be added in any version.
            if (oldVersion < DB_VERSION) {
                console.log("Checking for data structure updates...");
                const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

                // Migrate Pill Library data structure
                (async () => {
                    const store = tx.objectStore(PILL_LIBRARY_STORE);
                    const oldPills = await store.get(PILL_LIBRARY_KEY);
                    if (oldPills && Array.isArray(oldPills)) {
                        const newPills = oldPills.map((p: any) => ({
                            ...p,
                            isDetailsExpanded: p.isDetailsExpanded ?? false,
                            traceabilityTestA: p.traceabilityTestA || initialTraceabilityResult,
                            traceabilityTestB: p.traceabilityTestB || initialTraceabilityResult,
                            guidedTraceabilityTestA: p.guidedTraceabilityTestA || initialTraceabilityResult,
                            guidedTraceabilityTestB: p.guidedTraceabilityTestB || initialTraceabilityResult,
                        }));
                        await store.put(newPills, PILL_LIBRARY_KEY);
                    }
                })();

                // Migrate Style Sets data structure
                (async () => {
                    const store = tx.objectStore(STYLE_SETS_STORE);
                    const oldStyles = await store.get(STYLE_LIBRARY_KEY);
                    if (oldStyles && Array.isArray(oldStyles)) {
                        const newStyles = oldStyles.map((s: any) => ({
                            ...s,
                            isDetailsExpanded: s.isDetailsExpanded ?? false,
                            similarityCheckStatus: s.similarityCheckStatus || 'idle',
                        }));
                        await store.put(newStyles, STYLE_LIBRARY_KEY);
                    }
                })();

                // Migrate Trace Archive data structure
                (async () => {
                    const store = tx.objectStore(TRACE_LOG_STORE);
                    const oldTraces = await store.getAll();
                    if (oldTraces && oldTraces.length > 0) {
                        for (const trace of oldTraces) {
                            const newTrace = {
                                ...trace,
                                isFavorite: (trace as any).isFavorite ?? false,
                                bucket: (trace as any).bucket ?? 'Unassigned',
                                testType: (trace as any).testType,
                            };
                            await store.put(newTrace);
                        }
                    }
                })();
            }
          },
          blocked() {
            console.error("Database connection blocked. Please close other tabs with this application open.");
            alert("This application requires a database update, but an older version is open in another tab. Please close all other tabs with this app and reload.");
          },
          blocking() {
            console.warn("Database connection is blocking a newer version. The connection will be closed.");
          },
          terminated() {
            console.warn("Database connection was terminated by the browser. It will be reopened on the next operation.");
            dbPromise = null;
          }
        });
      }
      return dbPromise;
    }

    async function saveFileLocal(file: File): Promise<string> {
        const db = await getDb();
        const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`; // Add random to avoid collisions
        await db.put(FILE_STORE, file, key);
        return key;
    }

    export async function overwriteLocalFile(key: string, file: File): Promise<void> {
        const db = await getDb();
        await db.put(FILE_STORE, file, key);
    }
    
    export async function deleteLocalFile(key: string): Promise<void> {
        const db = await getDb();
        await db.delete(FILE_STORE, key);
    }

    export async function getFileLocal(key: string): Promise<File | undefined> {
        const db = await getDb();
        return await db.get(FILE_STORE, key);
    }

    export async function saveSettingsLocal(settings: Settings) {
        const db = await getDb();
        await db.put(WORK_SESSION_STORE, settings, SETTINGS_KEY);
    }

    export async function getSettingsLocal(): Promise<Partial<Settings> | null> {
        const db = await getDb();
        return await db.get(WORK_SESSION_STORE, SETTINGS_KEY);
    }

    export async function savePillLibrary(pills: Pill[], settings: Settings) {
        if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            return gcsService.savePillLibrary(pills, settings);
        }
        const db = await getDb();
        const serializablePills = await Promise.all(pills.map(async (p) => {
            const aOrigKey = p.A.originalFile ? await saveFileLocal(p.A.originalFile) : undefined;
            const bOrigKey = p.B.originalFile ? await saveFileLocal(p.B.originalFile) : undefined;
            return { ...p, A: { originalFile: aOrigKey }, B: { originalFile: bOrigKey } };
        }));
        await db.put(PILL_LIBRARY_STORE, serializablePills, PILL_LIBRARY_KEY);
    }

    export async function getPillLibrary(settings: Settings): Promise<Pill[]> {
        if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            return gcsService.getPillLibrary(settings);
        }
        const db = await getDb();
        const manifest = await db.get(PILL_LIBRARY_STORE, PILL_LIBRARY_KEY);
        if (!manifest) return [];

        const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

        return await Promise.all((manifest || []).map(async (p: any) => {
            const aOrig = p.A.originalFile ? await getFileLocal(p.A.originalFile) : undefined;
            const bOrig = p.B.originalFile ? await getFileLocal(p.B.originalFile) : undefined;
            return {
                ...p,
                selected: p.selected ?? false,
                isDetailsExpanded: p.isDetailsExpanded ?? false,
                bucket: p.bucket || 'Unassigned',
                classificationStatus: p.classificationStatus || 'idle',
                traceStatus: p.traceStatus || 'Untraced',
                qualityAnalysisStatus: p.qualityAnalysisStatus || 'idle',
                traceabilityTestA: p.traceabilityTestA || initialTraceabilityResult,
                traceabilityTestB: p.traceabilityTestB || initialTraceabilityResult,
                guidedTraceabilityTestA: p.guidedTraceabilityTestA || initialTraceabilityResult,
                guidedTraceabilityTestB: p.guidedTraceabilityTestB || initialTraceabilityResult,
                A: { ...p.A, originalFile: aOrig },
                B: { ...p.B, originalFile: bOrig }
            };
        }));
    }

    export async function saveStyleSets(styleSets: StyleSet[], settings: Settings) {
        if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            return gcsService.saveStyleSets(styleSets, settings);
        }
        const db = await getDb();
        const serializableStyleSets = await Promise.all(styleSets.map(async (ss) => {
            const aPhotoKey = ss.A.photoFile ? await saveFileLocal(ss.A.photoFile) : undefined;
            const aTraceKey = ss.A.traceFile ? await saveFileLocal(ss.A.traceFile) : undefined;
            const bPhotoKey = ss.B.photoFile ? await saveFileLocal(ss.B.photoFile) : undefined;
            const bTraceKey = ss.B.traceFile ? await saveFileLocal(ss.B.traceFile) : undefined;
            return { ...ss, A: { ...ss.A, photoFile: aPhotoKey, traceFile: aTraceKey }, B: { ...ss.B, photoFile: bPhotoKey, traceFile: bTraceKey }};
        }));
        await db.put(STYLE_SETS_STORE, serializableStyleSets, STYLE_LIBRARY_KEY);
    }

    export async function getStyleSets(settings: Settings): Promise<StyleSet[]> {
         if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            return gcsService.getStyleSets(settings);
        }
        const db = await getDb();
        const manifest = await db.get(STYLE_SETS_STORE, STYLE_LIBRARY_KEY);
        if (!manifest) return [];
        return await Promise.all((manifest || []).map(async (ss: any) => {
            const aPhoto = ss.A.photoFile ? await getFileLocal(ss.A.photoFile) : undefined;
            const aTrace = ss.A.traceFile ? await getFileLocal(ss.A.traceFile) : undefined;
            const bPhoto = ss.B.photoFile ? await getFileLocal(ss.B.photoFile) : undefined;
            const bTrace = ss.B.traceFile ? await getFileLocal(ss.B.traceFile) : undefined;
            return {
                ...ss,
                selected: ss.selected ?? false,
                isDetailsExpanded: ss.isDetailsExpanded ?? false,
                bucket: ss.bucket || 'Unassigned',
                classificationStatus: ss.classificationStatus || 'idle',
                similarityCheckStatus: ss.similarityCheckStatus || 'idle',
                active: ss.active ?? true,
                A: { ...ss.A, photoFile: aPhoto, traceFile: aTrace },
                B: { ...ss.B, photoFile: bPhoto, traceFile: bTrace }
            };
        }));
    }

    export async function saveWorkSession(workPairs: WorkPair[], settings: Settings) {
         if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            await gcsService.saveWorkSession(workPairs, settings);
            return gcsService.saveSettings(settings);
        }
        const db = await getDb();
        const serializableWorkPairs = await Promise.all(workPairs.map(async (wp) => {
            const aOrigKey = wp.A.originalFile ? await saveFileLocal(wp.A.originalFile) : undefined;
            const bOrigKey = wp.B.originalFile ? await saveFileLocal(wp.B.originalFile) : undefined;
            return { ...wp, A: { ...wp.A, originalFile: aOrigKey }, B: { ...wp.B, originalFile: bOrigKey } };
        }));
        await db.put(WORK_SESSION_STORE, { workPairs: serializableWorkPairs, settings }, WORK_SESSION_KEY);
    }

    export async function restoreWorkSession(settings: Settings): Promise<{ workPairs: WorkPair[]; settings: Settings; } | null> {
        if (settings.gcsEnabled && settings.gcsBucketName && settings.gcsApiKey) {
            const [workPairs, gcsSettings] = await Promise.all([
                gcsService.restoreWorkSession(settings),
                gcsService.restoreSettings(settings)
            ]);
            if (!workPairs && !gcsSettings) return null;
            const mergedSettings = { ...settings, ...gcsSettings };
            return { workPairs: workPairs || [], settings: mergedSettings };
        }
        const db = await getDb();
        const manifest = await db.get(WORK_SESSION_STORE, WORK_SESSION_KEY);
        if (!manifest) return null;
        const workPairs: WorkPair[] = await Promise.all((manifest.workPairs || []).map(async (wp: any) => {
            const aOrig = wp.A.originalFile ? await getFileLocal(wp.A.originalFile) : undefined;
            const bOrig = wp.B.originalFile ? await getFileLocal(wp.B.originalFile) : undefined;
            return {
                ...wp,
                A: { ...wp.A, originalFile: aOrig, styleRefIds: wp.A.styleRefIds || [] },
                B: { ...wp.B, originalFile: bOrig, styleRefIds: wp.B.styleRefIds || [] }
            };
        }));
        return { workPairs, settings: manifest.settings };
    }

    export async function saveSandboxSession(session: SandboxSessionData) {
        const db = await getDb();
        const candyPhotoKey = session.candyPhoto ? await saveFileLocal(session.candyPhoto) : undefined;
        const styleTraceKeys = await Promise.all(session.styleTraces.map(f => saveFileLocal(f)));
        
        const serializableSession: SerializedSandboxSessionData = {
            candyPhotoKey,
            styleTraceKeys,
            mainPrompt: session.mainPrompt,
            systemInstruction: session.systemInstruction,
            sessionTurns: session.sessionTurns
        };
        await db.put(WORK_SESSION_STORE, serializableSession, SANDBOX_SESSION_KEY);
    }

    export async function restoreSandboxSession(): Promise<SandboxSessionData | null> {
        const db = await getDb();
        const manifest = await db.get(WORK_SESSION_STORE, SANDBOX_SESSION_KEY) as SerializedSandboxSessionData;
        if (!manifest) return null;

        const candyPhoto = manifest.candyPhotoKey ? await getFileLocal(manifest.candyPhotoKey) : null;
        const loadedTraceFiles = await Promise.all((manifest.styleTraceKeys || []).map(key => getFileLocal(key)));
        const styleTraces = loadedTraceFiles.filter((f): f is File => !!f); // Filter out any undefined files

        return {
            candyPhoto: candyPhoto || null,
            styleTraces,
            mainPrompt: manifest.mainPrompt,
            systemInstruction: manifest.systemInstruction || SYSTEM_INSTRUCTION,
            sessionTurns: manifest.sessionTurns || []
        };
    }

    export async function saveNamedBackup(name: string, state: AppState): Promise<WorkspaceBackup> {
        const db = await getDb();
        
        const serializablePills = await Promise.all(state.pillLibrary.map(async (p) => {
            const aOrigKey = p.A.originalFile ? await saveFileLocal(p.A.originalFile) : undefined;
            const bOrigKey = p.B.originalFile ? await saveFileLocal(p.B.originalFile) : undefined;
            return { ...p, A: { originalFile: aOrigKey }, B: { originalFile: bOrigKey } };
        }));
        const serializableStyleSets = await Promise.all(state.styleSets.map(async (ss) => {
            const aPhotoKey = ss.A.photoFile ? await saveFileLocal(ss.A.photoFile) : undefined;
            const aTraceKey = ss.A.traceFile ? await saveFileLocal(ss.A.traceFile) : undefined;
            const bPhotoKey = ss.B.photoFile ? await saveFileLocal(ss.B.photoFile) : undefined;
            const bTraceKey = ss.B.traceFile ? await saveFileLocal(ss.B.traceFile) : undefined;
            return { ...ss, A: { ...ss.A, photoFile: aPhotoKey, traceFile: aTraceKey }, B: { ...ss.B, photoFile: bPhotoKey, traceFile: bTraceKey }};
        }));
        const serializableWorkPairs = await Promise.all(state.workPairs.map(async (wp) => {
            const aOrigKey = wp.A.originalFile ? await saveFileLocal(wp.A.originalFile) : undefined;
            const bOrigKey = wp.B.originalFile ? await saveFileLocal(wp.B.originalFile) : undefined;
            return { ...wp, A: { ...wp.A, originalFile: aOrigKey }, B: { ...wp.B, originalFile: bOrigKey }};
        }));
        const serializableTraces = await Promise.all(state.traceArchive.map(async (t) => {
            const traceKey = await saveFileLocal(await getFileLocal(t.traceImageKey) as File);
            const candyKey = await saveFileLocal(await getFileLocal(t.candyImageKey) as File);
            return { ...t, traceImageKey: traceKey, candyImageKey: candyKey };
        }));

        const manifest = { 
            ...state, 
            pillLibrary: serializablePills, 
            styleSets: serializableStyleSets, 
            workPairs: serializableWorkPairs, 
            traceArchive: serializableTraces,
            log: [], 
            processingQueue: [], 
            lastSessionSave: null, 
            sandboxInitialData: null 
        };
        
        const backupRecord = {
            id: `backup_${Date.now()}`,
            name,
            timestamp: Date.now(),
            manifest,
        };
    
        await db.put(WORKSPACE_BACKUPS_STORE, backupRecord);
        
        return { id: backupRecord.id, name: backupRecord.name, timestamp: backupRecord.timestamp };
    }

    export async function getNamedBackups(): Promise<WorkspaceBackup[]> {
        const db = await getDb();
        const allRecords = await db.getAll(WORKSPACE_BACKUPS_STORE);
        return allRecords
            .map(({ manifest, ...rest }: any) => rest) // Exclude the large manifest data
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    export async function restoreNamedBackup(id: string): Promise<AppState | null> {
        const db = await getDb();
        const backupRecord = await db.get(WORKSPACE_BACKUPS_STORE, id);
        if (!backupRecord || !backupRecord.manifest) return null;
        
        let manifest = backupRecord.manifest;

        // --- MIGRATION LOGIC FOR OLD BACKUPS ---
        const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

        const migratedPills = (manifest.pillLibrary || []).map((p: any) => ({
            ...p,
            selected: p.selected ?? false,
            isDetailsExpanded: p.isDetailsExpanded ?? false,
            bucket: p.bucket || 'Unassigned',
            classificationStatus: p.classificationStatus || 'idle',
            traceStatus: p.traceStatus || 'Untraced',
            qualityAnalysisStatus: p.qualityAnalysisStatus || 'idle',
            traceabilityTestA: p.traceabilityTestA || initialTraceabilityResult,
            traceabilityTestB: p.traceabilityTestB || initialTraceabilityResult,
            guidedTraceabilityTestA: p.guidedTraceabilityTestA || initialTraceabilityResult,
            guidedTraceabilityTestB: p.guidedTraceabilityTestB || initialTraceabilityResult,
        }));

        const migratedStyles = (manifest.styleSets || []).map((s: any) => ({
            ...s,
            selected: s.selected ?? false,
            isDetailsExpanded: s.isDetailsExpanded ?? false,
            bucket: s.bucket || 'Unassigned',
            classificationStatus: s.classificationStatus || 'idle',
            similarityCheckStatus: s.similarityCheckStatus || 'idle',
            active: s.active ?? true,
        }));

        const migratedTraces = (manifest.traceArchive || []).map((t: any) => ({
            ...t,
            isFavorite: t.isFavorite ?? false,
            bucket: t.bucket ?? 'Unassigned',
            isApproved: t.isApproved ?? false,
            testType: t.testType,
        }));

        const migratedSettings = { ...INITIAL_SETTINGS, ...manifest.settings };

        const migratedManifest = {
            ...manifest,
            pillLibrary: migratedPills,
            styleSets: migratedStyles,
            traceArchive: migratedTraces,
            settings: migratedSettings
        };
        // --- END MIGRATION ---

        const pills = await Promise.all((migratedManifest.pillLibrary || []).map(async (p: any) => {
            const aOrig = p.A.originalFile ? await getFileLocal(p.A.originalFile) : undefined;
            const bOrig = p.B.originalFile ? await getFileLocal(p.B.originalFile) : undefined;
            return { ...p, A: { originalFile: aOrig }, B: { originalFile: bOrig } };
        }));
        const styleSets = await Promise.all((migratedManifest.styleSets || []).map(async (ss: any) => {
            const aPhoto = ss.A.photoFile ? await getFileLocal(ss.A.photoFile) : undefined;
            const aTrace = ss.A.traceFile ? await getFileLocal(ss.A.traceFile) : undefined;
            const bPhoto = ss.B.photoFile ? await getFileLocal(ss.B.photoFile) : undefined;
            const bTrace = ss.B.traceFile ? await getFileLocal(ss.B.traceFile) : undefined;
            return { ...ss, A: { ...ss.A, photoFile: aPhoto, traceFile: aTrace }, B: { ...ss.B, photoFile: bPhoto, traceFile: bTrace } };
        }));
        const workPairs = await Promise.all((migratedManifest.workPairs || []).map(async (wp: any) => {
            const aOrig = wp.A.originalFile ? await getFileLocal(wp.A.originalFile) : undefined;
            const bOrig = wp.B.originalFile ? await getFileLocal(wp.B.originalFile) : undefined;
            return { ...wp, A: { ...wp.A, originalFile: aOrig }, B: { ...wp.B, originalFile: bOrig } };
        }));
        
        const traces = migratedManifest.traceArchive;

        return { ...migratedManifest, pillLibrary: pills, styleSets, workPairs, traceArchive: traces };
    }

    export async function deleteNamedBackup(id: string): Promise<void> {
        const db = await getDb();
        // Note: This does not garbage collect the files from the file store to avoid complexity.
        await db.delete(WORKSPACE_BACKUPS_STORE, id);
    }

    export async function saveManualBackup(state: AppState) {
        const db = await getDb();
        const serializablePills = await Promise.all(state.pillLibrary.map(async (p) => {
            const aOrigKey = p.A.originalFile ? await saveFileLocal(p.A.originalFile) : undefined;
            const bOrigKey = p.B.originalFile ? await saveFileLocal(p.B.originalFile) : undefined;
            return { ...p, A: { originalFile: aOrigKey }, B: { originalFile: bOrigKey } };
        }));
        const serializableStyleSets = await Promise.all(state.styleSets.map(async (ss) => {
            const aPhotoKey = ss.A.photoFile ? await saveFileLocal(ss.A.photoFile) : undefined;
            const aTraceKey = ss.A.traceFile ? await saveFileLocal(ss.A.traceFile) : undefined;
            const bPhotoKey = ss.B.photoFile ? await saveFileLocal(ss.B.photoFile) : undefined;
            const bTraceKey = ss.B.traceFile ? await saveFileLocal(ss.B.traceFile) : undefined;
            return { ...ss, A: { ...ss.A, photoFile: aPhotoKey, traceFile: aTraceKey }, B: { ...ss.B, photoFile: bPhotoKey, traceFile: bTraceKey }};
        }));
        const serializableWorkPairs = await Promise.all(state.workPairs.map(async (wp) => {
            const aOrigKey = wp.A.originalFile ? await saveFileLocal(wp.A.originalFile) : undefined;
            const bOrigKey = wp.B.originalFile ? await saveFileLocal(wp.B.originalFile) : undefined;
            return { ...wp, A: { ...wp.A, originalFile: aOrigKey }, B: { ...wp.B, originalFile: bOrigKey }};
        }));

        const manifest = { ...state, pillLibrary: serializablePills, styleSets: serializableStyleSets, workPairs: serializableWorkPairs, log: [], processingQueue: [], lastSessionSave: null, sandboxInitialData: null };
        await db.put(WORK_SESSION_STORE, manifest, MANUAL_BACKUP_KEY);
    }

    export async function restoreManualBackup(): Promise<AppState | null> {
        const db = await getDb();
        let manifest = await db.get(WORK_SESSION_STORE, MANUAL_BACKUP_KEY);
        if (!manifest) return null;

        // --- MIGRATION LOGIC FOR OLD BACKUPS ---
        const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

        const migratedPills = (manifest.pillLibrary || []).map((p: any) => ({
            ...p,
            selected: p.selected ?? false,
            isDetailsExpanded: p.isDetailsExpanded ?? false,
            bucket: p.bucket || 'Unassigned',
            classificationStatus: p.classificationStatus || 'idle',
            traceStatus: p.traceStatus || 'Untraced',
            qualityAnalysisStatus: p.qualityAnalysisStatus || 'idle',
            traceabilityTestA: p.traceabilityTestA || initialTraceabilityResult,
            traceabilityTestB: p.traceabilityTestB || initialTraceabilityResult,
            guidedTraceabilityTestA: p.guidedTraceabilityTestA || initialTraceabilityResult,
            guidedTraceabilityTestB: p.guidedTraceabilityTestB || initialTraceabilityResult,
        }));

        const migratedStyles = (manifest.styleSets || []).map((s: any) => ({
            ...s,
            selected: s.selected ?? false,
            isDetailsExpanded: s.isDetailsExpanded ?? false,
            bucket: s.bucket || 'Unassigned',
            classificationStatus: s.classificationStatus || 'idle',
            similarityCheckStatus: s.similarityCheckStatus || 'idle',
            active: s.active ?? true,
        }));

        const migratedTraces = (manifest.traceArchive || []).map((t: any) => ({
            ...t,
            isFavorite: t.isFavorite ?? false,
            bucket: t.bucket ?? 'Unassigned',
            isApproved: t.isApproved ?? false,
            testType: t.testType,
        }));

        const migratedSettings = { ...INITIAL_SETTINGS, ...manifest.settings };

        const migratedManifest = {
            ...manifest,
            pillLibrary: migratedPills,
            styleSets: migratedStyles,
            traceArchive: migratedTraces,
            settings: migratedSettings
        };
        // --- END MIGRATION ---

        const pills = await Promise.all((migratedManifest.pillLibrary || []).map(async (p: any) => {
            const aOrig = p.A.originalFile ? await getFileLocal(p.A.originalFile) : undefined;
            const bOrig = p.B.originalFile ? await getFileLocal(p.B.originalFile) : undefined;
            return { ...p, A: { originalFile: aOrig }, B: { originalFile: bOrig } };
        }));
        const styleSets = await Promise.all((migratedManifest.styleSets || []).map(async (ss: any) => {
            const aPhoto = ss.A.photoFile ? await getFileLocal(ss.A.photoFile) : undefined;
            const aTrace = ss.A.traceFile ? await getFileLocal(ss.A.traceFile) : undefined;
            const bPhoto = ss.B.photoFile ? await getFileLocal(ss.B.photoFile) : undefined;
            const bTrace = ss.B.traceFile ? await getFileLocal(ss.B.traceFile) : undefined;
            return { ...ss, A: { ...ss.A, photoFile: aPhoto, traceFile: aTrace }, B: { ...ss.B, photoFile: bPhoto, traceFile: bTrace } };
        }));
        const workPairs = await Promise.all((migratedManifest.workPairs || []).map(async (wp: any) => {
            const aOrig = wp.A.originalFile ? await getFileLocal(wp.A.originalFile) : undefined;
            const bOrig = wp.B.originalFile ? await getFileLocal(wp.B.originalFile) : undefined;
            return { ...wp, A: { ...wp.A, originalFile: aOrig }, B: { ...wp.B, originalFile: bOrig } };
        }));
        
        const traces = migratedManifest.traceArchive;

        return { ...migratedManifest, pillLibrary: pills, styleSets, workPairs, traceArchive: traces };
    }

    export async function saveTrace(traceData: UnsavedTrace): Promise<StoredTrace> {
        const db = await getDb();
        const traceImageKey = await saveFileLocal(traceData.traceImageFile);
        const candyImageKey = await saveFileLocal(traceData.candyImageFile);

        const storedTrace: StoredTrace = {
            id: traceData.id,
            timestamp: traceData.timestamp,
            candyName: traceData.candyName,
            side: traceData.side,
            traceImageKey,
            candyImageKey,
            prompt: traceData.prompt,
            promptName: traceData.promptName,
            styleRefIds: traceData.styleRefIds,
            durationMs: traceData.durationMs,
            selected: false,
            origin: traceData.origin,
            systemInstruction: traceData.systemInstruction,
            bucket: traceData.bucket ?? 'Unassigned',
            isFavorite: traceData.isFavorite ?? false,
            isApproved: traceData.isApproved ?? false,
            testType: traceData.testType,
        };

        await db.put(TRACE_LOG_STORE, storedTrace);
        return storedTrace;
    }

    export async function getTraces(): Promise<StoredTrace[]> {
        const db = await getDb();
        const traces: StoredTrace[] = await db.getAll(TRACE_LOG_STORE);
        return traces.map(t => ({...t, isFavorite: t.isFavorite ?? false, isApproved: t.isApproved ?? false})).sort((a, b) => b.timestamp - a.timestamp);
    }
    
    export async function updateTrace(traceUpdate: Partial<StoredTrace> & { id: string }): Promise<void> {
        const db = await getDb();
        const tx = db.transaction(TRACE_LOG_STORE, 'readwrite');
        const store = tx.objectStore(TRACE_LOG_STORE);
        const existingTrace = await store.get(traceUpdate.id);
        if (existingTrace) {
            const updatedTrace = { ...existingTrace, ...traceUpdate };
            await store.put(updatedTrace);
        } else {
            console.warn(`updateTrace: Trace with id ${traceUpdate.id} not found.`);
        }
        await tx.done;
    }

    export async function deleteTrace(id: string): Promise<void> {
        const db = await getDb();
        const trace = await db.get(TRACE_LOG_STORE, id) as StoredTrace | undefined;
        if (trace) {
            await db.delete(FILE_STORE, trace.traceImageKey);
            await db.delete(FILE_STORE, trace.candyImageKey);
        }
        await db.delete(TRACE_LOG_STORE, id);
    }

    export async function clearAllData() {
        const db = await getDb();
        await Promise.all(Array.from(db.objectStoreNames).map(name => db.clear(name as any)));
    }
    
    export namespace recovery {
        export type RawScanResult = {
            id: string;
            source: 'indexedDB' | 'localStorage';
            dbName: string; 
            storeName: string; 
            itemCount: number;
            dataPreview: string; // JSON string of a sample item
        };
        
        export async function fullRawStorageScan(): Promise<{ results: RawScanResult[], logs: string[] }> {
            const results: RawScanResult[] = [];
            const logs: string[] = [];
    
            logs.push("Starting IndexedDB scan...");
            if (!window.indexedDB?.databases) {
                logs.push("WARNING: `indexedDB.databases()` is not supported. Cannot scan for other databases.");
            } else {
                try {
                    const dbs = await window.indexedDB.databases();
                    logs.push(`Found ${dbs.length} IndexedDB database(s) for this origin.`);
    
                    for (const dbInfo of dbs) {
                        if (!dbInfo.name) continue;
                        logs.push(`Inspecting database: "${dbInfo.name}"...`);
    
                        try {
                            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                                const request = window.indexedDB.open(dbInfo.name!);
                                request.onsuccess = () => resolve(request.result);
                                request.onerror = () => reject(`Error opening DB: ${request.error?.message}`);
                                request.onblocked = () => reject('Blocked from opening DB.');
                            });
                            
                            logs.push(` -> Successfully opened "${db.name}". Found stores: [${Array.from(db.objectStoreNames).join(', ')}]`);
    
                            for (const storeName of Array.from(db.objectStoreNames)) {
                                logs.push(` -> Reading data from store: "${storeName}"...`);
                                try {
                                    const allData = await new Promise<any[]>((resolve, reject) => {
                                        const tx = db.transaction(storeName, 'readonly');
                                        const store = tx.objectStore(storeName);
                                        const req = store.getAll();
                                        req.onsuccess = () => resolve(req.result);
                                        req.onerror = () => reject(`Failed to getAll from store: ${req.error?.message}`);
                                    });
    
                                    if (!allData || allData.length === 0) {
                                        logs.push(` -> Store "${storeName}" is empty.`);
                                        continue;
                                    }
    
                                    let previewObject: any = null;
                                    let itemCount = 0;
                                    if (allData.length === 1 && Array.isArray(allData[0])) {
                                        itemCount = allData[0].length;
                                        if (itemCount > 0) previewObject = allData[0][0];
                                    } else {
                                        itemCount = allData.length;
                                        previewObject = allData[0];
                                    }
    
                                    if (itemCount === 0) {
                                        logs.push(` -> Store "${storeName}" contains a wrapper but no data.`);
                                        continue;
                                    }
    
                                    const dataPreview = previewObject ? JSON.stringify(previewObject, null, 2) : '[Non-JSON or unreadable data]';
                                    results.push({
                                        id: `idb_${dbInfo.name}_${storeName}`,
                                        source: 'indexedDB', dbName: dbInfo.name, storeName, itemCount,
                                        dataPreview: dataPreview.substring(0, 500) + (dataPreview.length > 500 ? '...' : '')
                                    });
                                    logs.push(` -> Found store "${storeName}" with ${itemCount} potential item(s).`);
                                } catch (storeError) {
                                    logs.push(` -> ERROR: Could not read from store "${storeName}": ${String(storeError)}`);
                                }
                            }
                            db.close();
                        } catch (error) {
                            logs.push(` -> ERROR: Could not open or inspect database "${dbInfo.name}": ${String(error)}`);
                        }
                    }
                } catch (error) {
                    logs.push(`FATAL ERROR during IndexedDB scan: ${String(error)}`);
                }
            }
            logs.push("IndexedDB scan complete.");
    
            logs.push("Starting localStorage scan...");
            try {
                if (window.localStorage && window.localStorage.length > 0) {
                    logs.push(`Found ${window.localStorage.length} item(s) in localStorage.`);
                    for (let i = 0; i < window.localStorage.length; i++) {
                        const key = window.localStorage.key(i);
                        if (!key) continue;
                        const value = window.localStorage.getItem(key);
                        if (!value) continue;
                        
                        try {
                            const data = JSON.parse(value);
                            if (Array.isArray(data) && data.length > 0) {
                                const preview = JSON.stringify(data[0], null, 2);
                                results.push({
                                    id: `ls_${key}`,
                                    source: 'localStorage', dbName: 'localStorage', storeName: key, itemCount: data.length,
                                    dataPreview: preview.substring(0, 500) + (preview.length > 500 ? '...' : '')
                                });
                                logs.push(` -> Found potential data in localStorage key: "${key}"`);
                            }
                        } catch (e) { /* Ignore non-JSON items */ }
                    }
                } else {
                    logs.push("localStorage is empty or unavailable.");
                }
            } catch(e) {
                logs.push(`ERROR accessing localStorage: ${String(e)}`);
            }
            logs.push("localStorage scan complete.");
    
            return { results, logs };
        }

        async function getRawLegacyData(result: Pick<RawScanResult, 'source' | 'dbName' | 'storeName'>): Promise<any[]> {
            const { source, dbName, storeName } = result;
            if (source === 'localStorage') {
                return new Promise((resolve, reject) => {
                    const value = window.localStorage.getItem(storeName);
                    if (value) {
                        try {
                            const data = JSON.parse(value);
                            resolve(Array.isArray(data) ? data : []);
                        } catch (e) { reject(`Failed to parse localStorage item: ${storeName}`); }
                    } else { reject(`localStorage item not found: ${storeName}`); }
                });
            }

            return new Promise((resolve, reject) => {
                const request = window.indexedDB.open(dbName);
                request.onerror = () => reject(`DB error for ${dbName}: ${request.error?.message}`);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);
                    const req = store.getAll();
                    
                    req.onsuccess = () => {
                        const data = req.result;
                        db.close();
                        if (data && data.length === 1 && Array.isArray(data[0])) {
                            resolve(data[0] || []);
                        } else {
                            resolve(data || []);
                        }
                    };
                    req.onerror = () => { db.close(); reject(new Error(`Failed to read from '${storeName}'.`)); };
                };
            });
        }
        
        export async function runMigration(result: Pick<RawScanResult, 'source' | 'dbName' | 'storeName'>, recoverAs: 'pills' | 'styles' | 'traces'): Promise<number> {
            const db = await getDb();
            const legacyData = await getRawLegacyData(result);
            if (!legacyData || !Array.isArray(legacyData) || legacyData.length === 0) return 0;
            
            let itemsAdded = 0;

            if (recoverAs === 'pills') {
                const tx = db.transaction(PILL_LIBRARY_STORE, 'readwrite');
                const currentPills: Pill[] = (await tx.store.get(PILL_LIBRARY_KEY)) || [];
                const currentNames = new Set(currentPills.map(p => p.name));
                const newPills = legacyData.filter((p: any) => p && p.name && !currentNames.has(p.name))
                    .map((p: any) => ({
                        id: p.id || `migrated_${p.name}_${Date.now()}`, name: p.name, selected: false, isDetailsExpanded: false,
                        bucket: p.bucket || 'Unassigned', classificationStatus: p.classificationStatus || 'idle',
                        traceStatus: p.traceStatus || 'Untraced', qualityAnalysisStatus: p.qualityAnalysisStatus || 'idle',
                        traceabilityTestA: { status: 'idle' }, traceabilityTestB: { status: 'idle' },
                        guidedTraceabilityTestA: { status: 'idle' }, guidedTraceabilityTestB: { status: 'idle' },
                        A: p.A || {}, B: p.B || {}
                    } as Pill));
                if (newPills.length > 0) {
                    await tx.store.put([...currentPills, ...newPills], PILL_LIBRARY_KEY);
                    itemsAdded = newPills.length;
                }
                await tx.done;
            }
            else if (recoverAs === 'styles') {
                const tx = db.transaction(STYLE_SETS_STORE, 'readwrite');
                const currentStyles: StyleSet[] = (await tx.store.get(STYLE_LIBRARY_KEY)) || [];
                const currentNames = new Set(currentStyles.map(s => s.name));
                const newStyles = legacyData.filter((s: any) => s && s.name && !currentNames.has(s.name))
                    .map((s: any) => ({
                        id: s.id || `migrated_${s.name}_${Date.now()}`, name: s.name, bucket: s.bucket || 'Unassigned',
                        active: s.active ?? true, selected: false, isDetailsExpanded: false, classificationStatus: s.classificationStatus || 'idle',
                        similarityCheckStatus: s.similarityCheckStatus || 'idle', A: s.A || {}, B: s.B || {}
                    } as StyleSet));
                if (newStyles.length > 0) {
                    await tx.store.put([...currentStyles, ...newStyles], STYLE_LIBRARY_KEY);
                    itemsAdded = newStyles.length;
                }
                await tx.done;
            }
            else if (recoverAs === 'traces') {
                const tx = db.transaction(TRACE_LOG_STORE, 'readwrite');
                const currentIds = new Set(await tx.store.getAllKeys());
                const newTraces = legacyData.filter((t: any) => t && t.id && !currentIds.has(t.id))
                    .map((t: any) => ({
                        ...t, selected: false, isFavorite: t.isFavorite ?? false, isApproved: t.isApproved ?? false
                    }));
                if (newTraces.length > 0) {
                    for (const trace of newTraces) await tx.store.put(trace);
                    itemsAdded = newTraces.length;
                }
                await tx.done;
            }
            return itemsAdded;
        }
    }
}