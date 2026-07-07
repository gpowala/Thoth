export class Session {
    guid: string = '';
    url: string = '';

    // Client-side metadata (not persisted by the backend).
    name: string = '';
    hasBeenActive: boolean = false;

    status: SessionStatus = new SessionStatus();
}

export class SessionStatus {
    isActive: boolean = false;
    events: any[] = [];
}
