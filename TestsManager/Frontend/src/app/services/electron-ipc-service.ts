import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ElectronIpcService {
  private backendPortSubject = new BehaviorSubject<number>(3000);
  backendPortSubject$ = this.backendPortSubject.asObservable();

  constructor() {
    if ((window as any).electronAPI) {
      console.log('ElectronIpcService created and connected to backend.');
      (window as any).electronAPI.onBackendReady((port: number) => {
        console.log('ElectronIpcService: Backend port changed to ', port);
        this.backendPortSubject.next(port);
      });
    }
  }

  async selectDirectory() {
    if ((window as any).electronAPI)
      return await (window as any).electronAPI.onFrontendSelectDirectory();
    else
      return null;
  }
}
