import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';

@Component({
  selector: 'app-manage-tests',
  standalone: true,
  imports: [CommonModule, MatTabsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCardModule, MatSelectModule],
  templateUrl: './manage-tests.component.html',
  styleUrl: './manage-tests.component.css'
})
export class ManageTestsComponent {
  selectedTabIndex: number = 0;

  repositories: Repository[] = [];

  constructor(private repositoryHttpService: RepositoriesHttpService) {
    this.getRepositories();
  }

  onTabChange(index: number) {
    this.selectedTabIndex = index;
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
}
