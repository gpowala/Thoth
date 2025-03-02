import { ChangeDetectorRef, Component, NgZone, AfterViewInit, HostListener, ViewChildren, QueryList, ElementRef, Renderer2, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
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
import { ImageGalleryComponent } from './image-gallery/image-gallery.component';


export enum TestCreationStatus {
  DEFINING_TEST = 'DEFINING_TEST',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_STOPPED = 'SESSION_STOPPED'
}

@Component({
  selector: 'app-create-test',
  standalone: true,
  imports: [
    CommonModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatButtonModule, 
    MatCardModule, 
    MatSelectModule,
    MatIconModule,
    MatDialogModule
  ],
  templateUrl: './create-test.component.html',
  styleUrl: './create-test.component.css'
})
export class CreateTestComponent implements AfterViewInit, OnDestroy {
  TestCreationStatus = TestCreationStatus;
  status: TestCreationStatus = TestCreationStatus.DEFINING_TEST;
  
  session: Session = new Session();
  events: IEvent[] = [];

  repositories: Repository[] = [];

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor(
    private repositoryHttpService: RepositoriesHttpService,
    private recordingHttpService: RecordingHttpService,
    private electronIpcService: ElectronIpcService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private dialog: MatDialog,
    private renderer: Renderer2
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
            const mappedEvents = events.map((event: any) => {
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
            });
            
            mappedEvents.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            
            const processedEvents: IEvent[] = [];
            let currentKeypressGroup: KeypressEvent[] = [];
            
            mappedEvents.forEach((event) => {
              if (event instanceof KeypressEvent) {
                currentKeypressGroup.push(event);
              } else {
                if (currentKeypressGroup.length > 0) {
                  processedEvents.push(this.mergeKeypressEvents(currentKeypressGroup));
                  currentKeypressGroup = [];
                }
                processedEvents.push(event);
              }
            });
            
            if (currentKeypressGroup.length > 0) {
              processedEvents.push(this.mergeKeypressEvents(currentKeypressGroup));
            }
            
            this.events = processedEvents;
            this.cdr.detectChanges();
          }
        });
      });
    });
  }

  ngAfterViewInit() {
    this.initializeObservers();
  }

  ngOnDestroy() {
    this.cleanupObservers();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateAllPreviewPositions();
  }

  @HostListener('window:scroll')
  onScroll() {
    this.updateAllPreviewPositions();
  }

  private initializeObservers() {
    // Create a ResizeObserver to detect changes in element sizes
    this.resizeObserver = new ResizeObserver(() => {
      this.updateAllPreviewPositions();
    });

    // Create a MutationObserver to detect when new events are added
    this.mutationObserver = new MutationObserver((mutations) => {
      this.setupPreviewContainers();
    });

    // Start observing the container for added nodes
    const container = document.querySelector('.container');
    if (container) {
      this.mutationObserver.observe(container, { childList: true, subtree: true });
    }

    // Initial setup
    setTimeout(() => {
      this.setupPreviewContainers();
    }, 100);
  }

  private cleanupObservers() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  private setupPreviewContainers() {
    const previewContainers = document.querySelectorAll('.image-preview-container');
    
    previewContainers.forEach(container => {
      // Observe each container for size changes
      if (this.resizeObserver) {
        this.resizeObserver.observe(container);
      }

      const button = container.querySelector('.gallery-button') as HTMLElement;
      const preview = container.querySelector('.hover-preview') as HTMLElement;
      
      if (button && preview) {
        // We don't need to clone the button anymore as it breaks Angular event binding
        // Instead, just add our positioning logic
        
        // Add mouseenter event to position the preview
        container.addEventListener('mouseenter', () => {
          this.positionPreview(container as HTMLElement, preview);
        });
      }
    });

    // Initial positioning update
    this.updateAllPreviewPositions();
  }

  private updateAllPreviewPositions() {
    const previewContainers = document.querySelectorAll('.image-preview-container');
    
    previewContainers.forEach(container => {
      const preview = container.querySelector('.hover-preview') as HTMLElement;
      if (preview) {
        this.positionPreview(container as HTMLElement, preview);
      }
    });
  }

  private positionPreview(container: HTMLElement, preview: HTMLElement) {
    // Get container position
    const containerRect = container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Calculate preview height without making it visible
    // Clone the preview to measure it without affecting the display
    const previewClone = preview.cloneNode(true) as HTMLElement;
    previewClone.style.display = 'block';
    previewClone.style.visibility = 'hidden';
    previewClone.style.position = 'absolute';
    previewClone.style.pointerEvents = 'none';
    document.body.appendChild(previewClone);
    
    // Get preview height from the clone
    const previewHeight = previewClone.offsetHeight;
    
    // Remove the clone
    document.body.removeChild(previewClone);
    
    // Check if there's enough space below
    const spaceBelow = viewportHeight - containerRect.bottom;
    const spaceAbove = containerRect.top;
    
    if (spaceBelow < previewHeight && spaceAbove > spaceBelow) {
      // Not enough space below and more space above, show above
      this.renderer.setStyle(preview, 'bottom', '100%');
      this.renderer.setStyle(preview, 'top', 'auto');
      this.renderer.setStyle(preview, 'margin-bottom', '8px');
      this.renderer.setStyle(preview, 'margin-top', '0');
    } else {
      // Either enough space below or not enough space above, show below
      this.renderer.setStyle(preview, 'top', '100%');
      this.renderer.setStyle(preview, 'bottom', 'auto');
      this.renderer.setStyle(preview, 'margin-top', '8px');
      this.renderer.setStyle(preview, 'margin-bottom', '0');
    }
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

  private mergeKeypressEvents(keypressEvents: KeypressEvent[]): KeypressEvent {
    if (keypressEvents.length === 0) {
      throw new Error('Cannot merge empty keypress events array');
    }
    
    if (keypressEvents.length === 1) {
      return keypressEvents[0];
    }

    const lastEvent = keypressEvents[keypressEvents.length - 1];

    const combinedKeys = keypressEvents.reduce((allKeys, event) => {
      return allKeys.concat(event.keys);
    }, [] as string[]);
    
    return new KeypressEvent(
      lastEvent.id,
      lastEvent.timestamp,
      combinedKeys.join('')
    );
  }

  openGallery(event: ClickEvent): void {
    this.dialog.open(ImageGalleryComponent, {
      width: '80%',
      height: '80%',
      data: {
        images: [
          { 
            src: 'data:image/png;base64,' + event.fullClickViewBase64, 
            title: 'Full View' 
          },
          { 
            src: 'data:image/png;base64,' + event.maxTrimmedClickViewBase64, 
            title: 'Max Trimmed View' 
          },
          { 
            src: 'data:image/png;base64,' + event.minTrimmedClickViewBase64, 
            title: 'Min Trimmed View' 
          }
        ]
      }
    });
  }

  openAreaGallery(event: AreaSelectEvent): void {
    this.dialog.open(ImageGalleryComponent, {
      width: '80%',
      height: '80%',
      data: {
        images: [
          { 
            src: 'data:image/png;base64,' + event.areaSelectViewBase64, 
            title: 'Area Selection' 
          }
        ]
      }
    });
  }
}
