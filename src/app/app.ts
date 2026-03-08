import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AchievementToastComponent } from './components/achievement-toast/achievement-toast';
import { BUILD_INFO } from '../build-info';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AchievementToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly title = 'WeightTrack';
  readonly buildCommit = BUILD_INFO.commit;

  readonly navItems = [
    { path: '/dashboard',    icon: 'dashboard',   label: 'Home' },
    { path: '/add',          icon: 'add_circle',  label: 'Log' },
    { path: '/chart',        icon: 'show_chart',  label: 'Chart' },
    { path: '/history',      icon: 'history',     label: 'History' },
    { path: '/achievements', icon: 'emoji_events', label: 'Awards' },
  ];
}
