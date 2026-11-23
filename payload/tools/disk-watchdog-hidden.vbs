Dim sh, cmd
Set sh = CreateObject("WScript.Shell")
cmd = "pwsh -NoProfile -ExecutionPolicy Bypass -File """ & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.claude\tools\disk-watchdog.ps1"""
sh.Run cmd, 0, False
