export class Session {
    guid: string = '';
    url: string = '';

    status: SessionStatus = new SessionStatus();
}

export class SessionStatus {
    isActive: boolean = false;
    events: any[] = [];
}