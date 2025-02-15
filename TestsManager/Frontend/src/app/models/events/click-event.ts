import { IEvent } from './event-interface';

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
        maxTrimmedClickViewBase64: string
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
    }
}
