# Changelog

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
