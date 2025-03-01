import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import fs from 'fs';
import { EventEmitter } from 'events';
import { IEvent } from './events/event-interface';
import { HttpContext } from '../utils/http-context';
import { ClickEvent } from './events/click-event';
import { trimClickEventView } from '../utils/image-helpers';
import { KeypressEvent } from './events/keypress-event';

export class RecordingSession extends EventEmitter {
    public id: string;

    public isRecording: boolean;
    public recordedEvents: IEvent[];
    
    public sessionDirectory: string;

    private httpContext: HttpContext;
    
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
        console.log(`Session directory created: ${this.sessionDirectory}`);
        console.log(`Session id: ${this.id}`);
        this.isRecording = true;

        this.invokeSessionStatusChanged();
    }

    public stop(): void {
        this.isRecording = false;

        this.invokeSessionStatusChanged();
    }

    public isActive(): boolean {
        return this.isRecording;
    }

    public async registerClickEvent(x: number, y: number, clickViewStream: Buffer): Promise<void> {
        try {
            const minTrimmedImage = await trimClickEventView(clickViewStream, x, y, 100);
            const maxTrimmedImage = await trimClickEventView(clickViewStream, x, y, 300);

            const fullClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-full.png`;
            const minTrimmedClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-min-trim.png`;
            const maxTrimmedClickViewFilepath = `${this.sessionDirectory}/${this.recordedEvents.length}-click-event-max-trim.png`;
            
            if (!this.sessionDirectory || !fs.existsSync(this.sessionDirectory)) {
                console.error('Session directory does not exist:', this.sessionDirectory);
                throw new Error('Session directory does not exist');
            }
            
            await sharp(clickViewStream).toFile(fullClickViewFilepath);
            await sharp(minTrimmedImage).toFile(minTrimmedClickViewFilepath);
            await sharp(maxTrimmedImage).toFile(maxTrimmedClickViewFilepath);
            
            if (!fs.existsSync(fullClickViewFilepath) || !fs.existsSync(minTrimmedClickViewFilepath) || !fs.existsSync(maxTrimmedClickViewFilepath)) {
                console.error('Failed to create click event files:', fullClickViewFilepath, minTrimmedClickViewFilepath, maxTrimmedClickViewFilepath);
                throw new Error('Failed to create click event files');
            }
            
            console.log(`Successfully saved click event to ${fullClickViewFilepath} and ${minTrimmedClickViewFilepath} and ${maxTrimmedClickViewFilepath}`);
            
            this.recordedEvents.push(new ClickEvent(new Date(), x, y, fullClickViewFilepath, minTrimmedClickViewFilepath, maxTrimmedClickViewFilepath, clickViewStream.toString('base64'), minTrimmedImage.toString('base64'), maxTrimmedImage.toString('base64')));
            this.invokeClickEventRegistered();
        } catch (error) {
            console.error('Error in registerClickEvent:', error);
            throw error;
        }
    }

    public async registerKeypressEvent(key: string): Promise<void> {
        try {
            this.recordedEvents.push(new KeypressEvent(new Date(), key));
            this.invokeKeypressEventRegistered();
        } catch (error) {
            console.error('Error in registerKeypressEvent:', error);
            throw error;
        }
    }

    private invokeSessionStatusChanged(): void {
        console.log('BACKEND_EVENT:SESSION_STATUS_CHANGED');
    }

    private invokeClickEventRegistered(): void {
        console.log('BACKEND_EVENT:CLICK_EVENT_REGISTERED');
    }

    private invokeKeypressEventRegistered(): void {
        console.log('BACKEND_EVENT:KEYPRESS_EVENT_REGISTERED');
    }

    private createSessionDirectoryIfNotExists(): string {
        const sessionDirectory = `C:/tests/screenshots/${this.id}`;

        if (!fs.existsSync(sessionDirectory)) {
            fs.mkdirSync(sessionDirectory, { recursive: true });
        }

        return sessionDirectory;
    }
}
