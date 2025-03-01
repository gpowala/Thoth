import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class InternalEventsBusService {
  private repositoriesChangedSubject = new BehaviorSubject<void>(undefined);
  repositoriesChanged$ = this.repositoriesChangedSubject.asObservable();

  constructor() {
    console.log('InternalEventsBusService created.');
  }

  emitRepositoriesChanged() {
    this.repositoriesChangedSubject.next(undefined);
  }
}