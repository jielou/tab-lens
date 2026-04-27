# Changelog

## [v0.2.0-beta.1] - 2026-04-26

### Added
- **Suggested Review** card on overview dashboard summarizing tabs that need attention
  - Duplicate tabs count
  - Stale tabs (open ≥ 1 day) count
  - Distracted tabs (visit count ≥ 10) count
  - Temporary tabs (search / redirect / blank pages) count
- **Quick Filters** in Tab Manager: All, Duplicate, Stale, Distracted, Temporary, Grouped, Ungrouped
- **Batch Selection Toolbar** in Tab Manager
  - Select all / deselect all with indeterminate state
  - Group selected tabs into a new Chrome tab group
  - Close selected tabs in bulk
- Card header icons across all dashboard cards for stronger visual hierarchy
- `findTemporaryTabs`, `findStaleTabs`, `findDistractedTabs`, `getSuggestedReviewCounts` helpers in `stats.js`

### Changed
- **Tab Manager toolbar** redesigned
  - View-mode switcher changed from single toggle to segmented Grid / List buttons
  - Search input now shows a search icon
- **Distraction Alert** and **Zombie Tabs** cards moved into the new suggested-review row with refreshed styling
- **Reset Stats** button relocated from overview header to nav bar; redesigned as pill button with hover-reveal hint
- Dashboard color tokens refined (purple palette shifted to blue, background tint adjusted)
- Body text color now uses primary brand color for stronger identity

## [0.1.0] - 2026-04-25

### Added
- Overview dashboard with 5 stat cards (net growth, most visited, oldest tab, longest untouched, duplicates)
- 14-day tab trend chart with daily snapshots
- Top Domains breakdown with progress bars
- Distraction Alert — surface tabs with highest visit count
- Zombie Tabs — find tabs open 1+ hours with no activity in 3+ hours
- All Tabs view with search, grid/list toggle, and domain color strips
- Smart grouping suggestions based on domain and keyword clustering
- Duplicate tab detection with one-click cleanup
- Reset Stats button to recalibrate tracking from current state
- Info tooltips on stats cards explaining calculation logic
- Chrome internal pages excluded from tracking (`chrome://`, `chrome-extension://`, etc.)
- Data persistence via `chrome.storage.local` with URL-matching recovery after browser restart

### Fixed
- Tab ID reset on browser restart no longer orphans timestamp data
- Daily snapshot gaps prevented via `chrome.alarms` scheduling
- openedLog / closedLog now survives tab lifecycle across sessions
- Timezone-safe snapshot keys for consistent 14-day trend display

### Dev
- Project structure reorganized into `src/`, `assets/`, `tests/`, `config/`
- Jest test suite for `stats.js`, `tabData.js`, `grouping.js`
