import type { Pill, StoredTrace } from '../types';

export function syncPillsWithTraces(pills: Pill[], traces: StoredTrace[]): Pill[] {
    if (!pills || !traces) {
        return pills || [];
    }

    const tracesByCandyName = new Map<string, StoredTrace[]>();
    for (const trace of traces) {
        if (!tracesByCandyName.has(trace.candyName)) {
            tracesByCandyName.set(trace.candyName, []);
        }
        tracesByCandyName.get(trace.candyName)!.push(trace);
    }

    return pills.map(pill => {
        const associatedTraces = tracesByCandyName.get(pill.name) || [];

        if (associatedTraces.length === 0) {
            return {
                ...pill,
                traceStatus: pill.traceStatus === 'In Queue' ? 'In Queue' : 'Untraced',
                approvalStatus: 'none',
                latestTraceA: undefined,
                latestTraceB: undefined,
            };
        }

        const tracesA = associatedTraces.filter(t => t.side === 'A').sort((a, b) => b.timestamp - a.timestamp);
        const tracesB = associatedTraces.filter(t => t.side === 'B').sort((a, b) => b.timestamp - a.timestamp);

        const latestTraceA = tracesA[0];
        const latestTraceB = tracesB[0];
        
        const hasSideAImage = !!pill.A.originalFile;
        const hasSideBImage = !!pill.B.originalFile;

        const isSideAApproved = tracesA.some(t => t.isApproved);
        const isSideBApproved = tracesB.some(t => t.isApproved);

        let approvalStatus: 'none' | 'pending' | 'partial' | 'full' = 'pending';
        
        if (!hasSideAImage && !hasSideBImage) {
            approvalStatus = 'none';
        } else if (hasSideAImage && hasSideBImage) {
            if (isSideAApproved && isSideBApproved) approvalStatus = 'full';
            else if (isSideAApproved || isSideBApproved) approvalStatus = 'partial';
        } else if (hasSideAImage) {
            if (isSideAApproved) approvalStatus = 'full';
        } else if (hasSideBImage) {
            if (isSideBApproved) approvalStatus = 'full';
        }

        return {
            ...pill,
            traceStatus: 'Completed',
            approvalStatus,
            latestTraceA: latestTraceA ? { traceImageKey: latestTraceA.traceImageKey, isApproved: isSideAApproved } : undefined,
            latestTraceB: latestTraceB ? { traceImageKey: latestTraceB.traceImageKey, isApproved: isSideBApproved } : undefined,
        };
    });
}
