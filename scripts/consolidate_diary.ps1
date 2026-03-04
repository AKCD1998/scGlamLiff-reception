[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message =="
}

function Resolve-ArchiveDestination {
  param(
    [Parameter(Mandatory = $true)][string]$LegacyDir,
    [Parameter(Mandatory = $true)][string]$LegacyFileName,
    [Parameter(Mandatory = $true)][string]$RunStamp
  )

  $baseTarget = Join-Path $LegacyDir $LegacyFileName
  if (-not (Test-Path -LiteralPath $baseTarget)) {
    return $baseTarget
  }

  $nameOnly = [System.IO.Path]::GetFileNameWithoutExtension($LegacyFileName)
  $ext = [System.IO.Path]::GetExtension($LegacyFileName)
  $candidate = Join-Path $LegacyDir ("{0}__{1}{2}" -f $nameOnly, $RunStamp, $ext)
  $counter = 2

  while (Test-Path -LiteralPath $candidate) {
    $candidate = Join-Path $LegacyDir ("{0}__{1}-{2}{3}" -f $nameOnly, $RunStamp, $counter, $ext)
    $counter++
  }

  return $candidate
}

try {
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $legacyDir = Join-Path $repoRoot 'legacy markdown'
  $tempPath = Join-Path $repoRoot 'diary.md.NEW'
  $canonicalPath = Join-Path $repoRoot 'diary.md'
  $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

  $orderedSources = @(
    [PSCustomObject]@{ Name = 'PROJECT_DIARY.md'; LegacyName = 'legacy-PROJECT_DIARY.md' },
    [PSCustomObject]@{ Name = 'MIGRATION.md'; LegacyName = 'legacy-MIGRATION.md' },
    [PSCustomObject]@{ Name = 'diary.md'; LegacyName = 'legacy-diary.md' },
    [PSCustomObject]@{ Name = 'BLUNDER.md'; LegacyName = 'legacy-BLUNDER.md' }
  )

  if (Test-Path -LiteralPath $canonicalPath) {
    $existingDiary = [System.IO.File]::ReadAllText($canonicalPath)
    if ($existingDiary.Contains('<!-- ===== BEGIN legacy:')) {
      Write-Step 'Idempotency guard'
      Write-Host 'STOP: root diary.md appears already consolidated (marker found: <!-- ===== BEGIN legacy:).'
      Write-Host 'No changes were made.'
      exit 0
    }
  }

  Write-Step 'Step 1 - Preflight checks'
  $missing = @()
  $sourceRecords = @()

  foreach ($item in $orderedSources) {
    $path = Join-Path $repoRoot $item.Name
    if (-not (Test-Path -LiteralPath $path)) {
      $missing += $item.Name
      continue
    }

    $fi = Get-Item -LiteralPath $path
    $sourceRecords += [PSCustomObject]@{
      Name = $item.Name
      FullPath = $fi.FullName
      Length = $fi.Length
      LastWriteTime = $fi.LastWriteTime
      LegacyName = $item.LegacyName
    }
  }

  if ($missing.Count -gt 0) {
    throw ("Missing required file(s): {0}" -f ($missing -join ', '))
  }

  $sourceRecords |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize |
    Out-String |
    Write-Host

  if (Test-Path -LiteralPath $legacyDir) {
    Write-Host "[legacy markdown exists]"
    $legacyItems = @(Get-ChildItem -LiteralPath $legacyDir -Force)
    if ($legacyItems.Count -eq 0) {
      Write-Host "(empty)"
    } else {
      $legacyItems |
        Select-Object Mode, LastWriteTime, Length, Name |
        Format-Table -AutoSize |
        Out-String |
        Write-Host
    }
  } else {
    Write-Host "[legacy markdown missing]"
  }

  $diaryText = [System.IO.File]::ReadAllText($canonicalPath)
  if ($diaryText.Contains('<!-- ===== BEGIN legacy:')) {
    throw 'STOP: root diary.md appears already consolidated (marker found: <!-- ===== BEGIN legacy:).'
  }

  Write-Step 'Step 2 - Ensure archive folder'
  if ($DryRun) {
    if (Test-Path -LiteralPath $legacyDir) {
      Write-Host "[DryRun] legacy folder already exists: $legacyDir"
    } else {
      Write-Host "[DryRun] would create folder: $legacyDir"
    }
  } else {
    if (-not (Test-Path -LiteralPath $legacyDir)) {
      New-Item -ItemType Directory -Path $legacyDir | Out-Null
      Write-Host "Created folder: $legacyDir"
    } else {
      Write-Host "Folder already exists: $legacyDir"
    }
  }

  Write-Step 'Step 3 - Build consolidated content in memory'
  $sections = New-Object System.Collections.Generic.List[string]
  $sourceBodies = @{}

  foreach ($record in $sourceRecords) {
    $raw = [System.IO.File]::ReadAllText($record.FullPath)
    $sourceBodies[$record.Name] = $raw

    $capturedAt = (Get-Date).ToString('o')
    $begin = @(
      "<!-- ===== BEGIN legacy: $($record.Name) ===== -->",
      "<!-- source_path: $($record.FullPath) -->",
      "<!-- captured_at: $capturedAt -->"
    ) -join "`r`n"
    $end = "<!-- ===== END legacy: $($record.Name) ===== -->"

    $sectionBody = $raw
    if (-not $sectionBody.EndsWith("`n")) {
      $sectionBody += "`r`n"
    }

    $section = $begin + "`r`n" + $sectionBody + $end
    $sections.Add($section) | Out-Null
  }

  $consolidated = [string]::Join("`r`n`r`n", $sections)
  if (-not $consolidated.EndsWith("`n")) {
    $consolidated += "`r`n"
  }

  Write-Host "Merge order:"
  Write-Host "A) PROJECT_DIARY.md"
  Write-Host "B) MIGRATION.md"
  Write-Host "C) diary.md"
  Write-Host "D) BLUNDER.md"

  Write-Step 'Step 4 - Write temp and verify'
  if ($DryRun) {
    Write-Host "[DryRun] would write: $tempPath"
    $tempText = $consolidated
  } else {
    [System.IO.File]::WriteAllText($tempPath, $consolidated)
    Write-Host "Wrote temp file: $tempPath"
    $tempText = [System.IO.File]::ReadAllText($tempPath)
  }

  $beginCount = [regex]::Matches($tempText, '<!-- ===== BEGIN legacy: ').Count
  $endCount = [regex]::Matches($tempText, '<!-- ===== END legacy: ').Count

  if ($beginCount -ne 4 -or $endCount -ne 4) {
    throw ("Separator count mismatch. BEGIN={0}, END={1}, expected 4 each." -f $beginCount, $endCount)
  }

  foreach ($record in $sourceRecords) {
    $raw = $sourceBodies[$record.Name]
    if (-not $tempText.Contains($raw)) {
      throw ("Containment check failed for source text: {0}" -f $record.Name)
    }
  }

  if ([string]::IsNullOrWhiteSpace($tempText)) {
    throw 'Consolidated temp content is empty.'
  }

  Write-Host "Verification passed: separators + containment + non-empty."

  Write-Step 'Step 5 - Archive originals (move + rename)'
  $movePlan = @()

  foreach ($record in $sourceRecords) {
    $destination = Resolve-ArchiveDestination -LegacyDir $legacyDir -LegacyFileName $record.LegacyName -RunStamp $runStamp
    $movePlan += [PSCustomObject]@{
      Source = $record.FullPath
      Destination = $destination
    }
  }

  foreach ($move in $movePlan) {
    $sourceName = [System.IO.Path]::GetFileName($move.Source)
    $destName = [System.IO.Path]::GetFileName($move.Destination)
    if ($DryRun) {
      Write-Host ("[DryRun] would move {0} -> {1}" -f $sourceName, $destName)
    } else {
      Move-Item -LiteralPath $move.Source -Destination $move.Destination
      Write-Host ("Moved {0} -> {1}" -f $sourceName, $destName)
    }
  }

  Write-Step 'Step 6 - Promote temp to canonical'
  if ($DryRun) {
    Write-Host ("[DryRun] would move {0} -> {1}" -f $tempPath, $canonicalPath)
  } else {
    Move-Item -LiteralPath $tempPath -Destination $canonicalPath
    Write-Host 'Promoted diary.md.NEW -> diary.md'
  }

  Write-Step 'Step 6 verification'
  if ($DryRun) {
    Write-Host '[DryRun] verification preview only (filesystem unchanged).'
  } else {
    $trackedNames = @('PROJECT_DIARY.md', 'MIGRATION.md', 'diary.md', 'BLUNDER.md')
    $rootTracked = @(Get-ChildItem -LiteralPath $repoRoot -File | Where-Object { $trackedNames -contains $_.Name })
    if ($rootTracked.Count -ne 1 -or $rootTracked[0].Name -ne 'diary.md') {
      $names = ($rootTracked | Select-Object -ExpandProperty Name) -join ', '
      throw ("Root verification failed. Expected only diary.md among tracked files, found: {0}" -f $names)
    }

    $legacyRequiredBases = @(
      'legacy-PROJECT_DIARY',
      'legacy-MIGRATION',
      'legacy-diary',
      'legacy-BLUNDER'
    )
    $legacyNames = @(Get-ChildItem -LiteralPath $legacyDir -File | Select-Object -ExpandProperty Name)

    foreach ($base in $legacyRequiredBases) {
      $exists = $false
      foreach ($ln in $legacyNames) {
        if ($ln -like "$base*.md") {
          $exists = $true
          break
        }
      }
      if (-not $exists) {
        throw ("Legacy verification failed. Missing archived file for base pattern: {0}*.md" -f $base)
      }
    }

    if (Test-Path -LiteralPath $tempPath) {
      throw 'Verification failed. diary.md.NEW still exists after promotion.'
    }

    Write-Host 'Verification passed: root tracked files + legacy archives + no .NEW leftover.'
  }

  Write-Step 'Done'
  if ($DryRun) {
    Write-Host 'Dry run completed successfully (no filesystem changes were made by this script).'
  } else {
    Write-Host 'Consolidation completed successfully.'
  }

  exit 0
} catch {
  Write-Host ""
  Write-Error $_
  exit 1
}
