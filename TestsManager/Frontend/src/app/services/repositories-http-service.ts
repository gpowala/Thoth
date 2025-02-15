import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Repository } from '../models/repository';
import { ConfigurationProviderService } from './configuration-provider-service';


@Injectable({
  providedIn: 'root'
})
export class RepositoriesHttpService {
  constructor(private configurationProviderService: ConfigurationProviderService, private http: HttpClient) {}

  registerRepository(repository: Repository): Observable<Repository> {
    return this.http.get<Repository>(`${this.configurationProviderService.backendApiBaseUrl}/repository`, {
        params: {
            name: encodeURIComponent(repository.name),
            directory: encodeURIComponent(repository.directory),
            description: encodeURIComponent(repository.description),
        }
    });
  }

  unregisterRepository(repositoryId: string): Observable<void> {
    return this.http.delete<void>(`${this.configurationProviderService.backendApiBaseUrl}/repository`, {
      params: {
          id: repositoryId
      }
  });
  }

  getRepositories(): Observable<Repository[]> {
    return this.http.get<Repository[]>(this.configurationProviderService.backendApiBaseUrl + '/repositories');
  }
}
