import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import {MatButtonModule} from '@angular/material/button';
import {MatInputModule} from '@angular/material/input';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatTableModule} from '@angular/material/table';
import {MatIconModule} from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';

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
    CommonModule
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

  constructor(private repositoryHttpService: RepositoriesHttpService) {
    this.getRepositories();
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

  registerRepository(name: string, directory: string, description: string): void {
    const newRepository: Repository = {
      id: 0, // The backend will assign the actual ID
      name,
      directory,
      description
    };

    this.repositoryHttpService.registerRepository(newRepository).subscribe({
      next: (registeredRepo: Repository) => {
        this.repositories.push(registeredRepo);
        this.expandRow = false; // Close the form after successful registration
        console.log('Repository registered successfully:', registeredRepo);
        this.getRepositories();
      },
      error: (error) => {
        console.error('Error registering repository:', error);
      }
    });

    this.expandRow = !this.expandRow;
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
}
