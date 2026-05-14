# Install the DashClaw plugin into a local Hermes Agent installation.
#
# Usage:
#   .\scripts\install-hermes-plugin.ps1
#   .\scripts\install-hermes-plugin.ps1 -Force          # overwrite an existing install
#   .\scripts\install-hermes-plugin.ps1 -Mode copy      # copy instead of symlink
#
# What it does:
#   1. Resolves the DashClaw checkout root (this repo).
#   2. Symlinks (or copies) plugins/dashclaw/.hermes-plugin into
#      $env:USERPROFILE\.hermes\plugins\dashclaw .
#   3. Symlinks (or copies) plugins/dashclaw/skills into
#      $env:USERPROFILE\.hermes\skills (with dashclaw/ prefix preserved).
#   4. Appends the hooks block from hermes_config_snippet.yaml to
#      $env:USERPROFILE\.hermes\config.yaml (with a sentinel marker so a
#      re-run won't duplicate it).
#   5. Prints the env-var checklist the user must complete.

[CmdletBinding()]
param(
    [switch]$Force,
    [ValidateSet('symlink','copy')]
    [string]$Mode = 'symlink'
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    # Script lives at <repo>/scripts/, so the repo root is one level up.
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-HermesHome {
    if ($env:HERMES_HOME) { return $env:HERMES_HOME }
    return (Join-Path $env:USERPROFILE '.hermes')
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Place-Item {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$ItemMode
    )

    if (Test-Path $Destination) {
        if ($Force) {
            Remove-Item -Recurse -Force $Destination
        } else {
            Write-Host "  ! $Destination already exists. Re-run with -Force to replace." -ForegroundColor Yellow
            return $false
        }
    }

    if ($ItemMode -eq 'symlink') {
        try {
            New-Item -ItemType SymbolicLink -Path $Destination -Target $Source -Force | Out-Null
            Write-Host "  + symlink $Destination -> $Source"
            return $true
        } catch {
            Write-Host "  ! symlink failed ($($_.Exception.Message)); falling back to copy" -ForegroundColor Yellow
        }
    }

    Copy-Item -Recurse -Force $Source $Destination
    Write-Host "  + copied $Source -> $Destination"
    return $true
}

$repoRoot = Resolve-RepoRoot
$hermesHome = Get-HermesHome
$pluginSource = Join-Path $repoRoot 'plugins\dashclaw\.hermes-plugin'
$skillsSource = Join-Path $repoRoot 'plugins\dashclaw\skills'
$snippetPath = Join-Path $pluginSource 'hermes_config_snippet.yaml'

if (-not (Test-Path $pluginSource)) {
    throw "Plugin source not found at $pluginSource. Are you running this from inside the DashClaw checkout?"
}

Write-Host "DashClaw -> Hermes Agent plugin install" -ForegroundColor Cyan
Write-Host "  repo root  : $repoRoot"
Write-Host "  hermes home: $hermesHome"
Write-Host "  mode       : $Mode"

Ensure-Directory (Join-Path $hermesHome 'plugins')
Ensure-Directory (Join-Path $hermesHome 'skills')

Write-Host "`nStep 1: place plugin"
Place-Item -Source $pluginSource `
           -Destination (Join-Path $hermesHome 'plugins\dashclaw') `
           -ItemMode $Mode | Out-Null

Write-Host "`nStep 2: place skills (auto-discovery path)"
Place-Item -Source $skillsSource `
           -Destination (Join-Path $hermesHome 'skills\dashclaw') `
           -ItemMode $Mode | Out-Null

Write-Host "`nStep 3: append hooks to config.yaml"
$configPath = Join-Path $hermesHome 'config.yaml'
$marker = '# >>> dashclaw hooks (auto-installed) >>>'
$endMarker = '# <<< dashclaw hooks (auto-installed) <<<'

if (Test-Path $configPath) {
    $existing = Get-Content $configPath -Raw
    if ($existing -match [regex]::Escape($marker)) {
        Write-Host "  = config.yaml already contains the dashclaw hooks block (skipping)"
    } else {
        $snippetText = Get-Content $snippetPath -Raw
        # Substitute the absolute repo path for ${DASHCLAW_REPO}.
        $resolvedSnippet = $snippetText.Replace('${DASHCLAW_REPO}', $repoRoot.Replace('\','/'))
        Add-Content -Path $configPath -Value "`n$marker`n$resolvedSnippet`n$endMarker`n"
        Write-Host "  + appended dashclaw hooks block to $configPath"
    }
} else {
    $snippetText = Get-Content $snippetPath -Raw
    $resolvedSnippet = $snippetText.Replace('${DASHCLAW_REPO}', $repoRoot.Replace('\','/'))
    Set-Content -Path $configPath -Encoding UTF8 -Value "$marker`n$resolvedSnippet`n$endMarker`n"
    Write-Host "  + created $configPath with dashclaw hooks block"
}

Write-Host "`nStep 4: env-var checklist" -ForegroundColor Cyan
$missing = @()
if (-not $env:DASHCLAW_BASE_URL) { $missing += 'DASHCLAW_BASE_URL' }
if (-not $env:DASHCLAW_API_KEY)  { $missing += 'DASHCLAW_API_KEY' }
if ($missing.Count -gt 0) {
    Write-Host "  ! Missing: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "    Set them in your shell or under `plugins.dashclaw.env:` in $configPath."
} else {
    Write-Host "  = DASHCLAW_BASE_URL and DASHCLAW_API_KEY are set"
}

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  hermes plugins enable dashclaw"
Write-Host "  hermes dashclaw doctor"
Write-Host "  hermes               # starts a session; the dashclaw plugin is active"
