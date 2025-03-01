import { Routes } from '@angular/router';
import { RepositoriesComponent } from './components/pages/repositories/repositories.component';
import { ScriptsComponent } from './components/pages/scripts/scripts.component';
import { ManageTestsComponent } from './components/pages/manage-tests/manage-tests.component';
import { CreateTestComponent } from './components/pages/create-test/create-test.component';

export const routes: Routes = [
  { path: '', redirectTo: 'repositories', pathMatch: 'full' },
  { path: 'repositories', component: RepositoriesComponent },
  { path: 'scripts', component: ScriptsComponent },
  { path: 'manage-tests', component: ManageTestsComponent },
  { path: 'create-test', component: CreateTestComponent }
];
