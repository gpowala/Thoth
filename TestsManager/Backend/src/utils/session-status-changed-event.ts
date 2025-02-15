export class SessionStatusChangedEvent {
    constructor(public sessionId: string, public timestamp: Date) {}
}