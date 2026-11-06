import { Injectable } from '@angular/core';

/**
 * Optional bridge to the desktop shell (TestsManager/Desktop preload script).
 * In a regular browser `window.thothDesktop` is undefined and every method
 * degrades gracefully, so the web app never depends on Electron.
 */
interface ThothDesktopApi {
  isDesktop: boolean;
  selectDirectory(): Promise<string | null>;
}

@Injectable({
  providedIn: 'root'
})
export class ElectronIpcService {
  private get desktop(): ThothDesktopApi | undefined {
    return (window as any).thothDesktop;
  }

  get isDesktop(): boolean {
    return !!this.desktop?.isDesktop;
  }

  async selectDirectory(): Promise<string | null> {
    return this.desktop ? await this.desktop.selectDirectory() : null;
  }
}
