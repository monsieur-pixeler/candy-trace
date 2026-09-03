import JSZip from 'jszip';
import saveAs from 'file-saver';
import { dbService } from './dbService';
// Fix: Add SerializedWorkSide to the type import to resolve 'Cannot find name' error.
import type { AppState, BackupManifest, Pill, SerializedPill, SerializedSide, SerializedStoredTrace, SerializedStyleSet, SerializedWorkPair, SerializedWorkSide, StoredTrace, StyleSet, WorkPair, WorkSide, TraceabilityResult } from '../types';
import { dataUrlToFile } from '../utils/fileUtils';

export namespace backupService {

    const MANIFEST_FILENAME = 'manifest.json';
    const CURRENT_BACKUP_VERSION = '0.5.0';

    export async function exportFullWorkspace(state: AppState): Promise<void> {
        const zip = new JSZip();
        
        // Serialize Pills and add files
        const serializedPills: SerializedPill[] = [];
        for (const pill of state.pillLibrary) {
            const serializedA: { originalFile?: string } = {};
            const serializedB: { originalFile?: string } = {};

            if (pill.A.originalFile) {
                const path = `pills/${pill.id}/A_${pill.A.originalFile.name}`;
                zip.file(path, pill.A.originalFile);
                serializedA.originalFile = path;
            }
            if (pill.B.originalFile) {
                const path = `pills/${pill.id}/B_${pill.B.originalFile.name}`;
                zip.file(path, pill.B.originalFile);
                serializedB.originalFile = path;
            }
            
            const { A, B, selected, isDetailsExpanded, approvalStatus, latestTraceA, latestTraceB, ...rest } = pill;
            serializedPills.push({ ...rest, A: serializedA, B: serializedB });
        }

        // Serialize Style Sets and add files
        const serializedStyleSets: SerializedStyleSet[] = [];
        for (const style of state.styleSets) {
            const serializedA: SerializedSide = {};
            const serializedB: SerializedSide = {};

            if (style.A.photoFile) {
                const path = `styles/${style.id}/A_photo_${style.A.photoFile.name}`;
                zip.file(path, style.A.photoFile);
                serializedA.photoFile = path;
            }
            if (style.A.traceFile) {
                const path = `styles/${style.id}/A_trace_${style.A.traceFile.name}`;
                zip.file(path, style.A.traceFile);
                serializedA.traceFile = path;
            }
            if (style.B.photoFile) {
                const path = `styles/${style.id}/B_photo_${style.B.photoFile.name}`;
                zip.file(path, style.B.photoFile);
                serializedB.photoFile = path;
            }
            if (style.B.traceFile) {
                const path = `styles/${style.id}/B_trace_${style.B.traceFile.name}`;
                zip.file(path, style.B.traceFile);
                serializedB.traceFile = path;
            }
            const { A, B, selected, isDetailsExpanded, ...rest } = style;
            serializedStyleSets.push({ ...rest, A: serializedA, B: serializedB });
        }
        
        // Serialize Work Pairs and add files
        const serializedWorkPairs: SerializedWorkPair[] = [];
        for (const work of state.workPairs) {
            const serializeSide = async (side: 'A' | 'B'): Promise<SerializedWorkSide> => {
                const workSide = work[side];
                const { originalFile, pngUrl, stage1PngUrl, ...rest } = workSide;

                const serialized: any = { ...rest };

                if (originalFile) {
                    const path = `work/${work.id}/${side}_${originalFile.name}`;
                    zip.file(path, originalFile);
                    serialized.originalFile = path;
                }

                if (pngUrl && pngUrl.startsWith('data:')) {
                    const file = await dataUrlToFile(pngUrl, `${side}_trace.png`);
                    const path = `work/${work.id}/${side}_trace.png`;
                    zip.file(path, file);
                    serialized.pngUrl = path;
                } else {
                    serialized.pngUrl = pngUrl;
                }

                if (stage1PngUrl && stage1PngUrl.startsWith('data:')) {
                    const file = await dataUrlToFile(stage1PngUrl, `${side}_stage1_trace.png`);
                    const path = `work/${work.id}/${side}_stage1_trace.png`;
                    zip.file(path, file);
                    serialized.stage1PngUrl = path;
                } else {
                    serialized.stage1PngUrl = stage1PngUrl;
                }

                return serialized;
            };

            const serializedA = await serializeSide('A');
            const serializedB = await serializeSide('B');
            
            const { A, B, selected, isDetailsExpanded, ...rest } = work;
            serializedWorkPairs.push({ ...rest, A: serializedA, B: serializedB });
        }
        
        // Serialize Trace Archive and add files
        const serializedTraces: SerializedStoredTrace[] = [];
        for (const trace of state.traceArchive) {
            const traceFile = await dbService.getFileLocal(trace.traceImageKey);
            const candyFile = await dbService.getFileLocal(trace.candyImageKey);

            if (!traceFile || !candyFile) continue;

            const tracePath = `archive/${trace.id}/trace.png`;
            const candyPath = `archive/${trace.id}/candy_${candyFile.name}`;

            zip.file(tracePath, traceFile);
            zip.file(candyPath, candyFile);
            
            const { traceImageKey, candyImageKey, selected, ...rest } = trace;
            serializedTraces.push({ ...rest, traceImageFile: tracePath, candyImageFile: candyPath });
        }

        const manifest: BackupManifest = {
            version: CURRENT_BACKUP_VERSION,
            pillLibrary: serializedPills,
            styleSets: serializedStyleSets,
            workPairs: serializedWorkPairs,
            traceArchive: serializedTraces,
            settings: state.settings,
        };

        zip.file(MANIFEST_FILENAME, JSON.stringify(manifest, null, 2));

        const content = await zip.generateAsync({ type: 'blob' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveAs(content, `candy-trace-workspace_${timestamp}.zip`);
    }

    export async function importFullWorkspace(zipFile: File): Promise<void> {
        // Open and validate the archive BEFORE touching existing data. Previously the
        // workspace was wiped first, so picking the wrong file (a photo, a truncated
        // download, a zip from another app) destroyed everything and then threw.
        let zip: JSZip;
        try {
            zip = await JSZip.loadAsync(zipFile);
        } catch (e) {
            throw new Error(`"${zipFile.name}" is not a readable ZIP archive. Nothing was changed.`);
        }

        const manifestFile = zip.file(MANIFEST_FILENAME);
        if (!manifestFile) {
            throw new Error(`Backup is invalid: missing ${MANIFEST_FILENAME}. Nothing was changed.`);
        }

        let manifest: BackupManifest;
        try {
            manifest = JSON.parse(await manifestFile.async('string'));
        } catch (e) {
            throw new Error(`Backup manifest is corrupt. Nothing was changed.`);
        }
        if (!Array.isArray(manifest.pillLibrary) || !Array.isArray(manifest.styleSets)) {
            throw new Error(`Backup manifest has an unexpected shape. Nothing was changed.`);
        }

        await dbService.clearAllData();

        const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

        // Restore Pills
        const pills: Pill[] = [];
        for (const sp of manifest.pillLibrary) {
            const aFile = sp.A.originalFile ? await zip.file(sp.A.originalFile)?.async('blob') : undefined;
            const bFile = sp.B.originalFile ? await zip.file(sp.B.originalFile)?.async('blob') : undefined;
            
            const p_any = sp as any; // Cast to handle older backup formats
            const pill: Pill = { 
                ...p_any,
                selected: false,
                isDetailsExpanded: p_any.isDetailsExpanded ?? false,
                bucket: p_any.bucket || 'Unassigned',
                classificationStatus: p_any.classificationStatus || 'idle',
                traceStatus: p_any.traceStatus || 'Untraced',
                qualityAnalysisStatus: p_any.qualityAnalysisStatus || 'idle',
                A: {}, 
                B: {},
                traceabilityTestA: p_any.traceabilityTestA || initialTraceabilityResult,
                traceabilityTestB: p_any.traceabilityTestB || initialTraceabilityResult,
                guidedTraceabilityTestA: p_any.guidedTraceabilityTestA || initialTraceabilityResult,
                guidedTraceabilityTestB: p_any.guidedTraceabilityTestB || initialTraceabilityResult,
            };

            if (aFile) pill.A.originalFile = new File([aFile], sp.A.originalFile!.split('/').pop()!);
            if (bFile) pill.B.originalFile = new File([bFile], sp.B.originalFile!.split('/').pop()!);
            pills.push(pill);
        }
        await dbService.savePillLibrary(pills, manifest.settings);

        // Restore Style Sets
        const styleSets: StyleSet[] = [];
        for (const ss of manifest.styleSets) {
            const aPhoto = ss.A.photoFile ? await zip.file(ss.A.photoFile)?.async('blob') : undefined;
            const aTrace = ss.A.traceFile ? await zip.file(ss.A.traceFile)?.async('blob') : undefined;
            const bPhoto = ss.B.photoFile ? await zip.file(ss.B.photoFile)?.async('blob') : undefined;
            const bTrace = ss.B.traceFile ? await zip.file(ss.B.traceFile)?.async('blob') : undefined;
            
            const ss_any = ss as any;
            const style: StyleSet = { 
                ...ss_any,
                selected: false,
                isDetailsExpanded: ss_any.isDetailsExpanded ?? false,
                bucket: ss_any.bucket || 'Unassigned',
                classificationStatus: ss_any.classificationStatus || 'idle',
                similarityCheckStatus: ss_any.similarityCheckStatus || 'idle',
                active: ss_any.active ?? true,
                A: {},
                B: {}
            };

            if (aPhoto) style.A.photoFile = new File([aPhoto], ss.A.photoFile!.split('/').pop()!);
            if (aTrace) style.A.traceFile = new File([aTrace], ss.A.traceFile!.split('/').pop()!);
            if (bPhoto) style.B.photoFile = new File([bPhoto], ss.B.photoFile!.split('/').pop()!);
            if (bTrace) style.B.traceFile = new File([bTrace], ss.B.traceFile!.split('/').pop()!);
            styleSets.push(style);
        }
        await dbService.saveStyleSets(styleSets, manifest.settings);

        // Restore Work Pairs
        const workPairs: WorkPair[] = [];
        for (const sw of manifest.workPairs) {
            const aFile = sw.A.originalFile ? await zip.file(sw.A.originalFile)?.async('blob') : undefined;
            const bFile = sw.B.originalFile ? await zip.file(sw.B.originalFile)?.async('blob') : undefined;
            
            const pathToDataURL = async (path?: string): Promise<string | undefined> => {
                if (!path || path.startsWith('data:') || !zip.file(path)) {
                    return path; // It's already a data URL, an ID, or path is invalid/not found
                }
                const fileBlob = await zip.file(path)!.async('blob');
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(fileBlob);
                });
            };
            
            const workA: WorkSide = {
                ...(sw.A as any),
                originalFile: aFile ? new File([aFile], sw.A.originalFile!.split('/').pop()!) : undefined,
                pngUrl: await pathToDataURL(sw.A.pngUrl),
                stage1PngUrl: await pathToDataURL(sw.A.stage1PngUrl)
            };

            const workB: WorkSide = {
                ...(sw.B as any),
                originalFile: bFile ? new File([bFile], sw.B.originalFile!.split('/').pop()!) : undefined,
                pngUrl: await pathToDataURL(sw.B.pngUrl),
                stage1PngUrl: await pathToDataURL(sw.B.stage1PngUrl)
            };
            
            const work: WorkPair = { 
                ...(sw as Omit<SerializedWorkPair, 'A' | 'B'>), 
                selected: false, 
                isDetailsExpanded: false, 
                A: workA,
                B: workB
            };
            workPairs.push(work);
        }
        await dbService.saveWorkSession(workPairs, manifest.settings);
        
        // Restore Trace Archive
        for (const st of manifest.traceArchive) {
            const traceBlob = await zip.file(st.traceImageFile)?.async('blob');
            const candyBlob = await zip.file(st.candyImageFile)?.async('blob');

            if (!traceBlob || !candyBlob) continue;
            
            const traceFile = new File([traceBlob], 'trace.png');
            const candyFile = new File([candyBlob], st.candyImageFile.split('/').pop()!);
            
            await dbService.saveTrace({ ...st, traceImageFile: traceFile, candyImageFile: candyFile, selected: false });
        }
        
        // Restore Settings
        await dbService.saveSettingsLocal(manifest.settings);
    }
}