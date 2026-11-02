$ErrorActionPreference = 'Stop'
trap {
  if($results -and (Test-Path $results)) {
    @{passed=$false;date=(Get-Date -Format o);error=$_.Exception.Message;script=$_.ScriptStackTrace} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $results 'installer-fatal.json')
  }
  throw $_
}
if($env:CI -ne 'true' -or -not $env:RUNNER_TEMP){throw 'Installer tests modify the default app profile and require a disposable Windows CI account.'}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$results = Join-Path $root 'test-results\windows'
$installRoot = Join-Path $env:RUNNER_TEMP 'GetANNYInstallerTests'
New-Item $results -ItemType Directory -Force | Out-Null
New-Item $installRoot -ItemType Directory -Force | Out-Null
$exePackage = Join-Path $root 'dist\GetANNY Setup.exe'
$msiPackage = Join-Path $root 'dist\GetANNY Setup.msi'
function Run-Checked([string] $File, [string[]] $Arguments, [int] $Timeout = 420000, [switch] $CaptureOutput) {
  $started = Get-Date
  "START $($started.ToString('o')) PID-pending $File $($Arguments -join ' ')" | Add-Content (Join-Path $results 'processes.log')
  $start = @{FilePath=$File;ArgumentList=$Arguments;PassThru=$true}
  if ($CaptureOutput) {
    $prefix = 'process-' + [guid]::NewGuid().ToString('N')
    $start.RedirectStandardOutput = Join-Path $results "$prefix.stdout.log"
    $start.RedirectStandardError = Join-Path $results "$prefix.stderr.log"
  }
  $p = Start-Process @start
  "STARTED $($started.ToString('o')) PID=$($p.Id) $File" | Add-Content (Join-Path $results 'processes.log')
  if (-not $p.WaitForExit($Timeout)) {
    $processInfo = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq $p.Id -or $_.ParentProcessId -eq $p.Id -or $_.Name -in @('GetANNY.exe','GetANNY Setup.exe')
    } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
    $files = @()
    if (Test-Path $installRoot) {
      $files = @(Get-ChildItem $installRoot -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime)
    }
    @{passed=$false;date=(Get-Date -Format o);file=$File;arguments=$Arguments;timeoutMs=$Timeout;processes=$processInfo;installFiles=$files} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $results 'process-timeout.json')
    & taskkill.exe /PID $p.Id /T /F 2>&1 | Add-Content (Join-Path $results 'processes.log')
    throw "Timed out: $File. See process-timeout.json and processes.log"
  }
  "EXIT $((Get-Date).ToString('o')) PID=$($p.Id) code=$($p.ExitCode) elapsedMs=$([int]((Get-Date)-$started).TotalMilliseconds)" | Add-Content (Join-Path $results 'processes.log')
  if ($p.ExitCode -notin @(0, 3010)) { throw "$File exited $($p.ExitCode)" }
}
function Self-Test([string] $InstalledExe, [string] $Name, [string] $Data) {
  if (-not (Test-Path $InstalledExe)) { throw "Installed application missing: $InstalledExe" }
  $report = Join-Path $results "$Name.json"
  Run-Checked $InstalledExe @('--self-test','--test-user-data',"`"$Data`"",'--report',"`"$report`"")
  $result = Get-Content $report -Raw | ConvertFrom-Json
  if (-not $result.passed -or -not $result.packaged -or $result.platform -ne 'win32') { throw "Installed-app self-test failed: $report" }
  Write-Host ("::notice title=Installed app {0}::{1} actual packaged Windows checks passed" -f $Name,$result.checks.Count)
  foreach ($check in $result.checks) {
    Write-Host "PASS $Name : $($check.name)"
    if ($check.name -eq 'Rendered layouts at 1320, 1024 and 760 pixel windows') {
      foreach ($screenshot in $check.detail) { Copy-Item $screenshot (Join-Path $results "$Name-$(Split-Path $screenshot -Leaf)") }
    }
  }
}
function Assert-Shortcuts([string] $InstalledExe) {
  $shell = New-Object -ComObject WScript.Shell
  $found = [System.Collections.Generic.List[object]]::new()
  try {
    foreach ($location in @(
      @{kind='desktop';path=[Environment]::GetFolderPath('DesktopDirectory')},
      @{kind='desktop';path=[Environment]::GetFolderPath('CommonDesktopDirectory')},
      @{kind='startMenu';path=[Environment]::GetFolderPath('Programs')},
      @{kind='startMenu';path=[Environment]::GetFolderPath('CommonPrograms')}
    )) {
      if (-not $location.path -or -not (Test-Path $location.path)) { continue }
      foreach ($file in Get-ChildItem $location.path -Filter '*GetANNY*.lnk' -File -Recurse -ErrorAction SilentlyContinue) {
        $link=$shell.CreateShortcut($file.FullName)
        try { if ($link.TargetPath -ieq $InstalledExe) { $found.Add(@{kind=$location.kind;path=$file.FullName;target=$link.TargetPath}) } }
        finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null }
      }
    }
  } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
  if (-not ($found | Where-Object kind -eq 'desktop')) { throw 'Default desktop shortcut missing or targets the wrong application.' }
  if (-not ($found | Where-Object kind -eq 'startMenu')) { throw 'Start Menu shortcut missing or targets the wrong application.' }
  return $found.ToArray()
}
function Desktop-Lifecycle([string] $InstalledExe, [string] $Name, [string] $Data, $Shortcuts) {
  $desktop=$Shortcuts | Where-Object kind -eq 'desktop' | Select-Object -First 1
  $startMenu=$Shortcuts | Where-Object kind -eq 'startMenu' | Select-Object -First 1
  & node "$PSScriptRoot\test-desktop-lifecycle.js" $InstalledExe $Data (Join-Path $results "$Name-desktop-lifecycle.json") $desktop.path $startMenu.path
  if($LASTEXITCODE -ne 0){throw 'Installed cold native / actual shell shortcut lifecycle test failed.'}
  Write-Host ("::notice title=Desktop lifecycle {0}::Compiled-native cold launch, real output hash, no resurrection and both actual shell shortcut launches passed" -f $Name)
}
function Profile-Snapshot([string] $Data) {
  $json=& node "$PSScriptRoot\snapshot-profile.js" (Join-Path $Data 'getanny.db')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read real default-profile retention snapshot.' }
  return ($json | ConvertFrom-Json)
}
function Owned-NativeEntries([string] $Data) {
  $found=[System.Collections.Generic.List[object]]::new()
  $vendors=@('Google\Chrome','Chromium','Mozilla','Vivaldi','Microsoft\Edge','BraveSoftware\Brave-Browser','Opera Software\Opera Stable')
  foreach($vendor in $vendors) {
    $key="HKCU\Software\$vendor\NativeMessagingHosts\com.getanny.native"
    foreach($view in @('64','32')) {
      $output=& reg.exe query $key /ve "/reg:$view" 2>$null
      if($LASTEXITCODE -ne 0){continue}
      $text=($output -join "`n")
      if($text -match [regex]::Escape("$Data\native-messaging\")) {
        $value=([regex]::Match($text,'REG_SZ\s+(.+)$',[Text.RegularExpressions.RegexOptions]::Multiline)).Groups[1].Value.Trim()
        $found.Add(@{key=$key;view=$view;value=$value})
      }
    }
  }
  $expected=$vendors.Count * 2
  if($found.Count -ne $expected){throw "Expected $expected owned native registrations across both registry views; found $($found.Count)."}
  return $found.ToArray()
}
function Wait-ProductRemoved([string] $InstalledExe, [string] $UninstallerPath, [int] $Timeout = 60000) {
  $started=Get-Date
  while((Test-Path -LiteralPath $InstalledExe) -or (Test-Path -LiteralPath $UninstallerPath)) {
    if(((Get-Date)-$started).TotalMilliseconds -ge $Timeout) {
      $installDirectory=Split-Path $InstalledExe -Parent
      $processes=@(Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDirectory,[StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.Contains($installDirectory,[StringComparison]::OrdinalIgnoreCase)) -or
        $_.Name -like '*GetANNY*'
      } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
      $files=@(Get-ChildItem $installDirectory -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime)
      @{passed=$false;date=(Get-Date -Format o);timeoutMs=$Timeout;installedExe=$InstalledExe;uninstaller=$UninstallerPath;processes=$processes;remainingFiles=$files} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $results 'exe-uninstall-timeout.json')
      throw "EXE uninstallation did not remove product files within $Timeout ms. See exe-uninstall-timeout.json."
    }
    Start-Sleep -Milliseconds 250
  }
  "REMOVED $((Get-Date).ToString('o')) exe=$InstalledExe elapsedMs=$([int]((Get-Date)-$started).TotalMilliseconds)" | Add-Content (Join-Path $results 'processes.log')
}
function Assert-Uninstalled([string] $InstalledExe, $Shortcuts, [string] $Data, $Before, $NativeEntries) {
  $bridgeReport=Join-Path $Data 'browser-uninstall-report.json'
  if(Test-Path $bridgeReport){Copy-Item $bridgeReport (Join-Path $results ((Split-Path (Split-Path $InstalledExe -Parent) -Leaf)+'-uninstall-bridge.json'))}
  if (Test-Path $InstalledExe) { throw 'Uninstallation left the application executable.' }
  foreach ($link in $Shortcuts) { if (Test-Path $link.path) { throw "Uninstallation left shortcut $($link.path)" } }
  foreach($directory in @('native-messaging','extensions')) {if(Test-Path (Join-Path $Data $directory)){throw "Uninstall left owned prepared directory $directory"}}
  $after=Profile-Snapshot $Data
  foreach($entry in $NativeEntries) {
    $output=& reg.exe query $entry.key /ve "/reg:$($entry.view)" 2>$null
    if($LASTEXITCODE -eq 0 -and (($output -join "`n") -match [regex]::Escape($entry.value))) {
      throw "Owned native registry entry survived uninstall: $($entry.key) ($($entry.view)-bit view)"
    }
  }
  if($after.missingCompletedFiles -gt $Before.missingCompletedFiles) {throw 'Uninstallation removed a real completed output from the default profile.'}
  if ($after.history -lt 1 -or $Before.sha256 -cne $after.sha256) { throw 'Uninstallation changed or removed actual default-profile history/settings.' }
  return @{history=$after.history;settings=$after.settings;sha256=$after.sha256;retained=$true;missingCompletedFiles=$after.missingCompletedFiles;ownedNativeEntries=$NativeEntries.Count;nativeCleanupVerified=($NativeEntries.Count -gt 0)}
}
Write-Host 'Testing the actual portable executable before installed-app tests...'
Self-Test (Join-Path $root 'dist\GetANNY Portable.exe') 'portable-first-launch' (Join-Path $installRoot 'portable-data')
$defaultData = Join-Path $env:APPDATA 'getanny'
$exeDir = Join-Path $installRoot 'exe-app'
$exeData = Join-Path $installRoot 'exe-data'
Write-Host 'Checking the unpacked browser-setup helper before NSIS installation...'
$setupReport = Join-Path $results 'setup-helper.json'
Run-Checked (Join-Path $root 'dist\win-unpacked\GetANNY.exe') @('--setup-browser-hosts','--quiet','--enable-logging','--report',"`"$setupReport`"") 90000 -CaptureOutput
Write-Host 'Installing the actual NSIS EXE package...'
Run-Checked $exePackage @('/S','/currentuser',"/D=$exeDir")
$installedExe = Join-Path $exeDir 'GetANNY.exe'
$exeShortcuts=@(Assert-Shortcuts $installedExe)
Self-Test $installedExe 'exe-first-install' $exeData
Write-Host 'Reinstalling EXE (upgrade / repair preservation test)...'
Run-Checked $exePackage @('/S','/currentuser',"/D=$exeDir")
Self-Test $installedExe 'exe-upgrade-restart' $exeData
$restart = Get-Content (Join-Path $results 'exe-upgrade-restart.json') -Raw | ConvertFrom-Json
if (-not ($restart.checks | Where-Object name -eq 'Persisted history, settings and actual process restart marker').detail.priorRunObserved) { throw 'EXE reinstall destroyed persisted data.' }
Self-Test $installedExe 'exe-actual-default-profile' $defaultData
Run-Checked $installedExe @('--setup-browser-hosts','--quiet')
Desktop-Lifecycle $installedExe 'exe' $defaultData $exeShortcuts
$exeNativeEntries=@(Owned-NativeEntries $defaultData)
$exeDefaultBefore=Profile-Snapshot $defaultData
$uninstaller = Get-ChildItem $exeDir -Filter '*Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'EXE uninstaller not found.' }
Run-Checked $uninstaller.FullName @('/S')
$exeCleanupError=$null;$exeDefaultRetained=$null
try {
  # NSIS first launches a temporary uninstaller and can return before that child
  # removes the product. Wait for the measured product state, not the stub PID.
  Wait-ProductRemoved $installedExe $uninstaller.FullName
  if (-not (Test-Path (Join-Path $exeData 'getanny.db'))) { throw 'Uninstaller destroyed isolated test history.' }
  $exeDefaultRetained=Assert-Uninstalled $installedExe $exeShortcuts $defaultData $exeDefaultBefore $exeNativeEntries
}
catch {$exeCleanupError=$_.Exception.Message;Write-Warning "EXE cleanup gate failed; preserve failure and measure independent MSI tests: $exeCleanupError"}
$exeFilesRemoved=(-not(Test-Path $installedExe) -and -not(Test-Path $uninstaller.FullName))
@{passed=($null -eq $exeCleanupError);error=$exeCleanupError;exe=@{installed=$true;reinstalled=$true;uninstalled=($null -eq $exeCleanupError);applicationFilesRemoved=$exeFilesRemoved};defaultProfileRetention=@{exe=$exeDefaultRetained};shortcuts=@{exe=$exeShortcuts;createdAndTargetsVerified=$true;removedOnUninstall=($null -eq $exeCleanupError);shellLaunch='passed-in-exe-desktop-lifecycle.json'}} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $results 'exe-uninstall.json')
Write-Host 'Installing the actual MSI package...'
$msiDir = Join-Path $installRoot 'msi-app'
$msiData = Join-Path $installRoot 'msi-data'
Run-Checked 'msiexec.exe' @('/i',"`"$msiPackage`"",'/qn','/norestart',"APPLICATIONFOLDER=`"$msiDir`"",'ALLUSERS=2','MSIINSTALLPERUSER=1',"/l*v `"$results\msi-install.log`"")
$installedMsiExe = Join-Path $msiDir 'GetANNY.exe'
$msiShortcuts=@(Assert-Shortcuts $installedMsiExe)
Self-Test $installedMsiExe 'msi-first-install' $msiData
Run-Checked 'msiexec.exe' @('/i',"`"$msiPackage`"",'/qn','/norestart',"APPLICATIONFOLDER=`"$msiDir`"",'ALLUSERS=2','MSIINSTALLPERUSER=1',"/l*v `"$results\msi-reinstall.log`"")
Self-Test $installedMsiExe 'msi-upgrade-restart' $msiData
$restart = Get-Content (Join-Path $results 'msi-upgrade-restart.json') -Raw | ConvertFrom-Json
if (-not ($restart.checks | Where-Object name -eq 'Persisted history, settings and actual process restart marker').detail.priorRunObserved) { throw 'MSI reinstall destroyed persisted data.' }
Write-Host 'Testing an actual Chromium extension with the installed MSI application...'
& node "$PSScriptRoot\test-extension.js" $installedMsiExe "$results\browser"
if ($LASTEXITCODE -ne 0) { throw 'Installed-app Chromium extension test failed.' }
Write-Host 'Testing other available real browser brands (never personal profiles)...'
$matrixError=$null
try { & "$PSScriptRoot\test-browser-matrix.ps1" -InstalledExe $installedMsiExe -Results "$results\browser-matrix" }
catch { $matrixError=$_.Exception.Message;Write-Warning "Browser gate failed; continue independent MSI retention/uninstall checks, then fail overall: $matrixError" }
Self-Test $installedMsiExe 'msi-actual-default-profile' $defaultData
Run-Checked $installedMsiExe @('--setup-browser-hosts','--quiet')
Desktop-Lifecycle $installedMsiExe 'msi' $defaultData $msiShortcuts
$msiNativeEntries=@(Owned-NativeEntries $defaultData)
$msiDefaultBefore=Profile-Snapshot $defaultData
Run-Checked 'msiexec.exe' @('/x',"`"$msiPackage`"",'/qn','/norestart',"/l*v `"$results\msi-uninstall.log`"")
if (Test-Path $installedMsiExe) { throw 'MSI uninstallation left the application executable.' }
if (-not (Test-Path (Join-Path $msiData 'getanny.db'))) { throw 'MSI uninstall destroyed isolated test history.' }
$msiDefaultRetained=Assert-Uninstalled $installedMsiExe $msiShortcuts $defaultData $msiDefaultBefore $msiNativeEntries
$signatures = @($exePackage,$msiPackage,(Join-Path $root 'dist\GetANNY Portable.exe')) | ForEach-Object { $sig = Get-AuthenticodeSignature $_; @{file=(Split-Path $_ -Leaf);status=$sig.Status.ToString()} }
@{passed=($null -eq $matrixError -and $null -eq $exeCleanupError);exeCleanupError=$exeCleanupError;browserMatrixError=$matrixError;date=(Get-Date -Format o);exe=@{installed=$true;reinstalled=$true;uninstalled=($null -eq $exeCleanupError);applicationFilesRemoved=$true};msi=@{installed=$true;reinstalled=$true;uninstalled=$true};signatures=$signatures;defaultProfileRetention=@{exe=$exeDefaultRetained;msi=$msiDefaultRetained};shortcuts=@{exe=$exeShortcuts;msi=$msiShortcuts;createdAndTargetsVerified=$true;removedOnUninstall=$true;shellLaunch='passed-in-desktop-lifecycle-reports'};limitations=@('GitHub-hosted Windows runner is not a pristine consumer Windows installation.','Same-version reinstall tested; migration from the old v1 installer requires manual validation.','Shortcut files, targets, removal and actual shell launches checked; interactive options dialogs still require manual inspection.','See browser-matrix/matrix.json for actual per-brand results; Production browser-UI consent and permanent store/signed installation remain manual.')} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $results 'installer-report.json')
if($exeCleanupError){throw "EXE cleanup gate failed: $exeCleanupError. Independent MSI/browser evidence was preserved; this is not a release pass."}
if($matrixError){throw "Available browser gate failed: $matrixError. Independent installer/retention results are preserved in installer-report.json."}
Write-Host 'EXE, MSI, installed downloads, restart preservation, native chain and available-browser extension checks passed.'
