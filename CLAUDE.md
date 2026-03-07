# WeightTrack

A Progressive Web App for personal weight tracking built with Angular 19.

## Development Commands

```bash
npm start          # Dev server at http://localhost:4200 (hot reload)
npm run build      # Production build → dist/weight-track/
npm run watch      # Build in watch mode (development config)
npm test           # Run unit tests via Karma
ng generate component components/<name> --skip-tests  # Scaffold a component
```

## Architecture

**Angular 19 standalone components** with signals for reactive state. No NgModules.

```
src/app/
├── models/
│   ├── weight-entry.ts      # WeightEntry, WeightStats interfaces
│   └── achievement.ts       # Achievement, GamificationState, LEVELS, ALL_ACHIEVEMENTS
├── services/
│   ├── weight.ts            # WeightService — entries, stats, settings (LocalStorage)
│   └── gamification.ts      # GamificationService — XP, streaks, achievements
└── components/
    ├── dashboard/           # Home screen: stats, gamification banner, recent entries
    ├── add-entry/           # Log a weight measurement
    ├── chart/               # Canvas API weight trend chart
    ├── history/             # Full entry list with delete + export
    ├── achievements/        # Awards page: level roadmap, badge grid
    └── achievement-toast/   # Slide-in toast when an achievement unlocks
```

All routes are **lazy-loaded**. Routes: `/dashboard`, `/add`, `/chart`, `/history`, `/achievements`.

## Key Patterns

- **State**: Angular signals (`signal`, `computed`). No RxJS.
- **Persistence**: `localStorage` only — no backend. Two keys: `weight_entries`, `weight_gamification`, `weight_settings`.
- **Chart**: Raw HTML5 Canvas 2D API in `ChartComponent` — no chart library.
- **PWA**: `@angular/pwa` service worker + `public/manifest.webmanifest`. Service worker only active in production build.
- **Styles**: SCSS with CSS custom properties defined in `src/app/app.scss`. Dark theme only.

## Adding an Achievement

1. Add a new `AchievementId` union member in `src/app/models/achievement.ts`
2. Add an entry to `ALL_ACHIEVEMENTS` (icon, xp, rarity, description)
3. Add a `check(...)` call in `GamificationService.onEntryAdded()` with the unlock condition

## Adding a New Route

1. Create component: `ng generate component components/<name> --skip-tests`
2. Export the class with `export { MyComponent }` and add a named export alias
3. Add lazy route in `src/app/app.routes.ts`
4. Add nav item in `src/app/app.ts` if it belongs in the bottom nav

## PWA / Service Worker

The service worker (`ngsw-worker.js`) is only registered in the **production** build.
To test PWA locally: `npm run build && npx serve dist/weight-track/browser`

Cache config lives in `ngsw-config.json`. Asset headers and SPA rewrites for Vercel are in `vercel.json`.

## Deployment

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) → Vercel production.
Pull requests get a Vercel preview URL auto-commented on the PR.

Required GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
