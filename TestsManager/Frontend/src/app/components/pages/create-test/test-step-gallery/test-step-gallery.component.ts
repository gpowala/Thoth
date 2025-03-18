import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Repository } from '../../../../models/repository';
import { RepositoriesHttpService } from '../../../../services/repositories-http-service';

// Export the enum and interfaces so they can be imported by other components
export enum GalleryImageType {
  FULL = 'FULL',
  CROPPED = 'CROPPED',
  FOCUSED = 'FOCUSED',
}

export interface GalleryImage {
  type: GalleryImageType;
  src: string;
}

export interface TestStepGalleryComponentData {
  index: number;
  title: string;
  description: string;
  details: string;
  images: GalleryImage[];
}

@Component({
  selector: 'app-test-step-gallery',
  standalone: true,
  imports: [CommonModule, MatTabsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCardModule, MatSelectModule],
  templateUrl: './test-step-gallery.component.html',
  styleUrl: './test-step-gallery.component.css'
})
export class TestStepGalleryComponent implements OnInit {
  @Input() data!: TestStepGalleryComponentData;

  constructor() {
  }

  ngOnInit(): void {
    if (!this.data) {
      throw new Error('Data is required');
    }
  }

  // Example method that modifies the data
  updateTitle(newTitle: string): void {
    this.data.title = newTitle;
    // No need to emit an event as the reference is maintained
  }
}
