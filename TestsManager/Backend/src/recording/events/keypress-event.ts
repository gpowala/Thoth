import { v4 as uuidv4 } from 'uuid';
import { IEvent } from './event-interface';

export class KeypressEvent implements IEvent {
    public id: string;
    public timestamp: Date;
    public keys: string;

    constructor(
        timestamp: Date,
        keys: string
    ) {
        this.id = uuidv4();
        this.timestamp = timestamp;
        this.keys = keys;
    }
}
