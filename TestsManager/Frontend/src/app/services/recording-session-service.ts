import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Session, SessionStatus } from '../models/session';
import { ConfigurationProviderService } from './configuration-provider-service';


@Injectable({
  providedIn: 'root'
})
export class RecordingSessionService implements OnDestroy {
  private sessionsSubject = new BehaviorSubject<Session[]>([]);
  /** All known recording sessions, newest first. */
  sessions$ = this.sessionsSubject.asObservable();

  private sessions = new Map<string, Session>();
  private monitors = new Map<string, Subscription>();
  private pollingInterval = 2000; // 2 seconds

  constructor(
    private configurationProviderService: ConfigurationProviderService,
    private http: HttpClient
  ) {}

  getSession(guid: string): Session | undefined {
    return this.sessions.get(guid);
  }

  /** Drops all tracked sessions (e.g. after the backend terminated them on a DB switch). */
  clearSessions(): void {
    this.monitors.forEach(sub => sub.unsubscribe());
    this.monitors.clear();
    this.sessions.clear();
    this.emit();
  }

  createRecordingSession(name: string = ''): Observable<Session> {
    return this.http.get<Session>(`${this.baseUrl}/recording/session/create`).pipe(
      map(session => {
        session.status = new SessionStatus();
        session.name = name?.trim() || 'Untitled test';
        session.hasBeenActive = false;
        this.sessions.set(session.guid, session);
        this.emit();
        this.startBackgroundMonitoring(session);
        return session;
      })
    );
  }

  startRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.baseUrl}/recording/session/start`, {
      params: { guid: encodeURIComponent(session.guid) }
    });
  }

  stopRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.baseUrl}/recording/session/stop`, {
      params: { guid: encodeURIComponent(session.guid) }
    });
  }

  destroyRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.baseUrl}/recording/session/destroy`, {
      params: { guid: encodeURIComponent(session.guid) }
    }).pipe(
      map(() => {
        this.stopBackgroundMonitoring(session.guid);
        this.sessions.delete(session.guid);
        this.emit();
        return undefined;
      })
    );
  }

  generateScript(guid: string, testName?: string): Observable<{ script: string }> {
    return this.http.get<{ script: string }>(`${this.baseUrl}/recording/session/generate`, {
      params: {
        guid: encodeURIComponent(guid),
        ...(testName ? { testName: encodeURIComponent(testName) } : {})
      }
    });
  }

  getRecordingSessionUpdate(session: Session): Observable<SessionStatus> {
    return this.http.get<SessionStatus>(`${this.baseUrl}/recording/session/update`, {
      params: {
        guid: encodeURIComponent(session.guid),
        nextEventId: encodeURIComponent(session.status.events.length)
      }
    });
  }

  ngOnDestroy(): void {
    this.monitors.forEach(sub => sub.unsubscribe());
    this.monitors.clear();
  }

  private get baseUrl(): string {
    return this.configurationProviderService.backendApiBaseUrl;
  }

  private startBackgroundMonitoring(session: Session): void {
    this.stopBackgroundMonitoring(session.guid);

    const subscription = interval(this.pollingInterval)
      .pipe(
        switchMap(() => this.getRecordingSessionUpdate(session)),
        catchError(error => {
          console.error('Error checking session status:', error);
          return [new SessionStatus()];
        })
      )
      .subscribe(update => {
        const tracked = this.sessions.get(session.guid);
        if (!tracked) {
          return;
        }

        const wasActive = tracked.status.isActive;
        const newEvents = update.events?.length ?? 0;

        tracked.status.isActive = update.isActive;
        if (update.isActive) {
          tracked.hasBeenActive = true;
        }
        if (newEvents > 0) {
          tracked.status.events.push(...update.events);
        }

        if (update.isActive !== wasActive || newEvents > 0) {
          this.emit();
        }
      });

    this.monitors.set(session.guid, subscription);
  }

  private stopBackgroundMonitoring(guid: string): void {
    const subscription = this.monitors.get(guid);
    if (subscription) {
      subscription.unsubscribe();
      this.monitors.delete(guid);
    }
  }

  private emit(): void {
    // Newest first, mirroring how chat lists surface the latest item on top.
    this.sessionsSubject.next(Array.from(this.sessions.values()).reverse());
  }
}
