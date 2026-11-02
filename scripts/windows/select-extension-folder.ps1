# Test-only UI automation for Chrome's NORMAL "Load unpacked" folder dialog.
# Only the disposable browser profile launched by test-extension.js is targeted.
# No policy/registry/profile/signing changes; never used by the application.
param([Parameter(Mandatory=$true)][int]$BrowserPid,[Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath (Join-Path $Directory 'manifest.json'))){throw 'Prepared extension manifest missing.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GetANNYTestForeground {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$automation=[System.Windows.Automation.AutomationElement]
# Current Chrome can host its folder dialog below the browser UI tree or in a
# browser-owned utility process. Never target an unrelated process/window.
$allowed=[System.Collections.Generic.HashSet[int]]::new()
$allowed.Add($BrowserPid) | Out-Null
$windowCondition=[System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)
$deadline=(Get-Date).AddSeconds(25)
$dialog=$null
$seen=@()
while((Get-Date) -lt $deadline) {
  $processes=Get-CimInstance Win32_Process
  do {
    $changed=$false
    foreach($process in $processes) {
      if($allowed.Contains([int]$process.ParentProcessId) -and $allowed.Add([int]$process.ProcessId)){$changed=$true}
    }
  }while($changed)
  $windows=$automation::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$windowCondition)
  $seen=@()
  foreach($window in $windows) {
    if(-not $allowed.Contains($window.Current.ProcessId)){continue}
    $seen+=@{pid=$window.Current.ProcessId;name=$window.Current.Name;class=$window.Current.ClassName}
    if($window.Current.ClassName -eq '#32770' -or $window.Current.Name -match 'Select.*extension.*directory'){$dialog=$window;break}
  }
  if($dialog){break}
  Start-Sleep -Milliseconds 150
}
if(-not $dialog){throw ('Chrome folder dialog unavailable. Actual browser-owned windows: '+($seen | ConvertTo-Json -Compress))}
if(-not [GetANNYTestForeground]::SetForegroundWindow([IntPtr]$dialog.Current.NativeWindowHandle)){throw 'Chrome folder dialog could not be brought to the foreground.'}
# Windows can reject SetFocus on the top-level file-dialog element even though
# its native window is foreground and can safely receive Alt+D. The focused
# address element is ownership/type checked below before any path is entered.
try{$dialog.SetFocus()}catch{}
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('%d')
Start-Sleep -Milliseconds 150
$address=$automation::FocusedElement
if(-not $allowed.Contains($address.Current.ProcessId) -or $address.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){throw 'Folder-dialog address field is not focused; refusing to send a path to another window.'}
$value=$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue($Directory)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 250
$select=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty,'1'))
if(-not $select -or $select.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){throw 'Folder-dialog selection button missing.'}
$select.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Output 'Selected the prepared extension using the actual browser folder dialog.'
