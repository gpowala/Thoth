import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { Repository } from '../../../models/repository';
import { RepositoriesHttpService } from '../../../services/repositories-http-service';

@Component({
  selector: 'app-manage-tests',
  standalone: true,
  imports: [MatTabsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule],
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
