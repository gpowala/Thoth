import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';
import { Session } from '../../../models/session';
import { ClickEvent } from '../../../models/events/click-event';
import { KeypressEvent } from '../../../models/events/keypress-event';
import { AreaSelectEvent } from '../../../models/events/area-select-event';
import { ScrollEvent } from '../../../models/events/scroll-event';
import { InputEvent } from '../../../models/events/input-event';
import { NavigationEvent } from '../../../models/events/navigation-event';
import { IEvent } from '../../../models/events/event-interface';
import { RecordingSessionService } from '../../../services/recording-session-service';


export enum TestCreationStatus {
  SESSION_SETUP = 'SESSION_SETUP',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_STOPPED = 'SESSION_STOPPED'
}

@Component({
  selector: 'app-create-test',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule
  ],
  templateUrl: './create-test.component.html',
  styleUrl: './create-test.component.css'
})
export class CreateTestComponent implements OnInit, AfterViewInit, OnDestroy {
  TestCreationStatus = TestCreationStatus;
  status: TestCreationStatus = TestCreationStatus.SESSION_SETUP;

  session: Session = new Session();
  processedEvents: IEvent[] = [];

  // Dotted flow connectors drawn behind the step cards.
  @ViewChild('flow') private flowRef?: ElementRef<HTMLElement>;
  flowPath = '';
  flowWidth = 0;
  flowHeight = 0;
  private flowResizeObserver?: ResizeObserver;
  private observedFlowEl?: HTMLElement;
  private flowRafId: number | null = null;

  repositories: Repository[] = [];
  selectedRepositoryId: number | null = null;
  testName: string = '';
  testDescription: string = '';

  linkCopied = false;
  private linkCopiedTimeout: ReturnType<typeof setTimeout> | null = null;

  private guid: string | null = null;
  private subscriptions = new Subscription();

  constructor(
    private repositoryHttpService: RepositoriesHttpService,
    private recordingSessionService: RecordingSessionService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.getRepositories();

    this.subscriptions.add(
      this.route.paramMap.subscribe(params => {
        this.guid = params.get('guid');
        this.syncFromStore();
      })
    );

    // React to live updates (session linked, new events, ...) from the store.
    this.subscriptions.add(
      this.recordingSessionService.sessions$.subscribe(() => this.syncFromStore())
    );
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.flowResizeObserver = new ResizeObserver(() => this.scheduleFlowUpdate());
    }
    this.scheduleFlowUpdate();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.linkCopiedTimeout) {
      clearTimeout(this.linkCopiedTimeout);
    }
    this.flowResizeObserver?.disconnect();
    if (this.flowRafId !== null) {
      cancelAnimationFrame(this.flowRafId);
    }
  }

  getRepositories(): void {
    this.repositoryHttpService.getRepositories().subscribe({
      next: (repos: Repository[]) => {
        this.repositories = repos;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error fetching repositories:', error);
      }
    });
  }

  createRecordingSession(): void {
    this.recordingSessionService.createRecordingSession(this.testName).subscribe({
      next: (session: Session) => {
        this.testName = '';
        this.testDescription = '';
        this.selectedRepositoryId = null;
        this.router.navigate(['/create-test', session.guid]);
      }
    });
  }

  addStepBefore(index: number): void {
    // TODO: open the "insert step" options for the position before this step.
  }

  addStepAfter(index: number): void {
    // TODO: open the "insert step" options for the position after this step.
  }

  /** Human-readable step title per event type. */
  eventTitle(event: any): string {
    switch (event.type) {
      case 'click': return 'Click';
      case 'keypress': return 'Keypress';
      case 'area-select': return 'Visual assertion';
      case 'scroll': return 'Scroll';
      case 'input': return this.inputTitle(event);
      case 'navigation': return event.navType === 'initial' ? 'Open page' : 'Navigation';
      default: return event.type;
    }
  }

  private inputTitle(event: any): string {
    switch (event.controlType) {
      case 'select': return 'Select option';
      case 'checkbox': return 'Checkbox';
      case 'radio': return 'Radio';
      default: return 'Text input';
    }
  }

  /** DOM/visual classification for the hover badge (null when the event carries none). */
  eventModality(event: any): string | null {
    return event.targetKind ?? null;
  }

  /**
   * A display-friendly view of the full captured envelope, shown on hover.
   * Heavy base64 image blobs are omitted; everything else (coordinates,
   * classifier, selectors, geometry) is surfaced so Phase 0 capture is verifiable.
   */
  eventEnvelope(event: any): any {
    const base: any = { type: event.type, id: event.id, timestamp: event.timestamp };
    switch (event.type) {
      case 'click':
        return {
          ...base,
          coordinates: { x: event.x, y: event.y },
          targetKind: event.targetKind ?? null,
          tag: event.tag ?? null,
          selectors: event.selectors ?? null,
          boundingRect: event.boundingRect ?? null
        };
      case 'keypress':
        return { ...base, keys: event.keys };
      case 'area-select':
        return {
          ...base,
          targetKind: event.targetKind ?? null,
          rect: { top: event.top, bottom: event.bottom, left: event.left, right: event.right }
        };
      case 'scroll':
        return { ...base, targetKind: event.targetKind ?? null, scroll: { x: event.x, y: event.y } };
      case 'input':
        return {
          ...base,
          controlType: event.controlType,
          value: event.value,
          checked: event.checked,
          selectedText: event.selectedText ?? null,
          targetKind: event.targetKind ?? null,
          tag: event.tag ?? null,
          selectors: event.selectors ?? null
        };
      case 'navigation':
        return { ...base, url: event.url, navType: event.navType };
      default:
        return base;
    }
  }

  /** Generate the Playwright (Python) test from the recorded events. */
  generatedScript: string | null = null;
  bundlePath: string | null = null;
  scriptCopied = false;

  generateScript(): void {
    if (!this.session.guid) {
      return;
    }
    this.recordingSessionService.generateScript(this.session.guid, this.session.name).subscribe({
      next: (result) => {
        this.generatedScript = result.script;
        this.bundlePath = result.bundlePath ?? null;
        this.cdr.detectChanges();
      },
      error: (error) => console.error('Error generating script:', error)
    });
  }

  async copyScript(): Promise<void> {
    if (!this.generatedScript) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.generatedScript);
      this.scriptCopied = true;
      setTimeout(() => {
        this.scriptCopied = false;
        this.cdr.detectChanges();
      }, 2000);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error copying script:', error);
    }
  }

  stopSession(): void {
    if (!this.session.guid) {
      return;
    }
    this.recordingSessionService.stopRecordingSession(this.session).subscribe({
      error: (error) => console.error('Error stopping session:', error)
    });
  }

  async copyLink(input: HTMLInputElement): Promise<void> {
    const url = this.session.url ?? '';
    if (!url) {
      return;
    }

    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // Fallback for non-secure contexts / older engines.
      input.focus();
      input.select();
      copied = document.execCommand('copy');
      input.setSelectionRange(0, 0);
      input.blur();
    }

    if (!copied) {
      return;
    }

    this.linkCopied = true;
    if (this.linkCopiedTimeout) {
      clearTimeout(this.linkCopiedTimeout);
    }
    this.linkCopiedTimeout = setTimeout(() => {
      this.linkCopied = false;
      this.linkCopiedTimeout = null;
      this.cdr.detectChanges();
    }, 2000);
    this.cdr.detectChanges();
  }

  private syncFromStore(): void {
    if (!this.guid) {
      this.status = TestCreationStatus.SESSION_SETUP;
      this.session = new Session();
      this.processedEvents = [];
      this.cdr.detectChanges();
      return;
    }

    const session = this.recordingSessionService.getSession(this.guid);
    if (!session) {
      // Session is unknown (e.g. after a full page reload cleared the store).
      this.router.navigate(['/create-test']);
      return;
    }

    this.session = session;
    this.status = this.deriveStatus(session);
    this.processSessionEvents(session);
    this.cdr.detectChanges();
    this.scheduleFlowUpdate();
  }

  private scheduleFlowUpdate(): void {
    if (this.flowRafId !== null) {
      cancelAnimationFrame(this.flowRafId);
    }
    this.flowRafId = requestAnimationFrame(() => {
      this.flowRafId = null;
      this.updateFlowConnectors();
    });
  }

  private updateFlowConnectors(): void {
    const container = this.flowRef?.nativeElement;
    if (!container) {
      this.flowPath = '';
      return;
    }

    this.ensureFlowObserved(container);

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.step-card'));
    this.flowWidth = container.clientWidth;
    this.flowHeight = container.clientHeight;

    if (cards.length < 2) {
      this.flowPath = '';
      this.cdr.detectChanges();
      return;
    }

    const origin = container.getBoundingClientRect();
    const boxes = cards.map(el => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - origin.left,
        right: r.right - origin.left,
        top: r.top - origin.top,
        bottom: r.bottom - origin.top,
        cx: r.left - origin.left + r.width / 2,
        cy: r.top - origin.top + r.height / 2
      };
    });

    let d = '';
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i];
      const b = boxes[i + 1];
      const sameRow = Math.abs(a.cy - b.cy) < 4;

      if (sameRow) {
        // Straight dotted connector across the column gap.
        d += this.roundedPath([[a.right, a.cy], [b.left, b.cy]], 10);
      } else {
        // Wrap: drop into the row gap, run across to the next row's first card.
        const midY = (a.bottom + b.top) / 2;
        d += this.roundedPath(
          [[a.cx, a.bottom], [a.cx, midY], [b.cx, midY], [b.cx, b.top]],
          10
        );
      }
    }

    this.flowPath = d.trim();
    this.cdr.detectChanges();
  }

  private ensureFlowObserved(el: HTMLElement): void {
    if (!this.flowResizeObserver || el === this.observedFlowEl) {
      return;
    }
    if (this.observedFlowEl) {
      this.flowResizeObserver.unobserve(this.observedFlowEl);
    }
    this.flowResizeObserver.observe(el);
    this.observedFlowEl = el;
  }

  private roundedPath(points: number[][], radius: number): string {
    if (points.length < 2) {
      return '';
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    let d = `M ${round(points[0][0])} ${round(points[0][1])} `;

    for (let i = 1; i < points.length - 1; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const len1 = Math.hypot(x1 - x0, y1 - y0) || 1;
      const len2 = Math.hypot(x2 - x1, y2 - y1) || 1;
      const r1 = Math.min(radius, len1 / 2);
      const r2 = Math.min(radius, len2 / 2);
      const ix = x1 - ((x1 - x0) / len1) * r1;
      const iy = y1 - ((y1 - y0) / len1) * r1;
      const ox = x1 + ((x2 - x1) / len2) * r2;
      const oy = y1 + ((y2 - y1) / len2) * r2;
      d += `L ${round(ix)} ${round(iy)} Q ${round(x1)} ${round(y1)} ${round(ox)} ${round(oy)} `;
    }

    const last = points[points.length - 1];
    d += `L ${round(last[0])} ${round(last[1])} `;
    return d;
  }

  private deriveStatus(session: Session): TestCreationStatus {
    if (session.status.isActive) {
      return TestCreationStatus.SESSION_STARTED;
    }
    if (session.hasBeenActive) {
      return TestCreationStatus.SESSION_STOPPED;
    }
    return TestCreationStatus.SESSION_CREATED;
  }

  private processSessionEvents(session: Session): void {
    if (!session.guid || session.status.events.length === 0) {
      this.processedEvents = [];
      return;
    }

    // Keypress grouping now happens on the backend (typing bursts arrive as a
    // single, already-merged keypress event), so mapping is a straight pass.
    const mappedEvents = session.status.events.map((event: any) => {
      const data = JSON.parse(event.data);
      switch (event.type) {
        case 'click':
          return new ClickEvent(event.id, event.timestamp, data.x, data.y, data.fullClickViewFilepath, data.minTrimmedClickViewFilepath, data.maxTrimmedClickViewFilepath, data.fullClickViewBase64, data.minTrimmedClickViewBase64, data.maxTrimmedClickViewBase64, data.targetKind, data.selectors, data.boundingRect, data.tag);
        case 'keypress':
          return new KeypressEvent(event.id, event.timestamp, data.keys);
        case 'area-select':
          return new AreaSelectEvent(event.id, event.timestamp, data.top, data.bottom, data.left, data.right, data.areaSelectViewFilepath, data.areaSelectViewBase64, data.fullViewFilepath, data.fullViewBase64, data.targetKind);
        case 'scroll':
          return new ScrollEvent(event.id, event.timestamp, data.x, data.y, data.targetKind, data.fullViewBase64);
        case 'input':
          return new InputEvent(event.id, event.timestamp, data.controlType, data.value, data.checked, data.selectedText, data.targetKind, data.selectors, data.tag, data.fullViewBase64);
        case 'navigation':
          return new NavigationEvent(event.id, event.timestamp, data.url, data.navType, data.fullViewBase64);
        default:
          throw new Error(`Unknown event type: ${event.type}`);
      }
    });

    // Order by client capture time (timestamps are ISO strings from the backend).
    mappedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    this.processedEvents = mappedEvents;
  }
}
