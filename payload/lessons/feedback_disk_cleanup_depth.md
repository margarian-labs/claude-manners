---
name: feedback-disk-cleanup-depth
description: Drive cleanup analysis must be exhaustive on the first pass; shallow plans get rejected until the deep pass is done
metadata:
  type: feedback
---

When asked to analyze a drive for cleanup, do the deep pass before presenting anything. Top-level folder sizes are not enough.

**Why:** A shallow plan wastes the user's time. A first plan covering only the obvious folders is rejected, and a third pass finds tens of GB more than the first.

**How to apply:** the first pass must already cover:
- Temp, broken down by name pattern and age, plus the leak that fills it (for example a script that creates a browser profile on every run, or installer background-download copies)
- Every file of 150 MB or more on the drive (big-file sweep)
- Old side-by-side app versions (Squirrel `app-x.y.z`, Electron profile `vNN` folders, Store package versions)
- Leftovers of uninstalled apps in AppData, LocalLow and ProgramData
- Dev caches (uv, NuGet, npm/_npx, pnpm, pip, Nx, Aspire runs, Playwright)
- Windows Installer: an orphan check, plus registered products whose files are gone (stale .NET SDK and runtime installer packages can hold over 1 GB)
- Old duplicate packages in DriverStore, reserved storage (registry ReserveManager), orphaned user profiles, the pagefile
- App caches (Teams LocalCache, Chrome Code Cache, Service Worker and Snapshots, Slack, Spotify)
- Size estimates: caches such as uv use hard links on Windows. `uv cache size` and a naive file-size sum double-count them (a "9.9 GB" uv cache freed under 1 GB). Count unique files, hard-link aware, before promising a number.

Related: [[feedback-userassist-unreliable]], [[feedback-flags-only-rejection]].
