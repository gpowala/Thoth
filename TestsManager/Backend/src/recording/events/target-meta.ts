// Additive metadata captured for every interaction alongside the (frozen)
// coordinate + screenshot data. `dom` fields power selector-based Playwright
// codegen; `targetKind` decides whether a step plays back as DOM or visual.

export type TargetKind = 'dom' | 'dom-weak' | 'visual';

export interface TargetSelectors {
    testId?: string | null;
    id?: string | null;
    css?: string | null;
    xpath?: string | null;
}

export interface TargetRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface TargetMeta {
    targetKind: TargetKind;
    tag?: string | null;
    selectors?: TargetSelectors;
    attrs?: Record<string, string | null>;
    // CSS px, viewport-relative, plus scroll offset + dpr to map into screenshot
    // pixel space when deriving crops on demand.
    boundingRect?: TargetRect | null;
    scroll?: { x: number; y: number };
    dpr?: number;
}

// Parse the JSON metadata field sent by the extension. Never throws; a missing
// or malformed envelope degrades to a safe "visual" default.
export function parseTargetMeta(raw: unknown): TargetMeta {
    if (typeof raw === 'string' && raw.length > 0) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return normalizeTargetMeta(parsed as TargetMeta);
            }
        } catch {
            // fall through to default
        }
    }
    return { targetKind: 'visual' };
}

function normalizeTargetMeta(meta: TargetMeta): TargetMeta {
    const kind = meta.targetKind;
    return {
        ...meta,
        targetKind: kind === 'dom' || kind === 'dom-weak' || kind === 'visual' ? kind : 'visual'
    };
}
