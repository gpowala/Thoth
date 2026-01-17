import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import {MatButtonModule} from '@angular/material/button';
import {MatInputModule} from '@angular/material/input';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatTableModule} from '@angular/material/table';
import {MatIconModule} from '@angular/material/icon';
import {MatSnackBar} from '@angular/material/snack-bar';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-repositories',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    CommonModule,
    FormsModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './repositories.component.html',
  styleUrl: './repositories.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoriesComponent {
  repositories: Repository[] = [];

  displayedColumns: string[] = ['name', 'localDirectory', 'description'];

  expandRow: boolean = false;
  rowHovered: boolean = false;

  repositoryName: string = "";
  repositoryUrl: string = "";
  repositoryUser: string = "";
  repositoryToken: string = "";
  repositoryLocalDirectory: string = "";

  private _snackBar = inject(MatSnackBar);
  isCloningRespotitory: boolean = false;
  isSelectingDirectory: boolean = false;
  isDirectoryDialogOpen: boolean = false;
  isAddRepositoryDialogOpen: boolean = false;
  directoryDialogMessage: string = "";
  currentDirectoryPath: string = "";
  currentDirectoryParentPath: string = "";
  isCurrentDirectoryRoot: boolean = true;
  directoryEntries: { name: string; path: string; hasChildren: boolean }[] = [];

  constructor(
    private repositoryHttpService: RepositoriesHttpService,
    private cdr: ChangeDetectorRef
  ) {
    this.getRepositories();
  }

  browseForDirectory() {
    this.directoryDialogMessage = "";
    this.isDirectoryDialogOpen = true;
    this.cdr.detectChanges();
    const initialPath = this.repositoryLocalDirectory?.trim();
    this.loadDirectoryEntries(initialPath ? initialPath : undefined, Boolean(initialPath));
  }

  openAddRepositoryDialog() {
    this.isAddRepositoryDialogOpen = true;
    this.cdr.detectChanges();
  }

  closeAddRepositoryDialog() {
    if (this.isCloningRespotitory) {
      return;
    }
    this.isAddRepositoryDialogOpen = false;
    this.cdr.detectChanges();
  }

  closeDirectoryDialog() {
    if (this.isSelectingDirectory) {
      return;
    }
    this.isDirectoryDialogOpen = false;
    this.directoryDialogMessage = "";
    this.cdr.detectChanges();
  }

  selectCurrentDirectory() {
    if (!this.currentDirectoryPath) {
      this.directoryDialogMessage = "Select a folder before continuing.";
      this.cdr.detectChanges();
      return;
    }
    this.repositoryLocalDirectory = this.currentDirectoryPath;
    this.isDirectoryDialogOpen = false;
    this.directoryDialogMessage = "";
    this.cdr.detectChanges();
  }

  loadDirectoryEntries(path?: string, allowFallback: boolean = false) {
    if (this.isSelectingDirectory) {
      return;
    }

    this.isSelectingDirectory = true;
    this.directoryDialogMessage = "";
    this.cdr.detectChanges();

    this.repositoryHttpService.listDirectories(path).subscribe({
      next: (response) => {
        this.isSelectingDirectory = false;
        this.currentDirectoryPath = response.currentPath;
        this.currentDirectoryParentPath = response.parentPath;
        this.isCurrentDirectoryRoot = response.isRoot;
        this.directoryEntries = response.entries;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSelectingDirectory = false;
        if (allowFallback && path) {
          this.directoryDialogMessage = "Selected path was not found. Showing roots instead.";
          this.cdr.detectChanges();
          this.loadDirectoryEntries();
          return;
        }
        this.directoryDialogMessage = "Unable to load directories.";
        this.cdr.detectChanges();
      }
    });
  }

  openDirectory(entry: { name: string; path: string; hasChildren: boolean }) {
    this.loadDirectoryEntries(entry.path);
  }

  goUpDirectory() {
    if (this.isCurrentDirectoryRoot) {
      return;
    }
    if (!this.currentDirectoryParentPath) {
      this.loadDirectoryEntries();
      return;
    }
    this.loadDirectoryEntries(this.currentDirectoryParentPath);
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

  registerRepository(): void {
    if (!this.repositoryName || !this.repositoryUrl || !this.repositoryUser || !this.repositoryToken || !this.repositoryLocalDirectory) {
      this.openSnackBar('Please fill in all fields!', 'Close');
      return;
    }

    this.isCloningRespotitory = true;

    const newRepository: Repository = {
      id: 0, // The backend will assign the actual ID
      name: this.repositoryName,
      url: this.repositoryUrl,
      user: this.repositoryUser,
      token: this.repositoryToken,
      directory: this.repositoryLocalDirectory
    };

    this.repositoryHttpService.registerRepository(newRepository).subscribe({
      next: (registeredRepo: Repository) => {
        this.getRepositories();

        this.clearNewRepositoryData();

        this.isCloningRespotitory = false;
        this.isAddRepositoryDialogOpen = false;
        this.cdr.detectChanges()

        this.openSnackBar('Repository registered successfully!', 'Close');
      },
      error: (error) => {
        this.getRepositories();

        this.clearNewRepositoryData();

        this.isCloningRespotitory = false;
        this.cdr.detectChanges()

        this.openSnackBar(`Failed to register repository! Error: ${error}`, 'Close');
      }
    });
  }

  unregisterRepository(repositoryId: number): void {
    this.repositoryHttpService.unregisterRepository(repositoryId.toString()).subscribe({
      next: () => {
        this.repositories = this.repositories.filter(repo => repo.id !== repositoryId);
        console.log('Repository unregistered successfully');
        this.getRepositories();
      },
      error: (error) => {
        console.error('Error unregistering repository:', error);
      }
    });
  }

  clearNewRepositoryData() {
    this.repositoryName = "";
    this.repositoryUrl = "";
    this.repositoryUser = "";
    this.repositoryToken = "";
    this.repositoryLocalDirectory = "";
  }

  openSnackBar(message: string, action: string) {
    this._snackBar.open(message, action);
  }

  onMouseOver(event: MouseEvent) {
    (event.currentTarget as HTMLElement).style.backgroundColor = '#f0f0f0';
  }

  onMouseOut(event: MouseEvent) {
    (event.currentTarget as HTMLElement).style.backgroundColor = '';
  }
}
