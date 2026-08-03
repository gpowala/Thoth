<#
.SYNOPSIS
  Build and register the Thoth native input-capture host for Edge/Chrome.

.DESCRIPTION
  1. Publishes ThothInputCapture.exe (framework-dependent, needs .NET 8 runtime;
     pass -SelfContained to bundle the runtime instead).
  2. Writes the native-messaging manifest with the real exe path + your unpacked
     extension ID.
  3. Registers it under HKCU for each requested browser so the extension can
     connectNative("com.thoth.inputcapture").

.PARAMETER ExtensionId
  The unpacked extension ID. Find it at edge://extensions (Developer mode on) or
  chrome://extensions — it's the 32-char id under the "Screenshot Sender" card.

.PARAMETER Browsers
  Which browsers to register for. Default: Edge. Options: Edge, Chrome.

.PARAMETER SelfContained
  Bundle the .NET runtime into the exe (no .NET install required on the machine).

.EXAMPLE
  ./register.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop -Browsers Edge,Chrome

.EXAMPLE
  ./register.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop -Unregister
#>
param(
    [Parameter(Mandatory = $false)]
    [string]$ExtensionId,

    [ValidateSet('Edge', 'Chrome')]
    [string[]]$Browsers = @('Edge'),

    [switch]$SelfContained,

    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$HostName = 'com.thoth.inputcapture'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$regRoots = @{
    Edge   = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
    Chrome = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
}

if ($Unregister) {
    foreach ($b in $Browsers) {
        $key = Join-Path $regRoots[$b] $HostName
        if (Test-Path $key) {
            Remove-Item -Path $key -Force
            Write-Host "Unregistered $HostName for $b" -ForegroundColor Yellow
        } else {
            Write-Host "No $b registration found." -ForegroundColor DarkGray
        }
    }
    return
}

if (-not $ExtensionId) {
    throw "ExtensionId is required to register. Get it from edge://extensions (Developer mode)."
}
if ($ExtensionId -notmatch '^[a-p]{32}$') {
    Write-Warning "ExtensionId '$ExtensionId' doesn't look like a 32-char unpacked id ([a-p]{32}). Continuing anyway."
}

# --- 1. Publish the exe ----------------------------------------------------
$proj = Join-Path $here 'ThothInputCapture\ThothInputCapture.csproj'
$publishDir = Join-Path $here 'ThothInputCapture\publish'

Write-Host "Publishing ThothInputCapture..." -ForegroundColor Cyan
$publishArgs = @(
    'publish', $proj,
    '-c', 'Release',
    '-r', 'win-x64',
    '-o', $publishDir,
    "/p:SelfContained=$($SelfContained.IsPresent)"
)
if ($SelfContained) {
    $publishArgs += '/p:PublishSingleFile=true'
} else {
    $publishArgs += '--no-self-contained'
}

& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit $LASTEXITCODE)." }

$exePath = Join-Path $publishDir 'ThothInputCapture.exe'
if (-not (Test-Path $exePath)) { throw "Expected exe not found at $exePath" }
Write-Host "Published: $exePath" -ForegroundColor Green

# --- 2. Write the manifest -------------------------------------------------
$template = Get-Content (Join-Path $here 'com.thoth.inputcapture.template.json') -Raw
$manifest = $template.
    Replace('__EXE_PATH__', $exePath.Replace('\', '\\')).
    Replace('__EXTENSION_ID__', $ExtensionId)

$manifestPath = Join-Path $publishDir "$HostName.json"
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8
Write-Host "Wrote manifest: $manifestPath" -ForegroundColor Green

# --- 3. Register per browser ----------------------------------------------
foreach ($b in $Browsers) {
    $root = $regRoots[$b]
    if (-not (Test-Path $root)) { New-Item -Path $root -Force | Out-Null }
    $key = Join-Path $root $HostName
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestPath
    Write-Host "Registered $HostName for $b -> $manifestPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Restart the browser, reload the extension, and start a recording." -ForegroundColor Cyan
