import { IEvent } from './event-interface';
import { TargetKind, TargetSelectors, TargetRect } from './target-meta';

export class ClickEvent implements IEvent {
    public type: string = 'click';

    public id: string;
    public timestamp: Date;
    public x: number;
    public y: number;
    public fullClickViewFilepath: string;
    public minTrimmedClickViewFilepath: string;
    public maxTrimmedClickViewFilepath: string;
    public fullClickViewBase64: string;
    public minTrimmedClickViewBase64: string;
    public maxTrimmedClickViewBase64: string;
    // Additive DOM/visual metadata (undefined for events recorded before Phase 0).
    public targetKind?: TargetKind;
    public selectors?: TargetSelectors;
    public boundingRect?: TargetRect | null;
    public tag?: string | null;

    constructor(
        id: string,
        timestamp: Date,
        x: number,
        y: number,
        fullClickViewFilepath: string,
        minTrimmedClickViewFilepath: string,
        maxTrimmedClickViewFilepath: string,
        fullClickViewBase64: string,
        minTrimmedClickViewBase64: string,
        maxTrimmedClickViewBase64: string,
        targetKind?: TargetKind,
        selectors?: TargetSelectors,
        boundingRect?: TargetRect | null,
        tag?: string | null
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.x = x;
        this.y = y;
        this.fullClickViewFilepath = fullClickViewFilepath;
        this.minTrimmedClickViewFilepath = minTrimmedClickViewFilepath;
        this.maxTrimmedClickViewFilepath = maxTrimmedClickViewFilepath;
        this.fullClickViewBase64 = fullClickViewBase64;
        this.minTrimmedClickViewBase64 = minTrimmedClickViewBase64;
        this.maxTrimmedClickViewBase64 = maxTrimmedClickViewBase64;
        this.targetKind = targetKind;
        this.selectors = selectors;
        this.boundingRect = boundingRect;
        this.tag = tag;
    }
}
