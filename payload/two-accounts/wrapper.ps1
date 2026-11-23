# >>> claude accounts >>>
function claude {
    $secondFlag = '-P'
    $secondDir = '.claude-personal'
    $exe = Get-Command claude -All -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -match '\.(exe|cmd|ps1)$' } |
        Select-Object -First 1 -ExpandProperty Source
    if (-not $exe) { Write-Warning '[claude accounts] claude executable not found on PATH'; return }
    $second = $false
    $after = $false
    $rest = @(foreach ($a in $args) {
        if (-not $after -and $a -ceq $secondFlag) { $second = $true; continue }
        if ($a -eq '--') { $after = $true }
        $a
    })
    if ($second) {
        $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty Source
        if (-not $node) { Write-Warning '[claude accounts] node not found on PATH; second profile not launched'; return }
        & $node "$env:USERPROFILE\.claude\tools\sync-second-profile.mjs" --profile-dir $secondDir --quiet
        $syncExit = $LASTEXITCODE
        if ($syncExit -eq 2) { Write-Warning '[claude accounts] second profile not launched (see the message above)'; return }
        if ($syncExit -ne 0) { Write-Warning "[claude accounts] profile sync failed (exit $syncExit), launching anyway" }
        $prev = $env:CLAUDE_CONFIG_DIR
        $env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE $secondDir
        try {
            if ($MyInvocation.ExpectingInput) { $input | & $exe @rest } else { & $exe @rest }
        } finally {
            $env:CLAUDE_CONFIG_DIR = $prev
        }
    } elseif ($MyInvocation.ExpectingInput) {
        $input | & $exe @args
    } else {
        & $exe @args
    }
}
# <<< claude accounts <<<
