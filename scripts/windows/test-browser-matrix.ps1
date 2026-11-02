param([Parameter(Mandatory=$true)][string]$InstalledExe,[Parameter(Mandatory=$true)][string]$Results)
$ErrorActionPreference='Stop'
$manifest=Get-Content "$PSScriptRoot\browser-test-manifest.json" -Raw | ConvertFrom-Json
$work=Join-Path $env:RUNNER_TEMP 'GetANNYBrowserBinaries'
New-Item $work -ItemType Directory -Force | Out-Null
New-Item $Results -ItemType Directory -Force | Out-Null
$matrix=[System.Collections.Generic.List[object]]::new()
function Fetch-Browser([string]$id) {
 $entry=$manifest.$id;$file=Join-Path $work "$id.$($entry.type -eq 'zip' ? 'zip' : 'exe')"
 Invoke-WebRequest $entry.url -OutFile $file -TimeoutSec 120
 if((Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw "Checksum mismatch for $id"}
 if($entry.type -eq 'zip') {
  $folder=Join-Path $work $id
  Expand-Archive $file $folder -Force
  $candidate=Get-ChildItem $folder -Filter $entry.file -File -Recurse | Select-Object -First 1
  if(-not $candidate){throw "$id browser executable missing from verified archive"}
  return $candidate.FullName
 }
 # The exact installer SHA-256 was verified immediately above. Avoid the
 # platform Authenticode lookup here: certificate revocation checks can wait
 # indefinitely on a hosted runner with restricted certificate endpoints.
 $process=Start-Process $file -ArgumentList $entry.args -PassThru
 if(-not $process.WaitForExit(240000)){Stop-Process $process.Id -Force;throw "$id installer timed out"}
 if($process.ExitCode -notin @(0,3010)){throw "$id installer exited $($process.ExitCode)"}
 $paths=if($id -eq 'vivaldi'){@("$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe","$env:PROGRAMFILES\Vivaldi\Application\vivaldi.exe")}else{@("$env:LOCALAPPDATA\Programs\Opera\opera.exe","$env:PROGRAMFILES\Opera\opera.exe")}
 foreach($candidate in $paths){if(Test-Path $candidate){return $candidate}}
 if($id -eq 'opera') {
  # Opera also ships launcher.exe at the root and its actual browser in a
  # versioned subdirectory. Use the real browser, preserving the CDP pipe.
  foreach($directory in @("$env:LOCALAPPDATA\Programs\Opera","$env:PROGRAMFILES\Opera","${env:PROGRAMFILES(X86)}\Opera")) {
   if(-not(Test-Path $directory)){continue}
   $candidate=Get-ChildItem $directory -Filter opera.exe -File -Recurse | Select-Object -First 1
   if($candidate){return $candidate.FullName}
  }
 }
 throw "$id installed, but its executable was not found"
}
foreach($id in @('helium','brave','vivaldi','opera','firefox','chrome')) {
 $folder=Join-Path $Results $id;New-Item $folder -ItemType Directory -Force | Out-Null
 try {
  if($id -eq 'firefox') {
   $browser="$env:PROGRAMFILES\Mozilla Firefox\firefox.exe"
   if(-not(Test-Path $browser)){throw 'Firefox is not installed on this runner.'}
   $gecko=Fetch-Browser 'geckodriver'
  }elseif($id -eq 'chrome') {
   $browser=@("$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe","${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object {Test-Path $_} | Select-Object -First 1
   if(-not $browser){throw 'Google Chrome is not installed on this runner.'}
  }else{$browser=Fetch-Browser $id}
 }catch{
  $matrix.Add(@{browser=$id;status='unverified';reason=$_.Exception.Message})
  Write-Warning "$id unavailable: $($_.Exception.Message)"
  continue
 }
 Write-Host "Testing actual $id binary $browser with a new isolated profile..."
 $runtimeLog="$folder\runtime.log"
 if($id -eq 'firefox'){
  & node "$PSScriptRoot\run-browser-test.js" 360000 $runtimeLog "$PSScriptRoot\test-firefox.js" $InstalledExe $folder $browser $gecko
 } else {
  & node "$PSScriptRoot\run-browser-test.js" 360000 $runtimeLog "$PSScriptRoot\test-extension.js" $InstalledExe $folder $id $browser
 }
 $code=$LASTEXITCODE
 if($code -eq 124){Write-Warning "$id runtime exceeded six minutes and its process tree was terminated."}
 if(Test-Path "$folder\browser-report.json") {
  $report=Get-Content "$folder\browser-report.json" -Raw | ConvertFrom-Json
  if($id -eq 'vivaldi' -and $report.failureCategory -eq 'browser-baseline' -and $report.baseline.passed -eq $false) {
   $matrix.Add(@{browser=$id;status='unverified';reason=('Normal browser baseline WITHOUT GetANNY could not be verified in this runner: '+$report.baseline.error);report="$id/browser-report.json"})
  }else{$matrix.Add(@{browser=$id;status=($code -eq 0 -and $report.passed ? 'passed' : 'failed');report="$id/browser-report.json"})}
 }else{$matrix.Add(@{browser=$id;status='failed';reason="Test exited $code before producing a report."})}
}
$matrix.Add(@{browser='edge';status='unverified';reason='Additional browser; ordinary developer-mode/store installation needs individual manual verification.'})
$chromium=Join-Path (Split-Path $Results -Parent) 'browser\browser-report.json'
if(Test-Path $chromium){$r=Get-Content $chromium -Raw|ConvertFrom-Json;$matrix.Add(@{browser='chromium';status=($r.passed ? 'passed' : 'failed');report='../browser/browser-report.json'})}
$matrix | ConvertTo-Json -Depth 8 | Set-Content "$Results\matrix.json"
if($matrix|Where-Object status -eq 'failed'){throw 'An available browser failed real extension/native/download tests. Inspect matrix.json and the individual reports.'}
