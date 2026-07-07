import { Component, EventEmitter, Output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { RecordingSessionService } from '../../../services/recording-session-service';
import { Session } from '../../../models/session';

type SessionState = 'recording' | 'stopped' | 'waiting';

@Component({
  selector: 'app-main-nav-bar',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule],
  templateUrl: './main-nav-bar.component.html',
  styleUrl: './main-nav-bar.component.css'
})
export class MainNavBarComponent {
  isExpanded = true;
  sessions$: Observable<Session[]>;

  @Output() navBarToggled = new EventEmitter<boolean>();

  constructor(
    public router: Router,
    private recordingSessionService: RecordingSessionService
  ) {
    this.sessions$ = this.recordingSessionService.sessions$;
  }

  sessionState(session: Session): SessionState {
    if (session.status.isActive) {
      return 'recording';
    }
    if (session.hasBeenActive) {
      return 'stopped';
    }
    return 'waiting';
  }

  sessionStateLabel(session: Session): string {
    switch (this.sessionState(session)) {
      case 'recording': return 'Recording';
      case 'stopped': return 'Stopped';
      default: return 'Waiting to connect';
    }
  }

  toggleNavBar() {
    this.isExpanded = !this.isExpanded;
    this.navBarToggled.emit(this.isExpanded);
  }
}
