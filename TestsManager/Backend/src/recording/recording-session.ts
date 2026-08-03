import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import fs from 'fs';
import { EventEmitter } from 'events';
import { IEvent } from './events/event-interface';
import { HttpContext } from '../utils/http-context';
import { ClickEvent } from './events/click-event';
import { trimClickEventView, extractRegion } from '../utils/image-helpers';
import { KeypressEvent } from './events/keypress-event';
import { AreaSelectEvent } from './events/area-select-event';
import { ScrollEvent } from './events/scroll-event';
import { InputEvent, InputControlType, KeyStroke } from './events/input-event';
import { NavigationEvent, NavigationType } from './events/navigation-event';
import { TargetMeta } from './events/target-meta';

// How long to wait after the last keystroke before finalizing a typing group
// into a single step. Any non-keypress event also flushes the group immediately.
const KEYPRESS_FLUSH_MS = 1200;

export class RecordingSession extends EventEmitter {
    public id: string;

    public isRecording: boolean;
    public recordedEvents: IEvent[];

    public sessionDirectory: string;

    private httpContext: HttpContext;

    // Buffer for the in-progress keystroke run — either typed text or a run of
    // Backspaces. Nothing is pushed to recordedEvents until the run is finalized,
    // so recordedEvents stays append-only (the frontend polls it by index).
    private pendingKeypress: { kind: 'text' | 'backspace'; text: string; count: number; timestamp: Date } | null = null;
    private keypressFlushTimer: NodeJS.Timeout | null = null;

    constructor(
        httpContext: HttpContext
    ) {
        super();
        this.id = uuidv4();
        this.httpContext = httpContext;
        this.isRecording = false;
        this.recordedEvents = [];
        this.sessionDirectory = "";
    }

    public getConnectionString(): string {
        return `${this.httpContext.protocol}://localhost:${this.httpContext.port}/recording/session/start?guid=${this.id}`;
    }

    public start(): void {
        this.sessionDirectory = this.createSessionDirectoryIfNotExists();
        this.isRecording = true;

        console.log(`Session ${this.id} started, session directory created: ${this.sessionDirectory}.`);
    }

    public stop(): void {
        this.isRecording = false;
        // Finalize any typing still buffered so it is not lost on stop.
        this.flushPendingKeypress();

        console.log(`Session ${this.id} stopped.`);
    }

    public resume(): void {
        if (!this.isRecording) {
            this.isRecording = true;
            console.log(`Session ${this.id} resumed.`);
        } else {
            console.log(`Session ${this.id} already active, no resume needed.`);
        }
    }

    public isActive(): boolean {
        return this.isRecording;
    }

    // Prefer the client's capture time (true event order) over arrival time,
    // which is skewed by per-event screenshot latency.
    private tsOf(clientTime?: number): Date {
        return clientTime && !isNaN(clientTime) ? new Date(clientTime) : new Date();
    }

    public async registerClickEvent(x: number, y: number, clickViewStream: Buffer, target?: TargetMeta, clientTime?: number): Promise<void> {
        // A click ends any in-progress typing group.
        this.flushPendingKeypress();
        try {
            const focusedImage = await trimClickEventView(clickViewStream, x, y, 100);
            const croppedImage = await trimClickEventView(clickViewStream, x, y, 300);

            const fullClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-full.png`;
            const minTrimmedClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-min-trim.png`;
            const maxTrimmedClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-max-trim.png`;

            if (!this.sessionDirectory || !fs.existsSync(this.sessionDirectory)) {
                throw new Error(`Session directory does not exist: ${this.sessionDirectory}`);
            }

            await sharp(clickViewStream).toFile(fullClickViewFilepath);
            await sharp(focusedImage).toFile(minTrimmedClickViewFilepath);
            await sharp(croppedImage).toFile(maxTrimmedClickViewFilepath);

            if (!fs.existsSync(fullClickViewFilepath) || !fs.existsSync(minTrimmedClickViewFilepath) || !fs.existsSync(maxTrimmedClickViewFilepath)) {
                throw new Error(`Failed to create click event files: ${fullClickViewFilepath}, ${minTrimmedClickViewFilepath}, ${maxTrimmedClickViewFilepath}`);
            }

            console.log(`Successfully saved click event to ${fullClickViewFilepath} and ${minTrimmedClickViewFilepath} and ${maxTrimmedClickViewFilepath}`);

            this.recordedEvents.push(new ClickEvent(this.tsOf(clientTime), x, y, fullClickViewFilepath, minTrimmedClickViewFilepath, maxTrimmedClickViewFilepath, clickViewStream.toString('base64'), focusedImage.toString('base64'), croppedImage.toString('base64'), target));
        } catch (error) {
            console.error('Error in registerClickEvent:', error);
            throw error;
        }
    }

    public async registerAreaSelectEvent(top: number, bottom: number, left: number, right: number, areaSelectViewStream: Buffer, dpr: number = 1, clientTime?: number): Promise<void> {
        // An area selection ends any in-progress typing group.
        this.flushPendingKeypress();
        try {
            if (!this.sessionDirectory || !fs.existsSync(this.sessionDirectory)) {
                throw new Error(`Session directory does not exist: ${this.sessionDirectory}`);
            }

            // Overlay rect is in CSS px; the screenshot is in device px. Scale to
            // match the screenshot's pixel space before cropping the region.
            const regionImage = await extractRegion(
                areaSelectViewStream,
                left * dpr,
                top * dpr,
                right * dpr,
                bottom * dpr
            );

            const fullViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-area-select-full.png`;
            const areaSelectViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-area-select-region.png`;

            await sharp(areaSelectViewStream).toFile(fullViewFilepath);
            await sharp(regionImage).toFile(areaSelectViewFilepath);

            this.recordedEvents.push(new AreaSelectEvent(
                this.tsOf(clientTime),
                top, bottom, left, right,
                areaSelectViewFilepath,
                regionImage.toString('base64'),
                fullViewFilepath,
                areaSelectViewStream.toString('base64')
            ));

            console.log(`Successfully saved area-select event to ${fullViewFilepath} and ${areaSelectViewFilepath}`);
        } catch (error) {
            console.error('Error in registerAreaSelectEvent:', error);
            throw error;
        }
    }

    public async registerScrollEvent(x: number, y: number, viewStream: Buffer, target?: TargetMeta, clientTime?: number): Promise<void> {
        this.flushPendingKeypress();
        try {
            const view = await this.saveFullView('scroll', viewStream);
            this.recordedEvents.push(new ScrollEvent(this.tsOf(clientTime), x, y, view.filepath, view.base64, target));
        } catch (error) {
            console.error('Error in registerScrollEvent:', error);
            throw error;
        }
    }

    public async registerInputEvent(controlType: InputControlType, value: string, checked: boolean, viewStream: Buffer, target?: TargetMeta, selectedText?: string, clientTime?: number, keys?: KeyStroke[]): Promise<void> {
        this.flushPendingKeypress();
        try {
            const view = await this.saveFullView('input', viewStream);
            this.recordedEvents.push(new InputEvent(this.tsOf(clientTime), controlType, value, checked, view.filepath, view.base64, target, selectedText, keys));
        } catch (error) {
            console.error('Error in registerInputEvent:', error);
            throw error;
        }
    }

    public async registerNavigationEvent(url: string, navType: NavigationType, viewStream: Buffer, clientTime?: number): Promise<void> {
        this.flushPendingKeypress();
        try {
            const view = await this.saveFullView('navigation', viewStream);
            this.recordedEvents.push(new NavigationEvent(this.tsOf(clientTime), url, navType, view.filepath, view.base64));
        } catch (error) {
            console.error('Error in registerNavigationEvent:', error);
            throw error;
        }
    }

    // Persist the immutable full viewport screenshot (source of truth). Crops are
    // derived from it on demand, so new events keep only the full frame.
    private async saveFullView(kind: string, viewStream: Buffer): Promise<{ filepath: string; base64: string }> {
        if (!this.sessionDirectory || !fs.existsSync(this.sessionDirectory)) {
            throw new Error(`Session directory does not exist: ${this.sessionDirectory}`);
        }
        const filepath = `${this.sessionDirectory}/${this.recordedEvents.length}-${kind}-event-full.png`;
        await sharp(viewStream).toFile(filepath);
        return { filepath, base64: viewStream.toString('base64') };
    }

    public async registerKeypressEvent(key: string, clientTime?: number): Promise<void> {
        try {
            // Backspace runs collapse into one "[Backspace ×N]" step (visual/canvas
            // text entry; DOM fields suppress these and rely on the final value).
            if (key === 'Backspace') {
                if (this.pendingKeypress && this.pendingKeypress.kind === 'backspace') {
                    this.pendingKeypress.count += 1;
                } else {
                    this.flushPendingKeypress();
                    this.pendingKeypress = { kind: 'backspace', text: '', count: 1, timestamp: this.tsOf(clientTime) };
                }
                this.scheduleKeypressFlush();
                return;
            }

            if (this.isActionKey(key)) {
                // Named action key (Enter/Tab/Escape/arrows/...) — a discrete step.
                this.flushPendingKeypress();
                this.recordedEvents.push(new KeypressEvent(this.tsOf(clientTime), `[${key}]`));
                return;
            }

            // Printable character (including the "\n" that Enter-in-a-textarea was
            // translated to) — folded into the current typing group.
            if (this.pendingKeypress && this.pendingKeypress.kind === 'text') {
                this.pendingKeypress.text += key;
            } else {
                this.flushPendingKeypress();
                this.pendingKeypress = { kind: 'text', text: key, count: 0, timestamp: this.tsOf(clientTime) };
            }
            this.scheduleKeypressFlush();
        } catch (error) {
            console.error('Error in registerKeypressEvent:', error);
            throw error;
        }
    }

    // Single printable characters (and the newline we fold Enter into inside
    // multiline fields) are text; multi-character key names are discrete actions.
    private isActionKey(key: string): boolean {
        return typeof key === 'string' && key.length > 1;
    }

    // (Re)arm the idle timer that finalizes a typing group after a pause.
    private scheduleKeypressFlush(): void {
        if (this.keypressFlushTimer) {
            clearTimeout(this.keypressFlushTimer);
        }
        this.keypressFlushTimer = setTimeout(() => this.flushPendingKeypress(), KEYPRESS_FLUSH_MS);
    }

    // Finalize the buffered keystroke run as a single immutable KeypressEvent.
    private flushPendingKeypress(): void {
        if (this.keypressFlushTimer) {
            clearTimeout(this.keypressFlushTimer);
            this.keypressFlushTimer = null;
        }
        if (this.pendingKeypress) {
            const keys = this.pendingKeypress.kind === 'backspace'
                ? `[Backspace ×${this.pendingKeypress.count}]`
                : this.pendingKeypress.text;
            this.recordedEvents.push(new KeypressEvent(this.pendingKeypress.timestamp, keys));
            this.pendingKeypress = null;
        }
    }

    private createSessionDirectoryIfNotExists(): string {
        const sessionDirectory = `C:/tests/recordings/${this.id}`;

        if (!fs.existsSync(sessionDirectory)) {
            fs.mkdirSync(sessionDirectory, { recursive: true });
        }

        return sessionDirectory;
    }
}
