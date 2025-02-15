import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, skip } from 'rxjs';
import { Repository } from '../models/repository';
import { ElectronIpcService } from './electron-ipc-service';

@Injectable({
  providedIn: 'root'
})
export class ConfigurationProviderService {
  backendApiBaseUrl = 'http://localhost:3000';

  constructor(private http: HttpClient, private electronIpcService: ElectronIpcService) {
    this.electronIpcService.backendPortSubject$.pipe(skip(1)).subscribe((port: number) => {
        this.backendApiBaseUrl = `http://localhost:${port}`;
    });
  }
}
