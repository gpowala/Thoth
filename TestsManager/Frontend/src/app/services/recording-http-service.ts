import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Session, SessionStatus } from '../models/session';
import { ConfigurationProviderService } from './configuration-provider-service';

@Injectable({
  providedIn: 'root'
})
export class RecordingHttpService {
  constructor(private configurationProviderService: ConfigurationProviderService, private http: HttpClient) {}


  createRecordingSession(): Observable<Session> {
    return this.http.get<Session>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/create`).pipe(
      map(session => {
        session.status = new SessionStatus();
        return session;
      })
    );
  }

  destroyRecordingSession(session: Session): Observable<void> {
    return this.http.get<void>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/destroy`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    });
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

  isRecordingSessionActive(session: Session): Observable<boolean> {
    return this.http.get<boolean>(`${this.configurationProviderService.backendApiBaseUrl}/recording/session/is-active`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    });
  }

  getRecordedEvents(session: Session): Observable<any[]> {
    return this.http.get<any[]>(`${this.configurationProviderService.backendApiBaseUrl}/recording/events`, {
        params: {
            guid: encodeURIComponent(session.guid)
        }
    });
  }
}
