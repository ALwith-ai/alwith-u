$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../resolve-alwith-u.ps1')

# Replace only registry IO. Resolution, validation and filesystem checks remain real.
$script:records = @()
function Get-AlwithUInstallRecords { param([string]$Hive) $script:records | Where-Object { $_.Hive -eq $Hive } }
function Assert-Equal { param($Actual, $Expected) if ($Actual -ne $Expected) { throw "Expected '$Expected', got '$Actual'" } }
function Assert-Throws {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw "Expected failure matching '$Pattern'"
}
$temporary = Join-Path ([IO.Path]::GetTempPath()) "alwith-discovery-$([Guid]::NewGuid())"
$oldOverride = $env:ALWITH_U_BIN
try {
    $env:ALWITH_U_BIN = $null
    $custom = Join-Path $temporary 'Custom Apps 测试'
    $machine = Join-Path $temporary 'Machine Install'
    [IO.Directory]::CreateDirectory($custom) | Out-Null
    [IO.Directory]::CreateDirectory($machine) | Out-Null
    $customExe = Join-Path $custom 'alwith-u.exe'
    $machineExe = Join-Path $machine 'alwith-u.exe'
    [IO.File]::WriteAllText($customExe, '')
    [IO.File]::WriteAllText($machineExe, '')
    $userRecord = @{ Hive = 'CurrentUser'; DisplayName = 'ALwith U'; Publisher = 'alwith.ai'; MainBinaryName = 'alwith-u.exe'; InstallLocation = '"' + $custom + '"' }
    $machineRecord = @{ Hive = 'LocalMachine'; DisplayName = 'ALwith U'; Publisher = 'alwith.ai'; MainBinaryName = 'alwith-u.exe'; InstallLocation = $machine }
    $script:records = @($userRecord, $machineRecord)
    Assert-Equal (Resolve-AlwithUBinary) $customExe
    $script:records = @($userRecord, $userRecord)
    Assert-Equal (Resolve-AlwithUBinary) $customExe
    $script:records = @($machineRecord)
    Assert-Equal (Resolve-AlwithUBinary) $machineExe
    $env:ALWITH_U_BIN = $customExe
    Assert-Equal (Resolve-AlwithUBinary) $customExe
    $env:ALWITH_U_BIN = Join-Path $temporary 'missing.exe'
    Assert-Throws { Resolve-AlwithUBinary } 'ALWITH_U_BIN'
    $env:ALWITH_U_BIN = $null
    $duplicate = $machineRecord.Clone(); $duplicate.Hive = 'CurrentUser'
    $script:records = @($userRecord, $duplicate)
    Assert-Throws { Resolve-AlwithUBinary } 'Multiple'
    $stale = $userRecord.Clone(); $stale.InstallLocation = Join-Path $temporary 'uninstalled'
    $script:records = @($stale, $machineRecord)
    Assert-Equal (Resolve-AlwithUBinary) $machineExe
    foreach ($field in @('DisplayName', 'Publisher', 'MainBinaryName', 'InstallLocation')) {
        $invalid = $userRecord.Clone(); $invalid[$field] = 'invalid'
        $script:records = @($invalid)
        Assert-Throws { Resolve-AlwithUBinary } 'not found'
    }
    $script:records = @()
    Assert-Throws { Resolve-AlwithUBinary } 'not found'
    Write-Host 'Application discovery tests passed.'
} finally {
    $env:ALWITH_U_BIN = $oldOverride
    if ([IO.Directory]::Exists($temporary)) { [IO.Directory]::Delete($temporary, $true) }
}
