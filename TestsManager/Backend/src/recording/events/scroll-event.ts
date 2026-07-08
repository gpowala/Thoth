import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';
import { TargetMeta } from './target-meta';

export class ScrollEvent implements IEvent {
    public id: string;
    public timestamp: Date;
    // Final scroll offset (device px) after the scroll settled.
    public x: number;
    public y: number;
    public fullViewFilepath: string;
    public fullViewBase64: string;
    public target?: TargetMeta;

    constructor(
        timestamp: Date,
        x: number,
        y: number,
        fullViewFilepath: string,
        fullViewBase64: string,
        target?: TargetMeta
    ) {
        this.id = uuidv4();
        this.timestamp = timestamp;
        this.x = x;
        this.y = y;
        this.fullViewFilepath = fullViewFilepath;
        this.fullViewBase64 = fullViewBase64;
        this.target = target;
    }
}
