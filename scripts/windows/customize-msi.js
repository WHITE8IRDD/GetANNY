const fs = require("node:fs/promises");
module.exports = async (filename) => {
  let xml = await fs.readFile(filename, "utf8");
  // Preserve the bundled candle toolchain's own schema. Its WiX 4 preview
  // still uses Product, but explicitly requires the v4 namespace.
  // MSI can report VersionNT=603 on Windows 10/11. Check the real OS build,
  // not a compatibility-virtualized VersionNT value.
  xml = xml
    .replace(
      "Installed OR VersionNT >= 601",
      "Installed OR GETANNY_WINDOWS_BUILD >= 10240",
    )
    .replace(
      "Windows 7 and above is required",
      "Windows 10 or later is required",
    );
  xml = xml.replace(
    "</Product>",
    `<Property Id="GETANNY_WINDOWS_BUILD"><RegistrySearch Id="GetANNYWindowsBuild" Root="HKLM" Key="SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" Name="CurrentBuildNumber" Type="raw" Win64="yes" /></Property></Product>`,
  );
  xml = xml.replace(
    "</Product>",
    `
    <Property Id="GETANNY_DESKTOP_SHORTCUT" Value="1" Secure="yes" />
    <!-- Browser integration is repairable and must not roll back the desktop
         product after InstallFinalize. The helper writes a per-browser report,
         and packaged startup retries stale or incomplete direct provisioning. -->
    <CustomAction Id="GetANNYPrepareBrowsers" FileKey="mainExecutable" ExeCommand="--setup-browser-hosts --quiet" Execute="immediate" Impersonate="yes" Return="ignore" />
    <CustomAction Id="GetANNYRemoveBrowsers" FileKey="mainExecutable" ExeCommand="--unregister-browser-hosts --quiet" Execute="immediate" Impersonate="yes" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="GetANNYRemoveBrowsers" Before="RemoveFiles">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>
      <Custom Action="GetANNYPrepareBrowsers" After="InstallFinalize">NOT REMOVE="ALL"</Custom>
    </InstallExecuteSequence>
  </Product>`,
  );
  // Move desktop shortcut out of the executable component so opting out never
  // accidentally makes the main EXE conditional.
  const shortcut = xml.match(/<Shortcut Id="desktopShortcut"[^>]+\/>/);
  if (shortcut) {
    xml = xml.replace(shortcut[0], "");
    const replacement = `<Component Id="OptionalDesktopShortcut" Guid="A76CA441-1688-4E23-AE86-D70D12758488" Directory="DesktopFolder">
      <Condition>GETANNY_DESKTOP_SHORTCUT=1</Condition>
      <Shortcut Id="desktopShortcut" Name="GetANNY" Target="[#mainExecutable]" WorkingDirectory="APPLICATIONFOLDER" Icon="GetANNYIcon.exe" />
      <RegistryValue Root="HKCU" Key="Software\\GetANNY\\Installer" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes" />
    </Component>`;
    xml = xml.replace(
      '<ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">',
      `<ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">\n${replacement}`,
    );
    const ui = `<UI>
      <Dialog Id="GetANNYShortcutDlg" Width="370" Height="270" Title="[ProductName] Setup">
        <Control Id="Title" Type="Text" X="20" Y="20" Width="330" Height="30" Transparent="yes" NoPrefix="yes" Text="Choose your GetANNY shortcuts" />
        <Control Id="Description" Type="Text" X="20" Y="55" Width="330" Height="35" Text="A Start Menu shortcut is always created. Browser extension installation requires your approval after setup." />
        <Control Id="DesktopOption" Type="CheckBox" X="20" Y="105" Width="330" Height="20" Property="GETANNY_DESKTOP_SHORTCUT" CheckBoxValue="1" Text="Create a desktop shortcut" />
        <Control Id="Back" Type="PushButton" X="180" Y="243" Width="56" Height="17" Text="Back"><Publish Event="NewDialog" Value="InstallDirDlg">1</Publish></Control>
        <Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Text="Next"><Publish Event="NewDialog" Value="VerifyReadyDlg">1</Publish></Control>
        <Control Id="Cancel" Type="PushButton" X="304" Y="243" Width="56" Height="17" Cancel="yes" Text="Cancel"><Publish Event="SpawnDialog" Value="CancelDlg">1</Publish></Control>
      </Dialog>
    </UI>`;
    xml = xml.replace("</Product>", `${ui}\n</Product>`);
    xml = xml.replace(
      /(<Publish Dialog="InstallScopeDlg" Control="Next" Event="NewDialog" Value=")VerifyReadyDlg/g,
      "$1InstallDirDlg",
    );
    xml = xml.replace(
      /(<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value=")VerifyReadyDlg/g,
      "$1GetANNYShortcutDlg",
    );
    xml = xml.replace(
      /(<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value=")InstallScopeDlg/g,
      "$1GetANNYShortcutDlg",
    );
  }
  await fs.writeFile(filename, xml);
};
