import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';

// 'initial' = URL captured when recording started (becomes the test's opening goto).
// 'load'    = full document navigation. 'spa' = history/route change without reload.
export type NavigationType = 'initial' | 'load' | 'spa';

export class NavigationEvent implements IEvent {
    public id: string;
    public timestamp: Date;
    public url: string;
    public navType: NavigationType;
    public fullViewFilepath: string;
    public fullViewBase64: string;

    constructor(
        timestamp: Date,
        url: string,
        navType: NavigationType,
        fullViewFilepath: string,
        fullViewBase64: string
    ) {
        this.id = uuidv4();
        this.timestamp = timestamp;
        this.url = url;
        this.navType = navType;
        this.fullViewFilepath = fullViewFilepath;
        this.fullViewBase64 = fullViewBase64;
    }
}
