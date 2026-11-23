---
name: feedback-userassist-unreliable
description: Windows UserAssist last-run dates miss tray, autostart and hotkey apps; never call an app unused from UserAssist alone
metadata:
  type: feedback
---

Do not claim an app is unused based only on UserAssist (HKCU Explorer\UserAssist) last-run dates.

**Why:** UserAssist only records launches made through Explorer shortcuts and the Start menu. Tray apps, autostart apps and hotkey tools (a screenshot tool, a color picker, a desktop chat app) can run daily and still show an old date. Calling them unused is wrong, and the user loses trust in the analysis.

**How to apply:** before calling an app unused, also check:
- running processes
- Run keys and Store StartupTask state
- the newest file in its data folder (AppData, or Packages\<pkg>)
- for CLI tools, the shell history

Say "no evidence of use" rather than "not used", and let the user decide.

Related: [[feedback-disk-cleanup-depth]].
