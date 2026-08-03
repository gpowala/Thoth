import { RecordingSession } from './recording-session';
import { IEvent } from './events/event-interface';
import { HttpContext } from '../utils/http-context';
import { ClickEvent } from './events/click-event';
import { KeypressEvent } from './events/keypress-event';
import { AreaSelectEvent } from './events/area-select-event';
import { ScrollEvent } from './events/scroll-event';
import { InputEvent, InputControlType, KeyStroke } from './events/input-event';
import { NavigationEvent, NavigationType } from './events/navigation-event';
import { TargetMeta } from './events/target-meta';
import { generatePlaywrightProject } from './playwright-codegen';
import fs from 'fs';
import path from 'path';

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

    public destroyAllSessions(): number {
        const count = this.sessions.size;
        this.sessions.forEach(session => {
            try {
                session.stop();
            } catch (error) {
                console.error('Error stopping session during shutdown:', error);
            }
        });
        this.sessions.clear();
        return count;
    }

    public startSession(guid: string): void {
        this.sessions.get(guid)?.start();
    }

    public stopSession(guid: string): void {
        this.sessions.get(guid)?.stop();
    }

    public resumeSession(guid: string): boolean {
        const session = this.sessions.get(guid);
        if (session) {
            session.resume();
            return true;
        }
        return false;
    }

    public isActive(guid: string): boolean {
        return this.sessions.get(guid)?.isActive() || false;
    }

    public registerClickEvent(guid: string, x: number, y: number, clickViewStream: Buffer, target?: TargetMeta, clientTime?: number): void {
        this.sessions.get(guid)?.registerClickEvent(x, y, clickViewStream, target, clientTime);
    }

    public registerKeypressEvent(guid: string, key: string, clientTime?: number): void {
        this.sessions.get(guid)?.registerKeypressEvent(key, clientTime);
    }

    public registerAreaSelectEvent(guid: string, top: number, bottom: number, left: number, right: number, areaSelectViewStream: Buffer, dpr: number = 1, clientTime?: number): void {
        this.sessions.get(guid)?.registerAreaSelectEvent(top, bottom, left, right, areaSelectViewStream, dpr, clientTime);
    }

    public registerScrollEvent(guid: string, x: number, y: number, viewStream: Buffer, target?: TargetMeta, clientTime?: number): void {
        this.sessions.get(guid)?.registerScrollEvent(x, y, viewStream, target, clientTime);
    }

    public registerInputEvent(guid: string, controlType: InputControlType, value: string, checked: boolean, viewStream: Buffer, target?: TargetMeta, selectedText?: string, clientTime?: number, keys?: KeyStroke[]): void {
        this.sessions.get(guid)?.registerInputEvent(controlType, value, checked, viewStream, target, selectedText, clientTime, keys);
    }

    public registerNavigationEvent(guid: string, url: string, navType: NavigationType, viewStream: Buffer, clientTime?: number): void {
        this.sessions.get(guid)?.registerNavigationEvent(url, navType, viewStream, clientTime);
    }

    // Generate the Playwright-Python project (script + OpenCV helper + baseline
    // PNGs) and write it to disk as a runnable bundle. Returns the script text
    // (for UI preview) and the bundle path.
    public generateProject(guid: string, testName?: string): { script: string; bundlePath: string } {
        // getRecordedEvents is annotated IEvent[] but yields serialized {type,data}
        // objects, which is exactly what the generator consumes.
        const events = this.getRecordedEvents(guid) as any;
        const { script, helper, assets } = generatePlaywrightProject(events, testName);

        const bundlePath = `C:/tests/generated/${guid}`;
        fs.mkdirSync(bundlePath, { recursive: true });
        fs.writeFileSync(path.join(bundlePath, 'thoth_visual.py'), helper);
        fs.writeFileSync(path.join(bundlePath, 'test.py'), script);
        for (const asset of assets) {
            const assetPath = path.join(bundlePath, asset.relPath);
            fs.mkdirSync(path.dirname(assetPath), { recursive: true });
            fs.writeFileSync(assetPath, Buffer.from(asset.base64, 'base64'));
        }

        return { script, bundlePath };
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
                        maxTrimmedClickViewBase64: event.maxTrimmedClickViewBase64,
                        // Additive DOM/visual metadata (undefined when not captured).
                        targetKind: event.target?.targetKind,
                        selectors: event.target?.selectors,
                        boundingRect: event.target?.boundingRect,
                        tag: event.target?.tag,
                        attrs: event.target?.attrs
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
                    type: 'area-select',
                    data: JSON.stringify({
                        top: event.top,
                        bottom: event.bottom,
                        left: event.left,
                        right: event.right,
                        targetKind: event.targetKind,
                        areaSelectViewFilepath: event.areaSelectViewFilepath,
                        areaSelectViewBase64: event.areaSelectViewBase64,
                        fullViewFilepath: event.fullViewFilepath,
                        fullViewBase64: event.fullViewBase64
                    })
                };
            } else if (event instanceof ScrollEvent) {
                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: 'scroll',
                    data: JSON.stringify({
                        x: event.x,
                        y: event.y,
                        targetKind: event.target?.targetKind,
                        fullViewFilepath: event.fullViewFilepath,
                        fullViewBase64: event.fullViewBase64
                    })
                };
            } else if (event instanceof InputEvent) {
                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: 'input',
                    data: JSON.stringify({
                        controlType: event.controlType,
                        value: event.value,
                        checked: event.checked,
                        selectedText: event.selectedText,
                        targetKind: event.target?.targetKind,
                        selectors: event.target?.selectors,
                        tag: event.target?.tag,
                        fullViewFilepath: event.fullViewFilepath,
                        fullViewBase64: event.fullViewBase64
                    })
                };
            } else if (event instanceof NavigationEvent) {
                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: 'navigation',
                    data: JSON.stringify({
                        url: event.url,
                        navType: event.navType,
                        fullViewFilepath: event.fullViewFilepath,
                        fullViewBase64: event.fullViewBase64
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
