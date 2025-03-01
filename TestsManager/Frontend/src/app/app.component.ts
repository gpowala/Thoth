import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainNavBarComponent } from "./components/navigation/main-nav-bar/main-nav-bar.component";
import { ElectronIpcService } from './services/electron-ipc-service';
import { ConfigurationProviderService } from './services/configuration-provider-service';
import { InternalEventsBusService } from './services/internal-events-bus-service';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MainNavBarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'thot-test-manager';
  
  constructor(private ipcService: ElectronIpcService, private configurationProviderService: ConfigurationProviderService, private internalEventsBusService: InternalEventsBusService) {}
}
