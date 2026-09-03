import type { StoredTrace, TraceGroup } from '../types';

export function suggestLogoTextFromFilename(filename: string): string {
  // Add specific logic for domino patterns
  const dominoMatch = filename.match(/Domino(\d+)x(\d+)/i);
  if (dominoMatch) {
    const num1 = dominoMatch[1];
    const num2 = dominoMatch[2];
    return `${num1} and ${num2} dots`;
  }

  // Return empty for all other cases to prevent hallucination from filenames.
  return "";
}

/**
 * Groups an array of StoredTrace objects by candy name, organizing them into a
 * versioned structure with sides A and B.
 * @param traces - The flat array of trace records.
 * @param includeApproval - A flag to determine if the approval status should be calculated.
 * @returns An array of TraceGroup objects.
 */
export const groupTracesWithVersioning = (traces: StoredTrace[], includeApproval: boolean = false): TraceGroup[] => {
    const groups = new Map<string, TraceGroup>();

    for (const trace of traces) {
        const groupKey = trace.candyName;
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                groupKey,
                candyName: trace.candyName,
                bucket: trace.bucket || 'Unassigned',
                isFavorite: false,
                isApproved: includeApproval ? false : undefined, // Only calculate if requested
                latestTimestamp: 0,
                sides: {},
            });
        }
        
        const group = groups.get(groupKey)!;
        
        if (!group.sides[trace.side]) {
            group.sides[trace.side] = { side: trace.side, versions: [] };
        }
        group.sides[trace.side]!.versions.push(trace);
    }

    // Post-process groups: sort versions and aggregate properties
    for (const group of groups.values()) {
        let latestTimestamp = 0;
        let isAnyFavorite = false;
        
        if (group.sides.A) {
            group.sides.A.versions.sort((a, b) => b.timestamp - a.timestamp);
            if (group.sides.A.versions[0].timestamp > latestTimestamp) {
                latestTimestamp = group.sides.A.versions[0].timestamp;
            }
            if (group.sides.A.versions.some(v => v.isFavorite)) isAnyFavorite = true;
        }
        if (group.sides.B) {
            group.sides.B.versions.sort((a, b) => b.timestamp - a.timestamp);
            if (group.sides.B.versions[0].timestamp > latestTimestamp) {
                latestTimestamp = group.sides.B.versions[0].timestamp;
            }
            if (group.sides.B.versions.some(v => v.isFavorite)) isAnyFavorite = true;
        }

        group.latestTimestamp = latestTimestamp;
        group.isFavorite = isAnyFavorite;
        
        if (includeApproval) {
            const hasSideA = !!group.sides.A?.versions.length;
            const hasSideB = !!group.sides.B?.versions.length;
            const isSideAApproved = hasSideA ? group.sides.A!.versions.some(v => v.isApproved) : true;
            const isSideBApproved = hasSideB ? group.sides.B!.versions.some(v => v.isApproved) : true;
            group.isApproved = isSideAApproved && isSideBApproved;
        }
    }

    return Array.from(groups.values());
};