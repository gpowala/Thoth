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
  private recordingSessionChangedSubject = new BehaviorSubject<Session>(new Session());
  recordingSessionChanged$ = this.recordingSessionChangedSubject.asObservable();
  
  private backgroundMonitoringSubscription: Subscription | null = null;
  private currentSession: Session | null = null;
  private pollingInterval: number = 2000; // 2 seconds default
  
  constructor(private configurationProviderService: ConfigurationProviderService, private http: HttpClient) {}

  createRecordingSession(): Observable<Session> {
    return this.http.get<Session>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/create`).pipe(
      map(session => {
        session.status = new SessionStatus();
        // Automatically start background monitoring for new sessions
        this.startBackgroundMonitoring(session);
        return session;
      })
    );
  }

  destroyRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/destroy`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    }).pipe(
      map(() => {
        // Stop background monitoring when session is destroyed
        if (this.currentSession && this.currentSession.guid === session.guid) {
          this.stopBackgroundMonitoring();
        }
        return undefined;
      })
    );
  }

  startRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/start`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    });
  }

  stopRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/stop`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    });
  }

  getRecordingSessionUpdate(session: Session): Observable<SessionStatus> {
    return this.http.get<SessionStatus>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/update`, {
        params: {
            guid: encodeURIComponent(session.guid),
            nextEventId: encodeURIComponent(session.status.events.length)
        }
    });
  }

  ngOnDestroy(): void {
    this.currentSession ? this.destroyRecordingSession(this.currentSession) : this.stopBackgroundMonitoring();
  }

  private startBackgroundMonitoring(session: Session, intervalMs?: number): void {
    // Stop any existing monitoring
    this.stopBackgroundMonitoring();
    
    this.currentSession = session;
    if (intervalMs) {
      this.pollingInterval = intervalMs;
    }

    this.backgroundMonitoringSubscription = interval(this.pollingInterval)
      .pipe(
        switchMap(() => this.getRecordingSessionUpdate(session)),
        catchError(error => {
          console.error('Error checking session status:', error);
          // Return false and 0 events on error to indicate session is not active
          return [new SessionStatus()];
        })
      )
      .subscribe(sessionUpdate => {
        if (this.currentSession) {
          const shouldEmitChange = sessionUpdate.isActive !== this.currentSession.status.isActive || sessionUpdate.events.length !== 0;
          const previousSessionStatus = this.currentSession.status;
          
          this.currentSession.status.isActive = sessionUpdate.isActive;
          this.currentSession.status.events.push(...sessionUpdate.events);
                
          if (shouldEmitChange) {
            this.emitRecordingSessionChanged(this.currentSession);
          }
        }
      });
  }

  private stopBackgroundMonitoring(): void {
    if (this.backgroundMonitoringSubscription) {
      this.backgroundMonitoringSubscription.unsubscribe();
      this.backgroundMonitoringSubscription = null;
    }
    this.currentSession = null;
  }

  private emitRecordingSessionChanged(session: Session) {
    this.recordingSessionChangedSubject.next(session);
  }
}
