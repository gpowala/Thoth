import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';
import { TargetKind } from './target-meta';

export class AreaSelectEvent implements IEvent {
    public id: string;
    public timestamp: Date;
    public top: number;
    public bottom: number;
    public left: number;
    public right: number;
    // Region crop of the selected rectangle.
    public areaSelectViewFilepath: string;
    public areaSelectViewBase64: string;
    // Immutable full viewport screenshot — kept as the source of truth so the
    // selection can be re-cropped later without re-recording.
    public fullViewFilepath: string;
    public fullViewBase64: string;
    // Area selection is inherently a visual assertion.
    public targetKind: TargetKind = 'visual';

    constructor(
        timestamp: Date,
        top: number,
        bottom: number,
        left: number,
        right: number,
        areaSelectViewFilepath: string,
        areaSelectViewBase64: string,
        fullViewFilepath: string,
        fullViewBase64: string
    ) {
        this.id = uuidv4();
        this.timestamp = timestamp;
        this.top = top;
        this.bottom = bottom;
        this.left = left;
        this.right = right;
        this.areaSelectViewFilepath = areaSelectViewFilepath;
        this.areaSelectViewBase64 = areaSelectViewBase64;
        this.fullViewFilepath = fullViewFilepath;
        this.fullViewBase64 = fullViewBase64;
    }
}
