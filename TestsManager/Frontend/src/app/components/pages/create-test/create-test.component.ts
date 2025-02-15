import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';
import { ElectronIpcService } from '../../../services/electron-ipc-service';
import { RecordingHttpService } from '../../../services/recording-http-service';
import { Session } from '../../../models/session';
import { skip } from 'rxjs';
import { ClickEvent } from '../../../models/events/click-event';
import { KeypressEvent } from '../../../models/events/keypress-event';
import { AreaSelectEvent } from '../../../models/events/area-select-event';
import { IEvent } from '../../../models/events/event-interface';


export enum TestCreationStatus {
  DEFINING_TEST = 'DEFINING_TEST',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_STOPPED = 'SESSION_STOPPED'
}

@Component({
  selector: 'app-create-test',
  standalone: true,
  imports: [CommonModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCardModule, MatSelectModule],
  templateUrl: './create-test.component.html',
  styleUrl: './create-test.component.css'
})
export class CreateTestComponent {
  TestCreationStatus = TestCreationStatus;
  status: TestCreationStatus = TestCreationStatus.DEFINING_TEST;
  
  session: Session = new Session();
  events: IEvent[] = [];

  repositories: Repository[] = [];

  constructor(
    private repositoryHttpService: RepositoriesHttpService,
    private recordingHttpService: RecordingHttpService,
    private electronIpcService: ElectronIpcService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.getRepositories();

    this.electronIpcService.sessionStatus$.pipe(skip(1)).subscribe(() => {
        this.recordingHttpService.isRecordingSessionActive(this.session).subscribe({
          next: (isActive: boolean) => {
            if (isActive) {
              this.session.status.isActive = isActive;
              this.status = TestCreationStatus.SESSION_STARTED;
            }
          }

        });
    });

    this.ngZone.run(() => {
      this.electronIpcService.browserEventRegistered$.pipe(skip(1)).subscribe(() => {
        this.recordingHttpService.getRecordedEvents(this.session).subscribe({
          next: (events: any[]) => {
            this.events = [...events.map((event: any) => {
              const data = JSON.parse(event.data);
              switch (event.type) {
                case 'click':
                  return new ClickEvent(event.id, event.timestamp, data.x, data.y, data.fullClickViewFilepath, data.minTrimmedClickViewFilepath, data.maxTrimmedClickViewFilepath, data.fullClickViewBase64, data.minTrimmedClickViewBase64, data.maxTrimmedClickViewBase64);
                case 'keypress':
                  return new KeypressEvent(event.id, event.timestamp, data.keys);
                case 'area-select':
                  return new AreaSelectEvent(event.id, event.timestamp, data.top, data.bottom, data.left, data.right, data.areaSelectViewFilepath, data.areaSelectViewBase64);
                default:
                  throw new Error(`Unknown event type: ${event.type}`);
              }
            })];
            this.cdr.detectChanges();
          }
        });
      });
    });
  }

  getRepositories(): void {
    this.repositoryHttpService.getRepositories().subscribe({
      next: (repos: Repository[]) => {
        this.repositories = repos;
      },
      error: (error) => {
        console.error('Error fetching repositories:', error);
      }
    });
  }

  createRecordingSession(): void {
    this.recordingHttpService.createRecordingSession().subscribe({
      next: (session: Session) => {
        this.session = session;
        console.log('Session created:', this.session);
        this.status = TestCreationStatus.SESSION_CREATED;
      }
    });
  }

  trackByFn(index: number, event: IEvent): string {
    return event.id;
  }
}
