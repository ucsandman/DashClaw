# Fresh-machine entry-path drill (roadmap v8.3). Runs INSIDE Windows Sandbox at
# logon, fully automated (no human in the sandbox). Proves the DISTRIBUTION path:
# `npx dashclaw up` resolving the published npm CLI + GitHub release tarball on a
# factory-fresh Windows image. This is a MAINTAINER instrument, not product code.
#
# Every exit path (success, caught error, or unexpected throw) writes
# C:\Shared\drill-result.json — the host launcher (fresh-windows.mjs) polls for
# that file and treats its absence after the timeout as a fail.

$ErrorActionPreference = 'Stop'
Start-Transcript -Path C:\Shared\drill.log -Append

$script:steps = @()
$script:nodeVersion = $null
$script:cliSpec = '@dashclaw/cli@latest'

function Add-Step {
    param([string]$Id, [string]$Status, [string]$Detail)
    $script:steps += [ordered]@{ id = $Id; status = $Status; detail = $Detail }
    Write-Host "[drill] $Id -> $Status ($Detail)"
}

function Write-Result {
    param([string]$Verdict, [string]$FailedStep)
    $result = [ordered]@{
        verdict      = $Verdict
        failed_step  = $FailedStep
        steps        = $script:steps
        node_version = $script:nodeVersion
        cli_spec     = $script:cliSpec
        finished_at  = (Get-Date).ToUniversalTime().ToString('o')
    }
    $result | ConvertTo-Json -Depth 6 | Set-Content -Path C:\Shared\drill-result.json -Encoding UTF8
    Write-Host "[drill] wrote drill-result.json verdict=$Verdict"
}

$failedStep = $null

try {
    # --- Step: config ---------------------------------------------------
    try {
        $configPath = 'C:\Shared\drill-config.json'
        if (Test-Path $configPath) {
            $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
            if ($config.cliSpec) { $script:cliSpec = $config.cliSpec }
        }
        Add-Step -Id 'config' -Status 'pass' -Detail "cliSpec=$script:cliSpec"
    }
    catch {
        Add-Step -Id 'config' -Status 'pass' -Detail "config unreadable, using default $script:cliSpec ($_)"
    }

    # --- Step: node_install ----------------------------------------------
    try {
        Write-Host 'Fetching latest Node.js LTS version...'
        $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $lts = ($idx | Where-Object { $_.lts }) | Select-Object -First 1
        $ver = $lts.version
        Write-Host "Downloading and installing Node $ver (silent)..."
        $msiPath = Join-Path $env:TEMP 'node.msi'
        Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-x64.msi" -OutFile $msiPath
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait

        # Pick up the PATH the MSI just wrote so node/npm work in this session
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path', 'User')

        $script:nodeVersion = (node -v)
        Add-Step -Id 'node_install' -Status 'pass' -Detail "node=$script:nodeVersion npm=$(npm -v)"
    }
    catch {
        $failedStep = 'node_install'
        Add-Step -Id 'node_install' -Status 'fail' -Detail "$_"
        throw
    }

    # --- Step: up_launch ---------------------------------------------------
    try {
        $upLog = 'C:\Shared\up.log'
        if (Test-Path $upLog) { Remove-Item $upLog -Force }
        $upArgs = "/c npm exec --yes --package=$script:cliSpec -- dashclaw up --yes --db embedded --no-browser > `"$upLog`" 2>&1"
        Start-Process -FilePath 'cmd.exe' -ArgumentList $upArgs -WindowStyle Hidden | Out-Null
        Add-Step -Id 'up_launch' -Status 'pass' -Detail "launched: npm exec --package=$script:cliSpec -- dashclaw up"
    }
    catch {
        $failedStep = 'up_launch'
        Add-Step -Id 'up_launch' -Status 'fail' -Detail "$_"
        throw
    }

    # --- Step: health_poll ---------------------------------------------------
    $healthy = $false
    $deadline = (Get-Date).AddMinutes(10)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -TimeoutSec 5 -UseBasicParsing
            if ($resp.StatusCode -eq 200) { $healthy = $true; break }
        }
        catch {
            # not up yet, keep polling
        }
        Start-Sleep -Seconds 10
    }
    if ($healthy) {
        Add-Step -Id 'health_poll' -Status 'pass' -Detail 'GET /api/health returned 200'
    }
    else {
        $failedStep = 'health_poll'
        $tail = ''
        if (Test-Path 'C:\Shared\up.log') { $tail = (Get-Content 'C:\Shared\up.log' -Tail 30 -ErrorAction SilentlyContinue) -join "`n" }
        Add-Step -Id 'health_poll' -Status 'fail' -Detail "never became healthy within 10 minutes. up.log tail: $tail"
        throw 'health_poll timed out'
    }

    # --- Step: read_instance_key ---------------------------------------------------
    $apiKey = $null
    try {
        $instancePath = Join-Path $env:USERPROFILE '.dashclaw\instance.json'
        $instance = Get-Content -Raw -Path $instancePath | ConvertFrom-Json
        $apiKey = $instance.apiKey
        if (-not $apiKey) { throw 'apiKey missing from instance.json' }
        Add-Step -Id 'read_instance_key' -Status 'pass' -Detail "read apiKey from $instancePath"
    }
    catch {
        $failedStep = 'read_instance_key'
        Add-Step -Id 'read_instance_key' -Status 'fail' -Detail "$_"
        throw
    }

    # --- Step: post_action ---------------------------------------------------
    try {
        $body = @{
            agent_id      = 'smoke-drill-fresh'
            action_type   = 'smoke.drill'
            declared_goal = 'v8.3 fresh-machine drill: first governed action'
        } | ConvertTo-Json
        $actionResp = Invoke-WebRequest -Uri 'http://localhost:3000/api/actions' `
            -Method Post `
            -Headers @{ 'x-api-key' = $apiKey } `
            -ContentType 'application/json' `
            -Body $body `
            -UseBasicParsing
        if ($actionResp.StatusCode -eq 200 -or $actionResp.StatusCode -eq 201) {
            Add-Step -Id 'post_action' -Status 'pass' -Detail "POST /api/actions returned $($actionResp.StatusCode)"
        }
        else {
            $failedStep = 'post_action'
            Add-Step -Id 'post_action' -Status 'fail' -Detail "POST /api/actions returned $($actionResp.StatusCode)"
            throw "unexpected status $($actionResp.StatusCode)"
        }
    }
    catch {
        if (-not $failedStep) { $failedStep = 'post_action' }
        Add-Step -Id 'post_action' -Status 'fail' -Detail "$_"
        throw
    }

    Write-Result -Verdict 'pass' -FailedStep $null
}
catch {
    Write-Host "DRILL FAILED: $_"
    if (-not $failedStep) { $failedStep = 'unknown' }
    Write-Result -Verdict 'fail' -FailedStep $failedStep
}
finally {
    Stop-Transcript
}
