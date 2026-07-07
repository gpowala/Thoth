import { IEvent } from './event-interface';
import { TargetKind } from './target-meta';

export class AreaSelectEvent implements IEvent {
    public type: string = 'area-select';
    public id: string;
    public timestamp: Date;
    public top: number;
    public bottom: number;
    public left: number;
    public right: number;
    public areaSelectViewFilepath: string;
    public areaSelectViewBase64: string;
    // Immutable full viewport screenshot (source of truth for re-cropping).
    public fullViewFilepath?: string;
    public fullViewBase64?: string;
    public targetKind?: TargetKind;

    constructor(
        id: string,
        timestamp: Date,
        top: number,
        bottom: number,
        left: number,
        right: number,
        areaSelectViewFilepath: string,
        areaSelectViewBase64: string,
        fullViewFilepath?: string,
        fullViewBase64?: string,
        targetKind?: TargetKind
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.top = top;
        this.bottom = bottom;
        this.left = left;
        this.right = right;
        this.areaSelectViewFilepath = areaSelectViewFilepath;
        this.areaSelectViewBase64 = areaSelectViewBase64;
        this.fullViewFilepath = fullViewFilepath;
        this.fullViewBase64 = fullViewBase64;
        this.targetKind = targetKind;
    }
}
