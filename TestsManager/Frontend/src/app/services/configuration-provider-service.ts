import { Injectable } from '@angular/core';

export interface RuntimeConfig {
  backendApiBaseUrl: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  backendApiBaseUrl: 'http://localhost:3000'
};

/**
 * Runtime (not build-time) configuration, read from `config.json` next to
 * index.html before the app bootstraps. Deployments can edit that file without
 * rebuilding; the desktop shell serves its own version pointing at its backend.
 */
@Injectable({
  providedIn: 'root'
})
export class ConfigurationProviderService {
  backendApiBaseUrl = DEFAULT_CONFIG.backendApiBaseUrl;

  async load(): Promise<void> {
    try {
      const response = await fetch('config.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const config = (await response.json()) as Partial<RuntimeConfig>;
      if (config.backendApiBaseUrl?.trim()) {
        this.backendApiBaseUrl = config.backendApiBaseUrl.trim().replace(/\/+$/, '');
      }
    } catch (error) {
      console.warn(`Could not load config.json, using default backend ${this.backendApiBaseUrl}:`, error);
    }
  }
}
