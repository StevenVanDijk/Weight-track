import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App (root component)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('creates the root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('title is WeightTrack', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.title).toBe('WeightTrack');
  });

  it('navItems contains 5 entries', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.navItems.length).toBe(5);
  });

  it('navItems includes all expected routes', () => {
    const fixture = TestBed.createComponent(App);
    const paths = fixture.componentInstance.navItems.map(n => n.path);
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/add');
    expect(paths).toContain('/chart');
    expect(paths).toContain('/history');
    expect(paths).toContain('/achievements');
  });

  it('renders bottom nav with 5 items', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const navItems = fixture.nativeElement.querySelectorAll('.nav-item');
    expect(navItems.length).toBe(5);
  });

  it('renders the app-achievement-toast element', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-achievement-toast')).toBeTruthy();
  });
});

describe('App routes', () => {
  it('has a redirect from "" to "dashboard"', () => {
    const redirect = routes.find(r => r.path === '');
    expect(redirect?.redirectTo).toBe('dashboard');
  });

  it('has a wildcard redirect to "dashboard"', () => {
    const wildcard = routes.find(r => r.path === '**');
    expect(wildcard?.redirectTo).toBe('dashboard');
  });

  it('has lazy-loaded routes for all 5 pages', () => {
    const lazyPaths = routes.filter(r => r.loadComponent).map(r => r.path);
    expect(lazyPaths).toContain('dashboard');
    expect(lazyPaths).toContain('add');
    expect(lazyPaths).toContain('chart');
    expect(lazyPaths).toContain('history');
    expect(lazyPaths).toContain('achievements');
  });
});
