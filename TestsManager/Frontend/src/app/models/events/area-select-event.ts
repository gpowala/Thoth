import { IEvent } from './event-interface';

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

    constructor(
        id: string,
        timestamp: Date,
        top: number,
        bottom: number,
        left: number,
        right: number,
        areaSelectViewFilepath: string,
        areaSelectViewBase64: string
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.top = top;
        this.bottom = bottom;
        this.left = left;
        this.right = right;
        this.areaSelectViewFilepath = areaSelectViewFilepath;
        this.areaSelectViewBase64 = areaSelectViewBase64;
    }
}
