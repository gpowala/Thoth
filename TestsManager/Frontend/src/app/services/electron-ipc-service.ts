import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ElectronIpcService {
  private sessionStatusSubject = new BehaviorSubject<void>(undefined);
  sessionStatus$ = this.sessionStatusSubject.asObservable();

  private browserEventRegisteredSubject = new BehaviorSubject<void>(undefined);
  browserEventRegistered$ = this.browserEventRegisteredSubject.asObservable();

  private backendPortSubject = new BehaviorSubject<number>(3000);
  backendPortSubject$ = this.backendPortSubject.asObservable();

  constructor() {
    console.log('ElectronIpcService created.');

    if ((window as any).electronAPI) {
      (window as any).electronAPI.onBackendEvent((message: string) => {
        if (message === 'SESSION_STATUS_CHANGED') {
          console.log('ElectronIpcService: Session status changed.');
          this.sessionStatusSubject.next(undefined);
        }
        if (message === 'CLICK_EVENT_REGISTERED') {
          console.log('ElectronIpcService: Click event registered.');
          this.browserEventRegisteredSubject.next(undefined);
        }
        if (message === 'KEYPRESS_EVENT_REGISTERED') {
          console.log('ElectronIpcService: Keypress event registered.');
          this.browserEventRegisteredSubject.next(undefined);
        }
      });

      (window as any).electronAPI.onBackendReady((port: number) => {
        console.log('ElectronIpcService: Backend port changed to ', port);
        this.backendPortSubject.next(port);
      });
    }
  }

  async selectDirectory() {
    if ((window as any).electronAPI)
      return await (window as any).electronAPI.onFrontendSelectDirectory();
  }
}
