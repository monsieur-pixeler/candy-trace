import type { Pill, Settings, StyleSet, WorkPair, TraceabilityResult } from '../types';

export namespace gcsService {
    const GCS_API_BASE_URL = 'https://storage.googleapis.com';

    async function fetchWithApiKey(url: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
        const method = options.method || 'GET';
        let requestUrl = url;
        const headers = new Headers(options.headers);

        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
            // For write operations (like upload), the header is more reliable.
            headers.set('X-Goog-Api-Key', apiKey);
        } else {
            // For read operations (GET), the query parameter is standard and avoids potential auth issues.
            const separator = requestUrl.includes('?') ? '&' : '?';
            requestUrl = `${requestUrl}${separator}key=${apiKey}`;
        }

        const response = await fetch(requestUrl, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GCS API Error (${response.status}): ${errorText}`);
        }
        return response;
    }

    async function uploadFile(bucket: string, name: string, file: File, apiKey: string): Promise<void> {
        const url = `${GCS_API_BASE_URL}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`;
        await fetchWithApiKey(url, apiKey, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
        });
    }

    async function downloadFile(bucket: string, name: string, apiKey: string): Promise<File> {
        const url = `${GCS_API_BASE_URL}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
        const response = await fetchWithApiKey(url, apiKey);
        const blob = await response.blob();
        return new File([blob], name.split('/').pop() || name, { type: blob.type });
    }

    async function saveManifest<T>(bucket: string, name: string, data: T, apiKey: string): Promise<void> {
        const manifestBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const manifestFile = new File([manifestBlob], name);
        await uploadFile(bucket, name, manifestFile, apiKey);
    }

    async function loadManifest<T>(bucket: string, name:string, apiKey: string): Promise<T | null> {
        try {
            const file = await downloadFile(bucket, name, apiKey);
            const text = await file.text();
            return JSON.parse(text) as T;
        } catch (error) {
            if (error instanceof Error && error.message.includes('404')) {
                return null;
            }
            throw error;
        }
    }

    export async function savePillLibrary(pills: Pill[], settings: Settings): Promise<void> {
        const { gcsBucketName, gcsApiKey } = settings;
        const serializablePills = await Promise.all(pills.map(async (p) => {
            const aOrigPath = p.A.originalFile ? `pills/${p.id}/A_original_${p.A.originalFile.name}` : undefined;
            const bOrigPath = p.B.originalFile ? `pills/${p.id}/B_original_${p.B.originalFile.name}` : undefined;
            
            if (aOrigPath && p.A.originalFile) await uploadFile(gcsBucketName, aOrigPath, p.A.originalFile, gcsApiKey);
            if (bOrigPath && p.B.originalFile) await uploadFile(gcsBucketName, bOrigPath, p.B.originalFile, gcsApiKey);

            return { ...p, A: { originalFile: aOrigPath }, B: { originalFile: bOrigPath } };
        }));
        await saveManifest(gcsBucketName, 'pills.json', serializablePills, gcsApiKey);
    }

    export async function getPillLibrary(settings: Settings): Promise<Pill[]> {
        const { gcsBucketName, gcsApiKey } = settings;
        const manifest = await loadManifest<any[]>(gcsBucketName, 'pills.json', gcsApiKey);
        if (!manifest) return [];

        const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

        return await Promise.all(manifest.map(async (p: any) => {
            const aOrig = p.A.originalFile ? await downloadFile(gcsBucketName, p.A.originalFile, gcsApiKey) : undefined;
            const bOrig = p.B.originalFile ? await downloadFile(gcsBucketName, p.B.originalFile, gcsApiKey) : undefined;
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
                A: { originalFile: aOrig },
                B: { originalFile: bOrig },
            };
        }));
    }

    export async function saveStyleSets(styleSets: StyleSet[], settings: Settings): Promise<void> {
        const { gcsBucketName, gcsApiKey } = settings;
        const serializableStyleSets = await Promise.all(styleSets.map(async (ss) => {
            const aPhotoPath = ss.A.photoFile ? `styles/${ss.id}/A_photo_${ss.A.photoFile.name}` : undefined;
            const aTracePath = ss.A.traceFile ? `styles/${ss.id}/A_trace_${ss.A.traceFile.name}` : undefined;
            const bPhotoPath = ss.B.photoFile ? `styles/${ss.id}/B_photo_${ss.B.photoFile.name}` : undefined;
            const bTracePath = ss.B.traceFile ? `styles/${ss.id}/B_trace_${ss.B.traceFile.name}` : undefined;

            if (aPhotoPath && ss.A.photoFile) await uploadFile(gcsBucketName, aPhotoPath, ss.A.photoFile, gcsApiKey);
            if (aTracePath && ss.A.traceFile) await uploadFile(gcsBucketName, aTracePath, ss.A.traceFile, gcsApiKey);
            if (bPhotoPath && ss.B.photoFile) await uploadFile(gcsBucketName, bPhotoPath, ss.B.photoFile, gcsApiKey);
            if (bTracePath && ss.B.traceFile) await uploadFile(gcsBucketName, bTracePath, ss.B.traceFile, gcsApiKey);

            return {
                ...ss,
                A: { ...ss.A, photoFile: aPhotoPath, traceFile: aTracePath },
                B: { ...ss.B, photoFile: bPhotoPath, traceFile: bTracePath }
            };
        }));
        await saveManifest(gcsBucketName, 'styles.json', serializableStyleSets, gcsApiKey);
    }

    export async function getStyleSets(settings: Settings): Promise<StyleSet[]> {
        const { gcsBucketName, gcsApiKey } = settings;
        const manifest = await loadManifest<any[]>(gcsBucketName, 'styles.json', gcsApiKey);
        if (!manifest) return [];

        return await Promise.all(manifest.map(async (ss: any) => {
            const aPhoto = ss.A.photoFile ? await downloadFile(gcsBucketName, ss.A.photoFile, gcsApiKey) : undefined;
            const aTrace = ss.A.traceFile ? await downloadFile(gcsBucketName, ss.A.traceFile, gcsApiKey) : undefined;
            const bPhoto = ss.B.photoFile ? await downloadFile(gcsBucketName, ss.B.photoFile, gcsApiKey) : undefined;
            const bTrace = ss.B.traceFile ? await downloadFile(gcsBucketName, ss.B.traceFile, gcsApiKey) : undefined;
            return {
                ...ss,
                selected: ss.selected ?? false,
                isDetailsExpanded: ss.isDetailsExpanded ?? false,
                bucket: ss.bucket || 'Unassigned',
                classificationStatus: ss.classificationStatus || 'idle',
                similarityCheckStatus: ss.similarityCheckStatus || 'idle',
                active: ss.active ?? true,
                A: { ...ss.A, photoFile: aPhoto, traceFile: aTrace },
                B: { ...ss.B, photoFile: bPhoto, traceFile: bTrace },
            };
        }));
    }

    export async function saveSettings(settings: Settings): Promise<void> {
        const { gcsBucketName, gcsApiKey } = settings;
        const { gcsApiKey: _, ...settingsToSave } = settings;
        await saveManifest(gcsBucketName, 'settings.json', settingsToSave, gcsApiKey);
    }

    export async function restoreSettings(settings: Settings): Promise<Partial<Settings> | null> {
        const { gcsBucketName, gcsApiKey } = settings;
        return await loadManifest<Partial<Settings>>(gcsBucketName, 'settings.json', gcsApiKey);
    }

    export async function saveWorkSession(workPairs: WorkPair[], settings: Settings): Promise<void> {
        const { gcsBucketName, gcsApiKey } = settings;
        const serializableWorkPairs = await Promise.all(workPairs.map(async (wp) => {
            const aOrigPath = wp.A.originalFile ? `session/${wp.id}/A_original_${wp.A.originalFile.name}` : undefined;
            const bOrigPath = wp.B.originalFile ? `session/${wp.id}/B_original_${wp.B.originalFile.name}` : undefined;
            
            if (aOrigPath && wp.A.originalFile) await uploadFile(gcsBucketName, aOrigPath, wp.A.originalFile, gcsApiKey);
            if (bOrigPath && wp.B.originalFile) await uploadFile(gcsBucketName, bOrigPath, wp.B.originalFile, gcsApiKey);

            return {
                ...wp,
                A: { ...wp.A, originalFile: aOrigPath },
                B: { ...wp.B, originalFile: bOrigPath },
            };
        }));
        await saveManifest(gcsBucketName, 'session.json', serializableWorkPairs, gcsApiKey);
    }

    export async function restoreWorkSession(settings: Settings): Promise<WorkPair[] | null> {
        const { gcsBucketName, gcsApiKey } = settings;
        const manifest = await loadManifest<any[]>(gcsBucketName, 'session.json', gcsApiKey);
        if (!manifest) return null;

         return await Promise.all(manifest.map(async (wp: any) => {
            const aOrig = wp.A.originalFile ? await downloadFile(gcsBucketName, wp.A.originalFile, gcsApiKey) : undefined;
            const bOrig = wp.B.originalFile ? await downloadFile(gcsBucketName, wp.B.originalFile, gcsApiKey) : undefined;
            return {
                ...wp,
                A: { ...wp.A, originalFile: aOrig },
                B: { ...wp.B, originalFile: bOrig },
            };
        }));
    }

    export async function testConnection(bucket: string, apiKey: string): Promise<void> {
        const url = `${GCS_API_BASE_URL}/storage/v1/b/${bucket}/o?maxResults=1`;
        await fetchWithApiKey(url, apiKey);
    }
}