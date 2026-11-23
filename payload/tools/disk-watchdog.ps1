#requires -Version 7
[CmdletBinding()]
param(
    [int]$MaxLogMB = 1024,
    [double]$MinFreeGB = 20,
    [string]$ScanRoot = (Join-Path $env:LOCALAPPDATA 'Temp\claude'),
    [int]$KeepTailKB = 1024,
    [switch]$DryRun,
    [switch]$Test,
    [int]$SweepDays = 3,
    [int]$BackupDays = 90,
    [switch]$SweepNow,
    [string]$BackupsRoot = (Join-Path $env:USERPROFILE '.claude\backups')
)

$ErrorActionPreference = 'Stop'
$toolsDir = Join-Path $env:USERPROFILE '.claude\tools'
$logPath = Join-Path $toolsDir 'disk-watchdog.log'
$statePath = Join-Path $toolsDir 'disk-watchdog-state.json'
$confPath = Join-Path $env:USERPROFILE '.claude\telegram.conf'
$protectedNames = @('claude.exe', 'explorer.exe')
$inv = [cultureinfo]::InvariantCulture
$sw = [Diagnostics.Stopwatch]::StartNew()

function Write-Log([string]$Message) {
    if ($DryRun) { Write-Host $Message; return }
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Invoke-LogRotation {
    if ($DryRun) { return }
    $fi = [IO.FileInfo]::new($logPath)
    if ($fi.Exists -and $fi.Length -gt 1MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
}

function Format-Size([double]$Bytes) {
    if ($Bytes -ge 1GB) { return ('{0} GB' -f ($Bytes / 1GB).ToString('0.00', $inv)) }
    if ($Bytes -ge 1MB) { return ('{0} MB' -f ($Bytes / 1MB).ToString('0.0', $inv)) }
    return ('{0} KB' -f ($Bytes / 1KB).ToString('0', $inv))
}

function Get-RealLength([string]$Path) {
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        try { return $fs.Length } finally { $fs.Dispose() }
    } catch {
        try { return ([IO.FileInfo]::new($Path)).Length } catch { return -1L }
    }
}

function Get-TelegramConfig {
    if (-not (Test-Path -LiteralPath $confPath)) { return $null }
    $cfg = @{}
    foreach ($raw in Get-Content -LiteralPath $confPath) {
        $l = $raw.Trim()
        if ($l -eq '' -or $l.StartsWith('#')) { continue }
        $i = $l.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $l.Substring(0, $i).Trim()
        $v = $l.Substring($i + 1).Trim()
        if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $cfg[$k] = $v
    }
    if (-not $cfg['TELEGRAM_BOT_TOKEN'] -or -not $cfg['TELEGRAM_CHAT_ID']) { return $null }
    if (-not $cfg['MACHINE_NAME']) { $cfg['MACHINE_NAME'] = $env:COMPUTERNAME }
    return $cfg
}

$script:tg = $null
$script:tgLoaded = $false

function Get-MachineName {
    if (-not $script:tgLoaded) { $script:tg = Get-TelegramConfig; $script:tgLoaded = $true }
    if ($script:tg) { return $script:tg['MACHINE_NAME'] }
    return $env:COMPUTERNAME
}

function Send-Telegram([string]$Text) {
    if ($DryRun) { return $false }
    if (-not $script:tgLoaded) { $script:tg = Get-TelegramConfig; $script:tgLoaded = $true }
    if (-not $script:tg) { Write-Log 'telegram: not configured, alert not sent'; return $false }
    if ($Test) { $Text = "[TEST] $Text" }
    try {
        $uri = 'https://api.telegram.org/bot{0}/sendMessage' -f $script:tg['TELEGRAM_BOT_TOKEN']
        $resp = Invoke-WebRequest -Uri $uri -Method Post -Body @{ chat_id = $script:tg['TELEGRAM_CHAT_ID']; text = $Text } -TimeoutSec 20 -UseBasicParsing
        Write-Log ('telegram: sent, HTTP {0}' -f [int]$resp.StatusCode)
        return $true
    } catch {
        $status = ''
        if ($_.Exception.Response) { $status = ' HTTP ' + [int]$_.Exception.Response.StatusCode }
        Write-Log ('telegram: send failed ({0}{1})' -f $_.Exception.GetType().Name, $status)
        return $false
    }
}

function Get-FileHolderPids([string]$Path) {
    if (-not ('DiskWatchdog.RestartManager' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace DiskWatchdog {
    public static class RestartManager {
        [StructLayout(LayoutKind.Sequential)]
        struct RM_UNIQUE_PROCESS {
            public int dwProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct RM_PROCESS_INFO {
            public RM_UNIQUE_PROCESS Process;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
            public int ApplicationType;
            public uint AppStatus;
            public uint TSSessionId;
            [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
        }
        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);
        [DllImport("rstrtmgr.dll")]
        static extern int RmEndSession(uint pSessionHandle);
        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        static extern int RmRegisterResources(uint pSessionHandle, uint nFiles,
            [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] rgsFilenames,
            uint nApplications, IntPtr rgApplications, uint nServices, IntPtr rgsServiceNames);
        [DllImport("rstrtmgr.dll")]
        static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
            [In, Out] RM_PROCESS_INFO[] rgAffectedApps, out uint lpdwRebootReasons);

        public static int[] GetHolders(string path) {
            uint handle;
            var key = new StringBuilder(33);
            int rc = RmStartSession(out handle, 0, key);
            if (rc != 0) throw new System.ComponentModel.Win32Exception(rc, "RmStartSession failed");
            try {
                rc = RmRegisterResources(handle, 1, new[] { path }, 0, IntPtr.Zero, 0, IntPtr.Zero);
                if (rc != 0) throw new System.ComponentModel.Win32Exception(rc, "RmRegisterResources failed");
                uint needed = 0, count = 0, reasons;
                RM_PROCESS_INFO[] info = new RM_PROCESS_INFO[0];
                for (int attempt = 0; attempt < 5; attempt++) {
                    rc = RmGetList(handle, out needed, ref count, info, out reasons);
                    if (rc == 0) break;
                    if (rc != 234) throw new System.ComponentModel.Win32Exception(rc, "RmGetList failed");
                    info = new RM_PROCESS_INFO[needed + 4];
                    count = (uint)info.Length;
                }
                if (rc != 0) throw new System.ComponentModel.Win32Exception(rc, "RmGetList did not settle");
                var pids = new List<int>();
                for (int i = 0; i < count; i++) pids.Add(info[i].Process.dwProcessId);
                return pids.ToArray();
            } finally {
                RmEndSession(handle);
            }
        }
    }
}
'@
    }
    return [DiskWatchdog.RestartManager]::GetHolders($Path)
}

function Stop-HoldersAndTrees([int[]]$HolderPids) {
    $stopped = [System.Collections.Generic.List[string]]::new()
    $procs = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine)
    $byPid = @{}
    $kids = @{}
    foreach ($p in $procs) {
        $byPid[[int]$p.ProcessId] = $p
        $pp = [int]$p.ParentProcessId
        if (-not $kids.ContainsKey($pp)) { $kids[$pp] = [System.Collections.Generic.List[int]]::new() }
        $kids[$pp].Add([int]$p.ProcessId)
    }

    $self = [System.Collections.Generic.HashSet[int]]::new()
    $cur = $PID
    while ($cur -and $byPid.ContainsKey($cur) -and $self.Add($cur)) { $cur = [int]$byPid[$cur].ParentProcessId }

    $order = [System.Collections.Generic.List[int]]::new()
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    function Add-PostOrder([int]$ProcId) {
        if (-not $seen.Add($ProcId)) { return }
        if ($kids.ContainsKey($ProcId)) { foreach ($c in $kids[$ProcId]) { Add-PostOrder $c } }
        $order.Add($ProcId)
    }
    foreach ($h in $HolderPids) {
        if (-not $byPid.ContainsKey($h)) { continue }
        if ($self.Contains($h) -or $protectedNames -contains $byPid[$h].Name.ToLowerInvariant()) {
            Write-Log ('  holder skipped (protected): pid={0} name={1}' -f $h, $byPid[$h].Name)
            continue
        }
        Add-PostOrder $h
    }

    foreach ($procId in $order) {
        $p = $byPid[$procId]
        $name = [string]$p.Name
        if ($self.Contains($procId) -or $protectedNames -contains $name.ToLowerInvariant()) {
            Write-Log ('  skipped (protected): pid={0} name={1}' -f $procId, $name)
            continue
        }
        $cmd = [string]$p.CommandLine
        if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) }
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Log ('  killed pid={0} name={1} cmd={2}' -f $procId, $name, $cmd)
            $stopped.Add(('{0} ({1})' -f $name, $procId))
        } catch {
            Write-Log ('  kill failed pid={0} name={1} ({2})' -f $procId, $name, $_.Exception.GetType().Name)
        }
    }
    return $stopped
}

function Shrink-File([string]$Path, [long]$SizeBefore) {
    $fs = $null
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $len = $fs.Length
        $keep = [Math]::Min($len, [long]$KeepTailKB * 1024)
        $buf = [byte[]]::new($keep)
        [void]$fs.Seek($len - $keep, [IO.SeekOrigin]::Begin)
        $got = 0
        while ($got -lt $keep) {
            $n = $fs.Read($buf, $got, $keep - $got)
            if ($n -le 0) { break }
            $got += $n
        }
        $hdrText = '[disk-watchdog] truncated from {0} GB at {1}; last {2} KB kept' -f ($SizeBefore / 1GB).ToString('0.00', $inv), (Get-Date -Format 'yyyy-MM-dd HH:mm'), $KeepTailKB
        $hdr = [Text.Encoding]::ASCII.GetBytes($hdrText + "`n")
        [void]$fs.Seek(0, [IO.SeekOrigin]::Begin)
        $fs.Write($hdr, 0, $hdr.Length)
        $fs.Write($buf, 0, $got)
        $fs.SetLength($hdr.Length + $got)
        $fs.Flush()
        return $true
    } catch {
        Write-Log ('  shrink failed ({0}: {1})' -f $_.Exception.GetType().Name, $_.Exception.Message)
        return $false
    } finally {
        if ($fs) { $fs.Dispose() }
    }
}

function Get-WatchdogState {
    $st = @{}
    if (Test-Path -LiteralPath $statePath) {
        try {
            $obj = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
            if ($obj) {
                foreach ($k in @($obj.Keys)) {
                    $v = $obj[$k]
                    if ($v -is [datetime]) { $v = $v.ToUniversalTime().ToString('o', $inv) }
                    $st[$k] = $v
                }
            }
        } catch { }
    }
    return $st
}

function Save-WatchdogState([hashtable]$Patch) {
    $st = Get-WatchdogState
    foreach ($k in $Patch.Keys) { $st[$k] = $Patch[$k] }
    $st | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

function Get-ClaudeConfigDirs {
    $dirs = @(Join-Path $env:USERPROFILE '.claude')
    $dirs += @(Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Force -Filter '.claude-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    return $dirs
}

function Get-LiveSessionIds {
    $set = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in @(Get-ClaudeConfigDirs | ForEach-Object { Join-Path $_ 'sessions' })) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in [IO.Directory]::EnumerateFiles($dir, '*.json')) {
            try {
                $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
                $procId = [int]$j.pid
                $sid = [string]$j.sessionId
                if ($sid -and $procId -gt 0 -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { [void]$set.Add($sid) }
            } catch { }
        }
    }
    return , $set
}

function Test-IsLink($Info) {
    return [bool]($Info.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-TreeScan([string]$Path) {
    $scan = [pscustomobject]@{
        Files = [System.Collections.Generic.List[string]]::new()
        ReadOnly = [System.Collections.Generic.List[string]]::new()
        Dirs = [System.Collections.Generic.List[string]]::new()
        Links = [System.Collections.Generic.List[object]]::new()
        Repos = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        Bytes = 0L
        Newest = $null
        Errors = 0
    }
    $root = [IO.DirectoryInfo]::new($Path)
    $scan.Dirs.Add($root.FullName)
    $stack = [System.Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $stack.Push($root)
    $newestTicks = 0L
    while ($stack.Count -gt 0) {
        $d = $stack.Pop()
        try {
            foreach ($e in $d.EnumerateFileSystemInfos()) {
                if (Test-IsLink $e) {
                    $scan.Links.Add([pscustomobject]@{ Path = $e.FullName; IsDir = ($e -is [IO.DirectoryInfo]); Target = [string]$e.LinkTarget })
                    continue
                }
                $t = $e.LastWriteTimeUtc.Ticks
                if ($t -gt $newestTicks) { $newestTicks = $t }
                if ($e -is [IO.DirectoryInfo]) {
                    $scan.Dirs.Add($e.FullName)
                    $stack.Push($e)
                } else {
                    $scan.Files.Add($e.FullName)
                    $scan.Bytes += $e.Length
                    if ($e.Attributes -band [IO.FileAttributes]::ReadOnly) { $scan.ReadOnly.Add($e.FullName) }
                    if ($e.Name -eq '.git' -and $e.Length -lt 4096) {
                        try {
                            $txt = [IO.File]::ReadAllText($e.FullName)
                            if ($txt -match '^\s*gitdir:\s*(.+?)\s*$') {
                                $gd = $Matches[1].Replace('/', '\')
                                $ix = $gd.IndexOf('\.git\worktrees\', [StringComparison]::OrdinalIgnoreCase)
                                if ($ix -gt 0) { [void]$scan.Repos.Add($gd.Substring(0, $ix)) }
                            }
                        } catch { }
                    }
                }
            }
        } catch {
            $scan.Errors++
            Write-Log ('sweep: failed {0} (scan: {1})' -f $d.FullName, $_.Exception.GetType().Name)
        }
    }
    if ($newestTicks -gt 0) { $scan.Newest = [datetime]::new($newestTicks, [DateTimeKind]::Utc) } else { $scan.Newest = $root.LastWriteTimeUtc }
    return $scan
}

function Remove-TreeSafe([string]$Path) {
    $res = [pscustomobject]@{ Freed = 0L; Failed = 0; Links = [System.Collections.Generic.List[string]]::new() }
    $root = [IO.DirectoryInfo]::new($Path)
    if (-not $root.Exists) { return $res }
    if (Test-IsLink $root) {
        $target = [string]$root.LinkTarget
        try {
            [IO.Directory]::Delete($Path, $false)
            $res.Links.Add($Path)
            Write-Log ('sweep: link removed {0} -> {1}' -f $Path, $target)
        } catch {
            $res.Failed++
            Write-Log ('sweep: failed {0} (link: {1})' -f $Path, $_.Exception.Message)
        }
        return $res
    }

    $scan = Get-TreeScan $Path
    $res.Failed += $scan.Errors

    foreach ($ro in $scan.ReadOnly) {
        try {
            $a = [IO.File]::GetAttributes($ro) -band (-bnot [IO.FileAttributes]::ReadOnly)
            if ($a -eq 0) { $a = [IO.FileAttributes]::Normal }
            [IO.File]::SetAttributes($ro, $a)
        } catch { }
    }

    $linkFailed = 0
    foreach ($l in $scan.Links) {
        try {
            if ($l.IsDir) { [IO.Directory]::Delete($l.Path, $false) } else { [IO.File]::Delete($l.Path) }
            $res.Links.Add($l.Path)
            Write-Log ('sweep: link removed {0} -> {1}' -f $l.Path, $l.Target)
        } catch {
            $linkFailed++
            $res.Failed++
            Write-Log ('sweep: failed {0} (link: {1})' -f $l.Path, $_.Exception.Message)
        }
    }

    $done = $false
    if ($linkFailed -eq 0) {
        try {
            [IO.Directory]::Delete($Path, $true)
            $res.Freed = $scan.Bytes
            $done = $true
        } catch {
            Write-Log ('sweep: recursive delete of {0} failed ({1}), deleting item by item' -f $Path, $_.Exception.GetType().Name)
        }
    }
    if (-not $done) {
        foreach ($f in $scan.Files) {
            $len = 0L
            try { $len = ([IO.FileInfo]::new($f)).Length } catch { }
            try {
                [IO.File]::Delete($f)
                $res.Freed += $len
            } catch {
                if ([IO.File]::Exists($f)) {
                    $res.Failed++
                    Write-Log ('sweep: failed {0} ({1})' -f $f, $_.Exception.Message)
                } else {
                    $res.Freed += $len
                }
            }
        }
        for ($i = $scan.Dirs.Count - 1; $i -ge 0; $i--) {
            $dd = $scan.Dirs[$i]
            try {
                [IO.Directory]::Delete($dd, $false)
            } catch {
                if ([IO.Directory]::Exists($dd)) {
                    $res.Failed++
                    Write-Log ('sweep: failed {0} ({1})' -f $dd, $_.Exception.Message)
                }
            }
        }
    }

    foreach ($repo in $scan.Repos) {
        if (-not [IO.Directory]::Exists($repo)) { continue }
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { continue }
        try {
            & git -C $repo worktree prune 2>&1 | Out-Null
            Write-Log ('sweep: worktree prune {0}' -f $repo)
        } catch { }
    }
    return $res
}

function Invoke-Sweep {
    $sweepSw = [Diagnostics.Stopwatch]::StartNew()
    $stat = [pscustomobject]@{ Deleted = 0; Freed = 0L; Failed = 0 }
    $now = [datetime]::UtcNow
    $live = Get-LiveSessionIds
    $verb = if ($DryRun) { 'would delete' } else { 'deleted' }

    function Report-Removal([string]$Path, [long]$Bytes, $Result) {
        if ($Result) {
            $stat.Freed += $Result.Freed
            $stat.Failed += $Result.Failed
            if ($Result.Failed -gt 0) { Write-Log ('sweep: failed {0} ({1} items not deleted)' -f $Path, $Result.Failed) }
            if (-not [IO.Directory]::Exists($Path)) {
                $stat.Deleted++
                Write-Log ('sweep: deleted {0} ({1})' -f $Path, (Format-Size $Result.Freed))
            }
        } else {
            $stat.Deleted++
            $stat.Freed += $Bytes
            Write-Log ('sweep: would delete {0} ({1})' -f $Path, (Format-Size $Bytes))
        }
    }

    # 1. Session folders under the scan root
    if ([IO.Directory]::Exists($ScanRoot)) {
        $cutoff = $now.AddDays(-$SweepDays)
        foreach ($proj in @([IO.DirectoryInfo]::new($ScanRoot).EnumerateDirectories())) {
            if ((Test-IsLink $proj) -or $proj.Name -eq 'bash-edit-diff') { continue }
            $entryCount = 0
            $removedCount = 0
            foreach ($sess in @($proj.EnumerateFileSystemInfos())) {
                $entryCount++
                if ($sess -isnot [IO.DirectoryInfo] -or (Test-IsLink $sess)) { continue }
                $g = [guid]::Empty
                if (-not [guid]::TryParse($sess.Name, [ref]$g)) { continue }
                if ($live.Contains($g.ToString()) -or $live.Contains($sess.Name)) {
                    Write-Log ('sweep: skipped live {0}' -f $sess.FullName)
                    continue
                }
                $scan = Get-TreeScan $sess.FullName
                if ($SweepDays -gt 0 -and $scan.Newest -ge $cutoff) { continue }
                if ($DryRun) {
                    Report-Removal $sess.FullName $scan.Bytes $null
                    $removedCount++
                } else {
                    $r = Remove-TreeSafe $sess.FullName
                    Report-Removal $sess.FullName $scan.Bytes $r
                    if (-not [IO.Directory]::Exists($sess.FullName)) { $removedCount++ }
                }
            }
            $wasEmptyOld = ($entryCount -eq 0 -and $proj.LastWriteTimeUtc -lt $now.AddDays(-1))
            if (($removedCount -gt 0 -and $entryCount -eq $removedCount) -or $wasEmptyOld) {
                if ($DryRun) {
                    $stat.Deleted++
                    Write-Log ('sweep: would delete {0} (empty folder)' -f $proj.FullName)
                } else {
                    try {
                        [IO.Directory]::Delete($proj.FullName, $false)
                        $stat.Deleted++
                        Write-Log ('sweep: deleted {0} (empty folder)' -f $proj.FullName)
                    } catch {
                        Write-Log ('sweep: failed {0} ({1})' -f $proj.FullName, $_.Exception.Message)
                    }
                }
            }
        }
    }

    # 2. Empty claude-lsremote-* temp folders older than 1 day
    $tempDir = Join-Path $env:LOCALAPPDATA 'Temp'
    if ([IO.Directory]::Exists($tempDir)) {
        foreach ($d in [IO.DirectoryInfo]::new($tempDir).EnumerateDirectories('claude-lsremote-*')) {
            if (Test-IsLink $d) { continue }
            if ($d.LastWriteTimeUtc -ge $now.AddDays(-1)) { continue }
            $any = $false
            foreach ($x in $d.EnumerateFileSystemInfos()) { $any = $true; break }
            if ($any) { continue }
            if ($DryRun) {
                $stat.Deleted++
                Write-Log ('sweep: would delete {0} (empty folder)' -f $d.FullName)
            } else {
                try {
                    [IO.Directory]::Delete($d.FullName, $false)
                    $stat.Deleted++
                    Write-Log ('sweep: deleted {0} (empty folder)' -f $d.FullName)
                } catch {
                    $stat.Failed++
                    Write-Log ('sweep: failed {0} ({1})' -f $d.FullName, $_.Exception.Message)
                }
            }
        }
    }

    # 3. Leftover .claude.json.tmp.* files older than 1 day
    foreach ($dir in @(@($env:USERPROFILE) + @(Get-ClaudeConfigDirs | Select-Object -Skip 1))) {
        if (-not [IO.Directory]::Exists($dir)) { continue }
        foreach ($f in [IO.DirectoryInfo]::new($dir).EnumerateFiles('.claude.json.tmp.*')) {
            if (Test-IsLink $f) { continue }
            if ($f.LastWriteTimeUtc -ge $now.AddDays(-1)) { continue }
            if ($DryRun) {
                $stat.Deleted++
                $stat.Freed += $f.Length
                Write-Log ('sweep: would delete {0} ({1})' -f $f.FullName, (Format-Size $f.Length))
            } else {
                try {
                    $len = $f.Length
                    [IO.File]::Delete($f.FullName)
                    $stat.Deleted++
                    $stat.Freed += $len
                    Write-Log ('sweep: deleted {0} ({1})' -f $f.FullName, (Format-Size $len))
                } catch {
                    $stat.Failed++
                    Write-Log ('sweep: failed {0} ({1})' -f $f.FullName, $_.Exception.Message)
                }
            }
        }
    }

    # 4. Subfolders of the backups root unused for BackupDays (age = newer of newest file time and folder creation time)
    if ([IO.Directory]::Exists($BackupsRoot)) {
        $bCutoff = $now.AddDays(-$BackupDays)
        foreach ($b in @([IO.DirectoryInfo]::new($BackupsRoot).EnumerateDirectories())) {
            if (Test-IsLink $b) { continue }
            $scan = Get-TreeScan $b.FullName
            $age = $scan.Newest
            if ($b.CreationTimeUtc -gt $age) { $age = $b.CreationTimeUtc }
            if ($age -ge $bCutoff) { continue }
            if ($DryRun) {
                Report-Removal $b.FullName $scan.Bytes $null
            } else {
                $r = Remove-TreeSafe $b.FullName
                Report-Removal $b.FullName $scan.Bytes $r
            }
        }
    }

    $line = 'sweep ok deleted={0} freed={1} failed={2} dur={3}s{4}' -f $stat.Deleted, (Format-Size $stat.Freed), $stat.Failed, $sweepSw.Elapsed.TotalSeconds.ToString('0.0', $inv), $(if ($DryRun) { ' (dry-run)' } else { '' })
    Write-Log $line
}

try {
    Invoke-LogRotation

    $files = [System.Collections.Generic.List[object]]::new()
    if (Test-Path -LiteralPath $ScanRoot) {
        $opts = [IO.EnumerationOptions]::new()
        $opts.RecurseSubdirectories = $true
        $opts.IgnoreInaccessible = $true
        foreach ($f in [IO.Directory]::EnumerateFiles($ScanRoot, '*.output', $opts)) {
            $files.Add([pscustomobject]@{ Path = $f; Length = (Get-RealLength $f) })
        }
    }

    $limit = [long]$MaxLogMB * 1MB
    $big = @($files | Where-Object { $_.Length -gt $limit })
    $handled = 0

    foreach ($item in $big) {
        $path = $item.Path
        $before = $item.Length
        Write-Log ('oversized log: {0} size={1}' -f $path, (Format-Size $before))
        if ($DryRun) { continue }

        $holderNote = ''
        $stopped = @()
        try {
            $holders = @(Get-FileHolderPids $path)
            Write-Log ('  holders (Restart Manager): {0}' -f (($holders | ForEach-Object { $_ }) -join ','))
            $stopped = @(Stop-HoldersAndTrees $holders)
        } catch {
            $holderNote = ' Holder lookup failed: ' + $_.Exception.GetType().Name + '.'
            Write-Log ('  holder lookup failed ({0}: {1})' -f $_.Exception.GetType().Name, $_.Exception.Message)
        }

        $ok = Shrink-File $path $before
        $after = Get-RealLength $path
        $stoppedText = if ($stopped.Count) { $stopped -join ', ' } else { 'nothing' }
        if ($ok) {
            $msg = "Disk watchdog on $(Get-MachineName): runaway Claude log shrunk.`nFile: $path`nSize: $(Format-Size $before) -> $(Format-Size $after)`nStopped: $stoppedText.$holderNote"
            Write-Log ('  shrunk to {0}; stopped: {1}' -f (Format-Size $after), $stoppedText)
        } else {
            $msg = "Disk watchdog on $(Get-MachineName): could not shrink runaway Claude log.`nFile: $path`nSize: $(Format-Size $before) (now $(Format-Size $after))`nStopped: $stoppedText.$holderNote"
            Write-Log '  could not shrink'
        }
        [void](Send-Telegram $msg)
        $handled++
    }

    $drive = [IO.DriveInfo]::new('C')
    $freeBytes = $drive.AvailableFreeSpace
    $freeGB = $freeBytes / 1GB
    $lowAlert = 'no'
    if ($freeGB -lt $MinFreeGB) {
        $lowAlert = 'low'
        $last = $null
        try {
            $st = Get-WatchdogState
            if ($st['lastLowDiskAlertUtc']) { $last = [datetimeoffset]::Parse([string]$st['lastLowDiskAlertUtc'], $inv) }
        } catch { $last = $null }
        $suppressed = $last -and (([datetimeoffset]::UtcNow - $last).TotalHours -lt 2)
        if ($DryRun) {
            Write-Host ('LOW DISK: {0} GB free' -f $freeGB.ToString('0.0', $inv))
        } elseif ($suppressed) {
            $lowAlert = 'low-suppressed'
        } else {
            $top = ($files | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object { '{0}  {1}' -f (Format-Size $_.Length), $_.Path }) -join "`n"
            if (-not $top) { $top = '(no files under scan root)' }
            $msg = "Disk watchdog on $(Get-MachineName): LOW DISK on C:, $($freeGB.ToString('0.0', $inv)) GB free (limit $MinFreeGB GB).`nLargest files under ${ScanRoot}:`n$top"
            if (Send-Telegram $msg) {
                Save-WatchdogState @{ lastLowDiskAlertUtc = [datetimeoffset]::UtcNow.ToString('o', $inv) }
                $lowAlert = 'low-alerted'
            } else {
                $lowAlert = 'low-send-failed'
            }
        }
    }

    try {
        $sweepDue = [bool]$SweepNow
        if (-not $sweepDue) {
            $lastSweep = $null
            try {
                $st = Get-WatchdogState
                if ($st['lastSweepUtc']) { $lastSweep = [datetimeoffset]::Parse([string]$st['lastSweepUtc'], $inv) }
            } catch { $lastSweep = $null }
            $sweepDue = (-not $lastSweep) -or (([datetimeoffset]::UtcNow - $lastSweep).TotalHours -gt 20)
        }
        if ($sweepDue) {
            Invoke-Sweep
            if (-not $DryRun) { Save-WatchdogState @{ lastSweepUtc = [datetimeoffset]::UtcNow.ToString('o', $inv) } }
        }
    } catch {
        try { Write-Log ('sweep FAILED ({0}: {1})' -f $_.Exception.GetType().Name, $_.Exception.Message) } catch {}
    }

    $summary = 'run ok scanned={0} oversized={1} handled={2} freeGB={3} lowDisk={4} dur={5}s{6}' -f $files.Count, $big.Count, $handled, $freeGB.ToString('0.0', $inv), $lowAlert, $sw.Elapsed.TotalSeconds.ToString('0.0', $inv), $(if ($DryRun) { ' (dry-run)' } else { '' })
    Write-Log $summary
    if (-not $DryRun) { Write-Host $summary }
    exit 0
} catch {
    try { Write-Log ('run FAILED ({0}: {1})' -f $_.Exception.GetType().Name, $_.Exception.Message) } catch {}
    exit 1
}
