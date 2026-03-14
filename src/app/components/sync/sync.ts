import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { WeightService } from '../../services/weight';
import { GoogleFitService } from '../../services/google-fit';

export { SyncComponent };

@Component({
  selector: 'app-sync',
  imports: [DatePipe],
  templateUrl: './sync.html',
  styleUrl: './sync.scss',
})
class SyncComponent {
  protected readonly gfit = inject(GoogleFitService);
  protected readonly weightService = inject(WeightService);

  protected readonly clientIdInput = signal('');

  constructor() {
    // Pre-fill the input with any saved client ID
    this.clientIdInput.set(this.gfit.settings().clientId);
    // If returning from the OAuth redirect flow (standalone PWA), pick up the token.
    this.gfit.handleRedirectCallback();

    // On Android PWA, the OAuth redirect opens in a Chrome Custom Tab while the
    // app stays alive in the background. When the user returns, the app becomes
    // visible again but Angular does not re-run the constructor. Re-check for the
    // OAuth callback token whenever the page becomes visible.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.gfit.handleRedirectCallback();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });
  }

  protected saveClientId(): void {
    this.gfit.setClientId(this.clientIdInput());
  }

  protected async connect(): Promise<void> {
    this.gfit.setClientId(this.clientIdInput());
    await this.gfit.connect();
  }

  protected disconnect(): void {
    this.gfit.disconnect();
  }

  protected async importEntries(): Promise<void> {
    await this.gfit.importFromGoogleFit(entry => this.weightService.addEntry(entry));
  }

  protected async exportEntries(): Promise<void> {
    await this.gfit.exportToGoogleFit(this.weightService.entries());
  }
}
