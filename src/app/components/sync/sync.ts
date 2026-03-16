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
  protected readonly clientSecretInput = signal('');
  protected readonly logsExpanded = signal(false);

  constructor() {
    // Pre-fill the inputs with any saved credentials
    this.clientIdInput.set(this.gfit.settings().clientId);
    this.clientSecretInput.set(this.gfit.settings().clientSecret);

    // If returning from the PKCE OAuth redirect (/sync?code=...) or a legacy
    // implicit-flow redirect, pick up the token from the current URL.
    this.gfit.handleRedirectCallback();

    // On Android PWA, when Google redirects to /sync?code=... after auth,
    // Android's intent system closes the Chrome Custom Tab and navigates the
    // WebAPK WebView to the new URL.  This may trigger either a full page
    // reload (constructor fires fresh — handled above) or a visibilitychange
    // event while the app is already running.  In the latter case we wait a
    // short period for window.location to update, then re-run the callback.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !this.gfit.isConnected()) {
        // Allow the Android intent navigation to settle before reading the URL.
        setTimeout(() => {
          if (!this.gfit.isConnected()) {
            this.gfit.handleRedirectCallback(true);
          }
          // If still connecting after the URL check (user dismissed auth),
          // reset to idle so the Connect button becomes active again.
          setTimeout(() => {
            this.gfit.resetToIdle();
          }, 1500);
        }, 300);
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

  protected saveClientSecret(): void {
    this.gfit.setClientSecret(this.clientSecretInput());
  }

  protected async connect(): Promise<void> {
    this.gfit.setClientId(this.clientIdInput());
    this.gfit.setClientSecret(this.clientSecretInput());
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

  protected toggleLogs(): void {
    this.logsExpanded.update(v => !v);
  }

  protected downloadLogs(): void {
    this.gfit.downloadLogs();
  }

  protected clearLogs(): void {
    this.gfit.clearLogs();
  }
}
