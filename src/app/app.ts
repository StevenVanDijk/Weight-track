import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly title = 'WeightTrack';

  readonly navItems = [
    { path: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
    { path: '/add', icon: 'add_circle', label: 'Add' },
    { path: '/chart', icon: 'show_chart', label: 'Chart' },
    { path: '/history', icon: 'history', label: 'History' },
  ];
}
