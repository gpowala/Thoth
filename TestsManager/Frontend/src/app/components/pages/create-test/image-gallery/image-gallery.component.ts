import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface GalleryImage {
  src: string;
  title: string;
}

interface GalleryData {
  images: GalleryImage[];
}

@Component({
  selector: 'app-image-gallery',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="gallery-container">
      <div class="gallery-header">
        <h2>{{ images[currentIndex].title }}</h2>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <div class="gallery-content">
        <button *ngIf="images.length > 1" mat-icon-button class="nav-button prev" (click)="prev()" [disabled]="currentIndex === 0">
          <mat-icon>chevron_left</mat-icon>
        </button>
        
        <div class="image-container">
          <img [src]="images[currentIndex].src" [alt]="images[currentIndex].title">
        </div>
        
        <button *ngIf="images.length > 1" mat-icon-button class="nav-button next" (click)="next()" [disabled]="currentIndex === images.length - 1">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
      
      <div *ngIf="images.length > 1" class="thumbnails">
        <div 
          *ngFor="let image of images; let i = index" 
          class="thumbnail" 
          [class.active]="i === currentIndex"
          (click)="setImage(i)"
        >
          <img [src]="image.src" [alt]="image.title">
        </div>
      </div>
    </div>
  `,
  styles: [`
    .gallery-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: var(--surface-1);
      color: var(--text-1);
    }

    .gallery-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }

    .gallery-header h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-1);
    }

    .gallery-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 24px;
      background: var(--bg-sunken);
    }

    .image-container {
      max-height: 100%;
      max-width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .image-container img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
      border-radius: var(--radius-sm);
    }

    .nav-button {
      position: absolute;
      background-color: var(--surface-3);
      color: var(--text-1);
      z-index: 2;
    }

    .nav-button.prev {
      left: 12px;
    }

    .nav-button.next {
      right: 12px;
    }

    .thumbnails {
      display: flex;
      justify-content: center;
      gap: 10px;
      padding: 12px;
      border-top: 1px solid var(--border);
      overflow-x: auto;
    }

    .thumbnail {
      width: 60px;
      height: 60px;
      border: 2px solid transparent;
      border-radius: var(--radius-sm);
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    .thumbnail.active {
      border-color: var(--accent);
    }

    .thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `]
})
export class ImageGalleryComponent {
  images: GalleryImage[] = [];
  currentIndex = 0;
  
  constructor(
    public dialogRef: MatDialogRef<ImageGalleryComponent>,
    @Inject(MAT_DIALOG_DATA) public data: GalleryData
  ) {
    this.images = data.images;
  }
  
  close(): void {
    this.dialogRef.close();
  }
  
  prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    }
  }
  
  next(): void {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++;
    }
  }
  
  setImage(index: number): void {
    this.currentIndex = index;
  }
} 