# Dot-source this file from an extension installer. It never starts or installs the application.
function Get-AlwithUInstallRecords {
    param([ValidateSet('CurrentUser', 'LocalMachine')][string]$Hive)
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Automatic ALwith U discovery requires Windows.'
    }
    $views = @([Microsoft.Win32.RegistryView]::Registry32)
    if ([Environment]::Is64BitOperatingSystem) {
        $views = @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)
    }
    foreach ($view in $views) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]$Hive, $view)
        $key = $null
        try {
            $key = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\ALwith U')
            if ($null -eq $key) { continue }
            [PSCustomObject]@{
                DisplayName = $key.GetValue('DisplayName')
                Publisher = $key.GetValue('Publisher')
                MainBinaryName = $key.GetValue('MainBinaryName')
                InstallLocation = $key.GetValue('InstallLocation')
            }
        } finally {
            if ($null -ne $key) { $key.Dispose() }
            $base.Dispose()
        }
    }
}

function Get-AlwithUAbsolutePath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $path = $Value.Trim().Trim('"')
    if (-not [IO.Path]::IsPathRooted($path)) { return $null }
    # Reject drive-relative paths (C:app) and current-drive roots (\app).
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and
        $path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|$))') { return $null }
    return [IO.Path]::GetFullPath($path)
}

function Resolve-AlwithUBinary {
    if (-not [string]::IsNullOrEmpty($env:ALWITH_U_BIN)) {
        $explicit = Get-AlwithUAbsolutePath $env:ALWITH_U_BIN
        if (-not $explicit -or [IO.Path]::GetFileName($explicit) -ine 'alwith-u.exe' -or
            -not (Test-Path -LiteralPath $explicit -PathType Leaf -ErrorAction Stop)) {
            throw 'ALWITH_U_BIN must be an existing absolute path to alwith-u.exe.'
        }
        return $explicit
    }
    foreach ($hive in @('CurrentUser', 'LocalMachine')) {
        $candidates = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($record in @(Get-AlwithUInstallRecords -Hive $hive)) {
            if ($record.DisplayName -cne 'ALwith U' -or $record.Publisher -cne 'alwith.ai') { continue }
            if ($record.MainBinaryName -and $record.MainBinaryName -ine 'alwith-u.exe') { continue }
            $directory = Get-AlwithUAbsolutePath $record.InstallLocation
            if (-not $directory) { continue }
            $executable = Join-Path $directory 'alwith-u.exe'
            if (Test-Path -LiteralPath $executable -PathType Leaf -ErrorAction Stop) {
                [void]$candidates.Add($executable)
            }
        }
        if ($candidates.Count -gt 1) {
            throw "Multiple ALwith U installations found in $hive. Set ALWITH_U_BIN explicitly: $($candidates -join ', ')"
        }
        if ($candidates.Count -eq 1) { return ($candidates | Select-Object -First 1) }
    }
    throw 'ALwith U was not found. Install it first, or set ALWITH_U_BIN to the executable for a portable/development build.'
}
