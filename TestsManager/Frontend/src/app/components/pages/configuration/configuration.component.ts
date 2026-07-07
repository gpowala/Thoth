import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConfigurationHttpService } from '../../../services/configuration-http-service';
import { RecordingSessionService } from '../../../services/recording-session-service';

@Component({
  selector: 'app-configuration',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './configuration.component.html',
  styleUrl: './configuration.component.css'
})
export class ConfigurationComponent implements OnInit {
  databasePath = '';
  defaultDatabasePath = '';
  isSaving = false;
  isConfirmOpen = false;

  private _snackBar = inject(MatSnackBar);

  constructor(
    private configService: ConfigurationHttpService,
    private recordingSessionService: RecordingSessionService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.configService.getConfiguration().subscribe({
      next: (cfg) => {
        this.databasePath = cfg.databasePath;
        this.defaultDatabasePath = cfg.defaultDatabasePath;
        this.cdr.detectChanges();
      },
      error: () => this.openSnackBar('Failed to load configuration.')
    });
  }

  resetToDefault(): void {
    this.databasePath = this.defaultDatabasePath;
  }

  requestSave(): void {
    if (!this.databasePath?.trim()) {
      this.openSnackBar('Database path is required.');
      return;
    }
    this.isConfirmOpen = true;
    this.cdr.detectChanges();
  }

  cancelSave(): void {
    this.isConfirmOpen = false;
    this.cdr.detectChanges();
  }

  confirmSave(): void {
    this.isConfirmOpen = false;
    this.isSaving = true;
    this.cdr.detectChanges();

    this.configService.updateConfiguration(this.databasePath.trim()).subscribe({
      next: (cfg) => {
        this.databasePath = cfg.databasePath;
        // The backend terminated the sessions — drop them from the menu too.
        this.recordingSessionService.clearSessions();
        this.isSaving = false;
        const terminated = cfg.terminatedSessions ?? 0;
        this.openSnackBar(
          `Database updated.${terminated ? ` ${terminated} recording session(s) ended.` : ''}`
        );
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSaving = false;
        this.openSnackBar('Failed to update database path. Previous database kept.');
        this.cdr.detectChanges();
      }
    });
  }

  openSnackBar(message: string): void {
    this._snackBar.open(message, 'Close', { duration: 4000 });
  }
}
