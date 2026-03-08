# WeightTrack — Product Specification & User Stories

> All weights are in **kilograms (kg)**.

---

## 1. Weight Entry Logging

### 1.1 Add Entry
- **US-001** As a user, I can enter my weight (numeric, kg) so that it is recorded for today.
- **US-002** As a user, I can enter a weight value with up to one decimal place (e.g. 78.4) so that I have precise records.
- **US-003** As a user, I can select a custom date for the entry so that I can log a missed day.
- **US-004** As a user, the date field defaults to today so that I don't need to type it every time.
- **US-005** As a user, I cannot select a future date so that my log stays accurate.
- **US-006** As a user, I receive a validation error when I submit without a weight so that I am not saved an empty record.
- **US-007** As a user, I receive a validation error when I enter a weight of 0 or below so that nonsense data is rejected.
- **US-008** As a user, I receive a validation error when I enter a weight above 500 so that nonsense data is rejected.
- **US-009** As a user, I can add an optional note to my entry (e.g. "after workout") so that I can add context.
- **US-010** As a user, whitespace-only notes are silently discarded so that empty notes are never saved.
- **US-011** As a user, if I log a weight for the same date as an existing entry, the existing entry is updated rather than duplicated.
- **US-012** As a user, after a successful save I see a confirmation message so that I have feedback.
- **US-013** As a user, after a successful save I am automatically redirected to the Dashboard after 800 ms.

### 1.2 Weight Slider
- **US-014** As a user, when I have at least one previous entry, a range slider appears below the number input so that I can quickly fine-tune my weight without typing.
- **US-015** As a user, the slider range spans from my last logged weight minus 1 kg to my last logged weight plus 1 kg so that it covers the typical day-to-day fluctuation.
- **US-016** As a user, the slider moves in 0.1 kg steps so that I can select precise values.
- **US-017** As a user, the slider is hidden when there are no previous entries so that it only appears once there is a meaningful reference weight.
- **US-018** As a user, the slider and the number input are always in sync — moving the slider updates the number field and vice versa.
- **US-019** As a user, the slider initialises to my last logged weight so that I start at my most recent measurement.
- **US-020** As a user, the minimum and maximum values of the slider are shown beside it so that I know the range at a glance.
- **US-021** As a user, I can still type any value (1–500 kg) directly in the number input even when the slider is present, so that I am not restricted to the ±1 kg range.

### 1.3 Goal Weight
- **US-022** As a user, I can set an optional goal weight on the Add Entry screen so that the app can track my progress toward it.
- **US-023** As a user, my goal weight is persisted across sessions so that I don't re-enter it each time.
- **US-024** As a user, I can clear my goal weight by leaving the field blank so that I can remove the target.

---

## 2. Dashboard

### 2.1 Stats Cards
- **US-017** As a user, I see my current weight (most recent entry) prominently displayed so that I know where I stand.
- **US-018** As a user, I see my weekly change (vs. an entry ≥ 7 days ago) so that I understand short-term trends.
- **US-019** As a user, I see my total change (current vs. very first entry) so that I understand my overall progress.
- **US-020** As a user, I see my average weight across all entries so that I have a smoothed reference.
- **US-021** As a user, stat cards show "—" when there is insufficient data so that the UI remains clean on first launch.

### 2.2 Goal Progress
- **US-022** As a user, when a goal weight is set I see a progress bar showing percentage toward the goal.
- **US-023** As a user, the goal progress percentage is capped at 100% even if I overshoot my goal.
- **US-024** As a user, the goal section is hidden when no goal weight is set so that the UI is not cluttered.

### 2.3 Recent Entries
- **US-025** As a user, I see the 5 most recent entries in reverse chronological order so that I have quick context.
- **US-026** As a user, I see an empty-state prompt with a call-to-action when no entries exist yet.
- **US-027** As a user, I can tap "View all" to navigate to the full History screen.

### 2.4 Quick Actions
- **US-028** As a user, I can tap "Log Weight" to navigate directly to the Add Entry screen.
- **US-029** As a user, I can tap "View Chart" to navigate directly to the Chart screen.

### 2.5 Gamification Banner
- **US-030** As a user, I see my current level number and title on the Dashboard so that I feel motivated.
- **US-031** As a user, I see an XP progress bar toward the next level so that I know how close I am.
- **US-032** As a user, I see my current logging streak (flame icon + number) so that I am encouraged to maintain it.
- **US-033** As a user, tapping the gamification banner navigates to the Achievements screen.
- **US-034** As a user, the streak badge is hidden when my streak is 0 so that there is no noise on first launch.

---

## 3. Weight History

- **US-035** As a user, I see all my entries listed in reverse chronological order (newest first) so that recent data is easy to find.
- **US-036** As a user, each entry shows its date, weight in kg, and an optional note.
- **US-037** As a user, each entry (except the oldest) shows a delta badge indicating the change from the previous entry.
- **US-038** As a user, negative deltas (weight loss) are styled in green so that progress is visually rewarded.
- **US-039** As a user, positive deltas (weight gain) are styled in red so that I am aware of increases.
- **US-040** As a user, I see the total number of entries in the page subtitle.
- **US-041** As a user, I see an empty-state message when no entries have been logged.

### 3.1 Delete Entry
- **US-042** As a user, I can initiate deletion of an entry, which shows a confirmation step so that accidental deletes are prevented.
- **US-043** As a user, I can confirm deletion to permanently remove the entry from storage.
- **US-044** As a user, I can cancel deletion to dismiss the confirmation and keep the entry.

### 3.2 Export
- **US-045** As a user, I can export all my entries as a JSON file so that I have a backup or can migrate data.
- **US-046** As a user, the exported filename contains the current date (e.g. `weight-data-2024-01-15.json`).
- **US-047** As a user, the Export button is hidden when there are no entries so that it is not misleading.

---

## 4. Progress Chart

- **US-048** As a user, I see a line chart of my weight over time rendered using the HTML5 Canvas API.
- **US-049** As a user, the chart uses a smooth Bezier curve so that the line looks polished.
- **US-050** As a user, the chart has a gradient fill beneath the line so that the visual is informative and attractive.
- **US-051** As a user, I see individual data point dots on the chart so that each entry is identifiable.
- **US-052** As a user, I see Y-axis labels (weight values) so that I can read the scale.
- **US-053** As a user, I see X-axis date labels so that I can understand the time axis.
- **US-054** As a user, the chart respects high-DPI (retina) screens via `devicePixelRatio` so that it looks sharp on modern devices.
- **US-055** As a user, when fewer than 2 entries exist I see a "not enough data" message instead of a broken chart.
- **US-056** As a user, when a goal weight is set and falls within the visible Y-range, a dashed goal line is rendered so that I can see my target.

### 4.1 Period Filter
- **US-057** As a user, I can filter the chart to show the last 7, 30, or 90 days, or all time.
- **US-058** As a user, the 30-day period is selected by default.
- **US-059** As a user, selecting a period immediately redraws the chart.
- **US-060** As a user, entries outside the selected period are excluded from the chart.

### 4.2 Trend Line
- **US-063** As a user, a linear-regression trend line is drawn over the chart so that I can see the direction my weight is heading.
- **US-064** As a user, the trend line is visually distinct from the weight line (dashed, orange) so that I can differentiate them.
- **US-065** As a user, the trend line is computed using the entries visible in the selected period so that filtering affects the projection.

### 4.3 Goal Hit Projection
- **US-066** As a user, when a goal weight is set and the trend line converges on it, a vertical marker is drawn on the chart at the projected date so that I can see when I am on track to reach my goal.
- **US-067** As a user, the projected goal-hit date is labelled on the chart so that I can read the date at a glance.
- **US-068** As a user, the projection marker is only shown when the trend is moving toward the goal and the projected date is beyond the last logged entry.
- **US-069** As a user, the chart x-axis extends to the projected date (capped at 1 year ahead) so that the marker is visible on screen.

### 4.4 Days Left
- **US-070** As a user, when a goal-hit date is projected, I see "Nr of days left" with the count displayed below the chart so that I have an at-a-glance countdown.
- **US-071** As a user, when the projected date has already passed, I see "Goal reached!" instead of a negative count so that the UI remains encouraging.
- **US-072** As a user, the days-left card is hidden when no goal is set or the trend does not converge on the goal, so that the UI is not cluttered.

### 4.5 Summary Stats
- **US-061** As a user, below the chart I see start weight, latest weight, and change for the selected period (when ≥ 2 entries exist).
- **US-062** As a user, a negative period change is coloured green and a positive change is coloured red.

---

## 5. Gamification

### 5.1 XP System
- **US-063** As a user, I earn 10 base XP each time I log a weight entry.
- **US-064** As a user, I earn an additional +2 XP for each consecutive streak day (streak bonus), up to a maximum of +10 extra XP per entry.
- **US-065** As a user, I earn bonus XP when I unlock achievements so that achievements feel rewarding.
- **US-066** As a user, my total XP is persisted across sessions.

### 5.2 Levels
- **US-067** As a user, I progress through 5 named levels: Beginner (0 XP), Tracker (150 XP), Consistent (400 XP), Dedicated (800 XP), Master (1500 XP).
- **US-068** As a user, each level has a distinct colour so that they are visually distinguishable.
- **US-069** As a user, my current level and XP progress toward the next level are persisted across sessions.

### 5.3 Streaks
- **US-070** As a user, my streak increments by 1 each time I log on a consecutive calendar day.
- **US-071** As a user, logging twice in the same day does not increment my streak.
- **US-072** As a user, missing a day resets my streak to 1 (the current day's log).
- **US-073** As a user, my longest-ever streak is recorded and never decreases, even after a reset.
- **US-074** As a user, my streak state is persisted across sessions.

### 5.4 Achievements — Entry Count
- **US-075** As a user, I unlock **First Step** (20 XP, Common) on my first logged entry.
- **US-076** As a user, I unlock **Getting Started** (30 XP, Common) after logging 5 entries.
- **US-077** As a user, I unlock **Data Nerd** (75 XP, Rare) after logging 20 entries.
- **US-078** As a user, I unlock **Century Club** (200 XP, Legendary) after logging 100 entries.
- **US-079** As a user, each entry-count achievement is awarded only once regardless of how many times the threshold is crossed.

### 5.5 Achievements — Streaks
- **US-080** As a user, I unlock **On a Roll** (30 XP, Common) on a 3-day streak.
- **US-081** As a user, I unlock **Week Warrior** (75 XP, Rare) on a 7-day streak.
- **US-082** As a user, I unlock **Fortnight Fighter** (150 XP, Epic) on a 14-day streak.
- **US-083** As a user, I unlock **Unstoppable** (300 XP, Legendary) on a 30-day streak.

### 5.6 Achievements — Weight Progress
- **US-084** As a user, I unlock **First Milestone** (50 XP, Common) when I lose 1 kg toward my goal.
- **US-085** As a user, I unlock **Making Progress** (100 XP, Rare) when I lose 5 kg toward my goal.
- **US-086** As a user, I unlock **Transformation** (200 XP, Epic) when I lose 10 kg toward my goal.
- **US-087** As a user, I unlock **Halfway There** (100 XP, Rare) when I reach 50% of my goal.
- **US-088** As a user, I unlock **Goal Crusher** (500 XP, Legendary) when my weight reaches or passes my goal.
- **US-089** As a user, weight progress achievements require a goal weight to be set; they are never checked without one.

### 5.7 Achievements — Level-Up
- **US-090** As a user, I unlock a **Level Up!** achievement when I reach each of Levels 2–4, and a **Mastery** achievement at Level 5.
- **US-091** As a user, level-up achievements award no additional XP (to prevent infinite loops).

### 5.8 Achievement Toast
- **US-092** As a user, when I unlock an achievement a toast notification slides in from the top of the screen.
- **US-093** As a user, the toast displays the achievement icon, title, description, and XP reward.
- **US-094** As a user, the toast is styled with a rarity-themed glow (Legendary toasts have an animated shimmer).
- **US-095** As a user, the toast disappears automatically after ~3.5 seconds.
- **US-096** As a user, if multiple achievements are unlocked simultaneously they are shown one after another in a queue.
- **US-097** As a user, the polling interval that checks for new achievements is cleaned up when the component is destroyed (no memory leak).

### 5.9 Achievements Page
- **US-098** As a user, I see a player card showing my current level ring, level title, total XP, and XP progress bar.
- **US-099** As a user, I see a level roadmap listing all 5 levels with their XP thresholds and completion state.
- **US-100** As a user, I see three mini-stat tiles: current streak, longest streak, and total badges unlocked.
- **US-101** As a user, I see a grid of all unlocked achievements with their icon, title, description, rarity badge, and XP value.
- **US-102** As a user, I see a separate grid of locked achievements (dimmed) so that I know what to aim for.
- **US-103** As a user, each achievement badge is colour-coded by rarity: Common (grey), Rare (cyan), Epic (indigo), Legendary (amber).

---

## 6. Navigation

- **US-104** As a user, I see a persistent bottom navigation bar with 5 tabs: Home, Log, Chart, History, Awards.
- **US-105** As a user, the active tab is visually highlighted so that I know which section I am in.
- **US-106** As a user, navigating to `/` automatically redirects me to the Dashboard.
- **US-107** As a user, navigating to an unknown URL redirects me to the Dashboard.
- **US-108** As a user, all pages are lazy-loaded so that the initial bundle stays small.

---

## 7. Data Persistence

- **US-109** As a user, all weight entries are saved to `localStorage` under the key `weight_entries`.
- **US-110** As a user, app settings (goal weight, reminder flag) are saved under `weight_settings`.
- **US-111** As a user, gamification state (XP, level, streaks, achievements) is saved under `weight_gamification`.
- **US-112** As a user, my data survives a page refresh or browser close.
- **US-113** As a user, if localStorage data is corrupted the app silently falls back to defaults rather than crashing.
- **US-114** As a user, no data is sent to a server — all processing happens on my device.

---

## 8. PWA & Offline

- **US-115** As a user, I can install the app to my home screen (Add to Home Screen) on iOS and Android.
- **US-116** As a user, the app displays a custom name ("WeightTrack") and icon on the home screen.
- **US-117** As a user, the app opens in standalone (full-screen) mode without browser chrome.
- **US-118** As a user, the app loads and functions offline after the first visit because assets are cached by the service worker.
- **US-119** As a user, the service worker (`ngsw-worker.js`) is served with `no-cache` headers so that updates are picked up promptly.
- **US-120** As a user, the app theme colour matches the dark UI (`#1e293b`) so that the browser status bar blends in.

---

## 9. Accessibility & UX

- **US-121** As a user, all interactive elements have visible focus styles so that keyboard navigation is usable.
- **US-122** As a user, nav items have `aria-label` attributes so that screen readers can identify them.
- **US-123** As a user, the weight input has `autofocus` on the Add Entry screen so that I can start typing immediately.
- **US-124** As a user, the app uses a dark theme with sufficient contrast ratios so that it is comfortable in low-light conditions.
- **US-125** As a user, the layout uses `100dvh` so that it fills the screen correctly on mobile browsers with dynamic toolbars.
- **US-126** As a user, safe-area insets are respected (`env(safe-area-inset-bottom)`) on notched devices.
- **US-127** As a user, all text input fields display a placeholder hint so that I know what to enter.

---

## 10. Deployment & CI/CD

- **US-128** As a developer, pushing to `main` or `master` automatically triggers a production deployment to Vercel via GitHub Actions.
- **US-129** As a developer, opening a pull request triggers a preview deployment and the preview URL is automatically commented on the PR.
- **US-130** As a developer, the Angular production build output (`dist/weight-track/browser`) is deployed, not the source.
- **US-131** As a developer, all URL paths are rewritten to `index.html` on Vercel so that Angular client-side routing works.
- **US-132** As a developer, static assets (JS, CSS, fonts, images) are served with long-lived `Cache-Control: immutable` headers.

---

## 11. Data Durability

- **US-133** As a user, my data is written to IndexedDB on every save so that it survives browser storage eviction of `localStorage`.
- **US-134** As a user, my data is also written to `localStorage` simultaneously so that the app loads instantly on the next visit without waiting for an IndexedDB read.
- **US-135** As a user, if the browser clears `localStorage` (e.g. under storage pressure or via "Clear cookies"), my data is automatically restored from IndexedDB the next time the app launches.
- **US-136** As a user, the app requests persistent storage permission (`navigator.storage.persist()`) at startup so that the browser will not silently evict my data without prompting me first.
- **US-137** As a developer, all three data stores (`weight_entries`, `weight_settings`, `weight_gamification`) are mirrored in both `localStorage` and the `weight-track` IndexedDB database under the `kv` object store.
