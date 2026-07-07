import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigurationProviderService } from './configuration-provider-service';

export interface AppConfiguration {
  databasePath: string;
  defaultDatabasePath: string;
  terminatedSessions?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ConfigurationHttpService {
  constructor(
    private configurationProviderService: ConfigurationProviderService,
    private http: HttpClient
  ) {}

  getConfiguration(): Observable<AppConfiguration> {
    return this.http.get<AppConfiguration>(
      `${this.configurationProviderService.backendApiBaseUrl}/configuration`
    );
  }

  updateConfiguration(databasePath: string): Observable<AppConfiguration> {
    return this.http.put<AppConfiguration>(
      `${this.configurationProviderService.backendApiBaseUrl}/configuration`,
      { databasePath }
    );
  }
}
