# Explicit owner request: publish immutable existing 2.3.0 Windows bytes without
# waiting for the remaining long-running browser workflow. This verifies source,
# artifact identity, file hashes, upload hashes and release state. It does not
# convert skipped/failed runtime checks into a pass.
$ErrorActionPreference = 'Stop'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$source = $env:BUILD_SHA
$runId = $env:BUILD_RUN
if ($version -cne '2.3.0' -or $source -cne '0cc4045f011231d8e626eac1a4c5acd4926ac482' -or $runId -cne '41525789468') {
  throw 'Unexpected version, source commit or existing build run.'
}

# The publication commit may change only tests, diagnostics, release notes and
# publication plumbing. Nothing used to build the shipped app may differ.
git diff --exit-code $source HEAD -- src assets bin package.json package-lock.json LICENSE electron-builder.yml index.html vite.config.js docs/THIRD_PARTY.md scripts/build-extension.js scripts/download-tools.js scripts/prepare-tools.js scripts/tools-manifest.json scripts/verify-package.js scripts/verify-installed-resources.js scripts/windows/NativeHost.cs scripts/windows/build-native-host.ps1 scripts/windows/customize-msi.js scripts/windows/installer.nsh
if ($LASTEXITCODE -ne 0) { throw 'Shipped application inputs differ from the immutable build source.' }

$build = (Resolve-Path owner-build).Path
$evidence = (Resolve-Path owner-evidence).Path
$out = Join-Path $env:RUNNER_TEMP 'GetANNY-2.3.0-release-assets'
$stageRoot = Join-Path $env:RUNNER_TEMP 'GetANNY-2.3.0-bundle'
$folder = "GetANNY-v$version-Windows"
$stage = Join-Path $stageRoot $folder
Remove-Item $out,$stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $out,$stage -ItemType Directory -Force | Out-Null

# Validate every file against the checksum manifest embedded in the preserved
# Actions artifact before selecting any public release asset.
$records = [ordered]@{}
foreach ($line in Get-Content (Join-Path $build 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([a-f0-9]{64})  ([^\\/]+)$') { throw "Invalid build checksum entry: $line" }
  $digest = $Matches[1]; $name = $Matches[2]
  if ($records.Contains($name)) { throw "Duplicate build checksum entry: $name" }
  $file = Join-Path $build $name
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Build artifact missing checksummed file: $name" }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) { throw "Build artifact hash mismatch: $name" }
  $records[$name] = $digest
}
$required = @(
  'GetANNY Setup.exe','GetANNY Setup.msi','GetANNY Portable.exe',
  'GetANNY-helium-2.3.0.zip','GetANNY-chrome-2.3.0.zip','GetANNY-chromium-2.3.0.zip','GetANNY-brave-2.3.0.zip',
  'GetANNY-firefox-2.3.0.zip','GetANNY-vivaldi-2.3.0.zip','GetANNY-opera-2.3.0.zip','GetANNY-edge-2.3.0.zip'
)
foreach ($name in $required) {
  if (-not $records.Contains($name)) { throw "Required existing release asset is absent from build checksums: $name" }
}

# Check executable/container signatures without loading either large file fully.
$exeStream = [IO.File]::OpenRead((Join-Path $build 'GetANNY Setup.exe'))
$msiStream = [IO.File]::OpenRead((Join-Path $build 'GetANNY Setup.msi'))
try {
  $exeHeader = [byte[]]::new(2); $msiHeader = [byte[]]::new(8)
  if ($exeStream.Read($exeHeader,0,2) -ne 2 -or [Text.Encoding]::ASCII.GetString($exeHeader) -cne 'MZ') { throw 'EXE header missing.' }
  if ($msiStream.Read($msiHeader,0,8) -ne 8 -or [BitConverter]::ToString($msiHeader).Replace('-','').ToLowerInvariant() -cne 'd0cf11e0a1b11ae1') { throw 'MSI compound-file header missing.' }
} finally {
  $exeStream.Dispose(); $msiStream.Dispose()
}

$renames = [ordered]@{
  'GetANNY Setup.exe' = "GetANNY-$version-Setup.exe"
  'GetANNY Setup.msi' = "GetANNY-$version-Setup.msi"
  'GetANNY Portable.exe' = "GetANNY-$version-Portable.exe"
}
foreach ($pair in $renames.GetEnumerator()) { Copy-Item -LiteralPath (Join-Path $build $pair.Key) -Destination (Join-Path $out $pair.Value) }
Get-ChildItem -LiteralPath $build -File -Filter 'GetANNY-*-2.3.0.zip' | Copy-Item -Destination $out
Copy-Item docs/INSTALL_WINDOWS.md,docs/BROWSERS.md,docs/RELEASE_NOTES.md,docs/RELEASE_STATUS.md,docs/TESTING.md,LICENSE -Destination $out
Get-Content (Join-Path $build 'SHA256SUMS.txt') | Set-Content -Encoding utf8 (Join-Path $out 'BUILD_SHA256SUMS.txt')
Set-Content -Encoding ascii (Join-Path $out 'SOURCE_COMMIT.txt') "$source`n"

$run = gh api "repos/$env:REPO/actions/runs/$runId" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $run.head_sha -cne $source) { throw 'Cannot revalidate source workflow status.' }
$jobs = gh api "repos/$env:REPO/actions/runs/$runId/jobs" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot capture workflow job status.' }
$status = [ordered]@{
  source = $source
  buildRun = $run.html_url
  status = $run.status
  conclusion = $run.conclusion
  publicationRequestedWithoutPassingLongChecks = $true
  recordedAt = (Get-Date -Format o)
  jobs = @($jobs.jobs | ForEach-Object { [ordered]@{id=$_.id;name=$_.name;status=$_.status;conclusion=$_.conclusion;steps=$_.steps} })
}
$status | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $out 'WINDOWS_VERIFICATION_STATUS.json')

$measured = @(
  '# GetANNY 2.3.0 verification status at publication',
  '',
  '**Published at the repository owner''s explicit request without waiting for a fully passing Windows/browser workflow. Manual Windows testing is required.**',
  '',
  "- Immutable build source: $source (merged main).",
  "- Existing Windows build run: $($run.html_url)",
  "- Workflow status at publication: $($run.status) / $($run.conclusion); this is not represented as a pass.",
  '- Packaging, source tests, compiled native launcher, renderer and extension package creation completed before the artifact was retained.',
  '- A later measured run completed EXE and MSI install/reinstall/uninstall and retained user data, but the available-browser matrix remained non-green.',
  '- Remaining/current long GitHub installation and browser checks were intentionally not awaited for this publication.',
  '- The retained artifact does not include `latest.yml` or the NSIS block map, so this publication supports manual downloads rather than the in-app auto-update feed.',
  '- Skipped/incomplete certification includes interactive browser approval on a consumer PC, permanent signed Firefox installation, store delivery, old-v1 upgrade, and signed Windows binaries.',
  '- Installers are unsigned; Windows may display SmartScreen or publisher warnings.',
  '- Browser ZIPs require ordinary browser approval/developer-mode or store installation as documented.',
  '',
  'Raw evidence from the identified Windows run is attached as `Windows-test-evidence.zip`. Inspect it for actual failures; attachment is not certification.'
) -join "`n"
Set-Content -Encoding utf8 (Join-Path $out 'MEASURED_RESULTS.md') $measured

$provenance = [ordered]@{
  version = $version
  source = $source
  sourceBranch = 'main'
  publicationCommit = $env:GITHUB_SHA
  buildRun = [long]$runId
  buildArtifactId = [long]$env:BUILD_ARTIFACT_ID
  buildArtifactDigest = $env:BUILD_ARTIFACT_DIGEST
  evidenceArtifactId = [long]$env:EVIDENCE_ARTIFACT_ID
  verificationAtPublication = [ordered]@{status=$run.status;conclusion=$run.conclusion}
  existingBuildReused = $true
  rebuiltApplication = $false
  ownerRequestedSkippedLongChecks = $true
  originalBuildChecksums = $records
}
$provenance | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out 'PROVENANCE.json')
Compress-Archive -Path (Join-Path $evidence '*') -DestinationPath (Join-Path $out 'Windows-test-evidence.zip') -CompressionLevel Optimal

# Assemble a convenience bundle from the same individually verified bytes.
foreach ($sub in @('Installers','Portable','Browser-Extensions','Documentation')) { New-Item (Join-Path $stage $sub) -ItemType Directory -Force | Out-Null }
Copy-Item (Join-Path $out "GetANNY-$version-Setup.exe"),(Join-Path $out "GetANNY-$version-Setup.msi") -Destination (Join-Path $stage 'Installers')
Copy-Item (Join-Path $out "GetANNY-$version-Portable.exe") -Destination (Join-Path $stage 'Portable')
Get-ChildItem $out -File -Filter 'GetANNY-*-2.3.0.zip' | Copy-Item -Destination (Join-Path $stage 'Browser-Extensions')
Copy-Item (Join-Path $out 'INSTALL_WINDOWS.md'),(Join-Path $out 'BROWSERS.md'),(Join-Path $out 'RELEASE_NOTES.md'),(Join-Path $out 'RELEASE_STATUS.md'),(Join-Path $out 'TESTING.md'),(Join-Path $out 'MEASURED_RESULTS.md'),(Join-Path $out 'PROVENANCE.json'),(Join-Path $out 'BUILD_SHA256SUMS.txt'),(Join-Path $out 'LICENSE') -Destination (Join-Path $stage 'Documentation')
Set-Content -Encoding ascii (Join-Path $stage 'VERSION.txt') "$version`n"
Compress-Archive -Path $stage -DestinationPath (Join-Path $out "GetANNY-$version-Windows-Bundle.zip") -CompressionLevel Optimal

# Generate final checksums after every public file except the checksum manifest exists.
$checksumLines = @(Get-ChildItem $out -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.Name
})
$checksumLines | Set-Content -Encoding ascii (Join-Path $out 'SHA256SUMS.txt')

# Create a private draft, upload all assets, verify GitHub's recorded digests,
# and only then make the release public. Any failure leaves a draft, never a
# partially presented official release.
gh release view $tag --repo $env:REPO *> $null
if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists; refusing to replace or mutate it." }
$notesFile = Join-Path $env:RUNNER_TEMP 'GetANNY-2.3.0-release-notes.md'
@(
  $measured,
  '',
  (Get-Content docs/RELEASE_NOTES.md -Raw),
  '',
  '## SHA-256',
  '```text',
  ($checksumLines -join "`n"),
  '```'
) -join "`n" | Set-Content -Encoding utf8 $notesFile
gh release create $tag --repo $env:REPO --draft --target $source --title "GetANNY $version - Windows release" --notes-file $notesFile
if ($LASTEXITCODE -ne 0) { throw 'GitHub draft creation failed.' }
$labeled = @(Get-ChildItem $out -File | ForEach-Object { "$($_.FullName)#$($_.Name)" })
gh release upload $tag --repo $env:REPO @labeled
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed; release remains a draft.' }
$releaseData = gh api "repos/$env:REPO/releases?per_page=100" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect uploaded draft; release remains private.' }
$match = @($releaseData | Where-Object { $_.tag_name -ceq $tag })
if ($match.Count -ne 1 -or -not $match[0].draft -or $match[0].prerelease -or $match[0].target_commitish -cne $source) { throw 'Draft release identity/state mismatch.' }
$releaseFile = Join-Path $env:RUNNER_TEMP 'GetANNY-2.3.0-draft.json'
$match[0] | ConvertTo-Json -Depth 30 | Set-Content -Encoding utf8 $releaseFile
node scripts/verify-release-assets.js $releaseFile $out $tag $source
if ($LASTEXITCODE -ne 0) { throw 'Uploaded asset digest verification failed; release remains a draft.' }
gh release edit $tag --repo $env:REPO --draft=false --prerelease=false --latest --notes-file $notesFile
if ($LASTEXITCODE -ne 0) { throw 'Draft promotion failed; inspect the private draft.' }
$published = gh release view $tag --repo $env:REPO --json isDraft,isPrerelease,tagName,url,targetCommitish | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $published.isDraft -or $published.isPrerelease -or $published.tagName -cne $tag -or $published.targetCommitish -cne $source) { throw 'Published release state did not match the owner request.' }
$ref = gh api "repos/$env:REPO/git/ref/tags/$tag" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $ref.object.sha -cne $source) { throw 'Published tag does not point to the immutable build source.' }
Write-Host "Official owner-requested release published: $($published.url)"
