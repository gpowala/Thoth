import { IEvent } from './event-interface';
import { TargetKind } from './target-meta';

export class ScrollEvent implements IEvent {
    public type: string = 'scroll';
    public id: string;
    public timestamp: Date;
    public x: number;
    public y: number;
    public targetKind?: TargetKind;
    public fullViewBase64?: string;

    constructor(
        id: string,
        timestamp: Date,
        x: number,
        y: number,
        targetKind?: TargetKind,
        fullViewBase64?: string
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.x = x;
        this.y = y;
        this.targetKind = targetKind;
        this.fullViewBase64 = fullViewBase64;
    }
}
