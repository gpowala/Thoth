import { IEvent } from './event-interface';

export class NavigationEvent implements IEvent {
    public type: string = 'navigation';
    public id: string;
    public timestamp: Date;
    public url: string;
    public navType: string;
    public fullViewBase64?: string;

    constructor(
        id: string,
        timestamp: Date,
        url: string,
        navType: string,
        fullViewBase64?: string
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.url = url;
        this.navType = navType;
        this.fullViewBase64 = fullViewBase64;
    }
}
