import { RecordingSession } from './recording-session';
import { IEvent } from './events/event-interface';
import { HttpContext } from '../utils/http-context';
import { ClickEvent } from './events/click-event';
import { KeypressEvent } from './events/keypress-event';
import { AreaSelectEvent } from './events/area-select-event';

export class RecordingService {
    private sessions: Map<string, RecordingSession>;
    private readonly httpContext: HttpContext;

    constructor(httpContext: HttpContext) {
        this.sessions = new Map();
        this.httpContext = httpContext;
    }

    public createSession(): RecordingSession {
        const session = new RecordingSession(this.httpContext);
        this.sessions.set(session.id, session);
        return session;
    }

    public destroySession(guid: string): void {
        const session = this.sessions.get(guid);
        if (session) {
            this.sessions.delete(guid);
        }
    }

    public startSession(guid: string): void {
        this.sessions.get(guid)?.start();
    }

    public stopSession(guid: string): void {
        this.sessions.get(guid)?.stop();
    }

    public isActive(guid: string): boolean {
        return this.sessions.get(guid)?.isActive() || false;
    }

    public registerClickEvent(guid: string, x: number, y: number, clickViewStream: Buffer): void {
        this.sessions.get(guid)?.registerClickEvent(x, y, clickViewStream);
    }

    public registerKeypressEvent(guid: string, key: string): void {
        this.sessions.get(guid)?.registerKeypressEvent(key);
    }

    public registerAreaSelectEvent(guid: string, top: number, bottom: number, left: number, right: number, areaSelectViewStream: Buffer): void {
        // Assuming RecordingSession has a registerAreaSelectEvent method
        // this.sessions.get(guid)?.registerAreaSelectEvent(top, bottom, left, right, areaSelectViewStream);
    }

    public getRecordedEvents(guid: string): IEvent[] {
        return (this.sessions.get(guid)?.recordedEvents || []).map(event => {
            if (event instanceof ClickEvent) {
                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: 'click',
                    data: JSON.stringify({
                        x: event.x,
                        y: event.y,
                        fullClickViewFilepath: event.fullClickViewFilepath,
                        minTrimmedClickViewFilepath: event.minTrimmedClickViewFilepath,
                        maxTrimmedClickViewFilepath: event.maxTrimmedClickViewFilepath,
                        fullClickViewBase64: event.fullClickViewBase64,
                        minTrimmedClickViewBase64: event.minTrimmedClickViewBase64,
                        maxTrimmedClickViewBase64: event.maxTrimmedClickViewBase64
                    })
                };
            } else if (event instanceof KeypressEvent) {
                return {
                    id: event.id, 
                    timestamp: event.timestamp,
                    type: 'keypress',
                    data: JSON.stringify({
                        keys: event.keys
                    })
                };
            } else if (event instanceof AreaSelectEvent) {
                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: 'areaSelect',
                    data: JSON.stringify({
                        top: event.top,
                        bottom: event.bottom,
                        left: event.left,
                        right: event.right,
                        areaSelectViewFilepath: event.areaSelectViewFilepath,
                        areaSelectViewBase64: event.areaSelectViewBase64
                    })
                };
            } else {
                return {
                    id: event.id, 
                    timestamp: event.timestamp,
                    type: 'unknown',
                    data: JSON.stringify({
                        id: event.id,
                        timestamp: event.timestamp,
                        type: 'unknown'
                    })
                };
            }
        });
    }
}
