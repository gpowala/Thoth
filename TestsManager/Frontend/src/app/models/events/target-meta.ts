// Mirrors the backend target envelope (recording/events/target-meta.ts).
// Additive DOM/visual metadata attached to interaction events.

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
