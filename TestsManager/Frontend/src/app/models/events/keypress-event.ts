import { IEvent } from './event-interface';

export class KeypressEvent implements IEvent {
    public type: string = 'keypress';
    
    public id: string;
    public timestamp: Date;
    public keys: string;

    constructor(
        id: string,
        timestamp: Date,
        keys: string
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.keys = keys;
    }
}
