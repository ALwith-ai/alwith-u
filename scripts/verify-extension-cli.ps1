# Exercise the release GUI-subsystem executable through redirected script IO.
param([Parameter(Mandatory = $true)][string]$Binary)
$ErrorActionPreference = 'Stop'
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path

function Invoke-CliProbe {
    param([string[]]$Arguments, [int]$ExpectedExitCode)
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $binaryPath
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'CLI probe did not start' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw 'CLI probe exceeded its deadline'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne $ExpectedExitCode) {
            throw "Expected exit $ExpectedExitCode, got $($process.ExitCode): $output $errorOutput"
        }
        return @{ Output = $output; ErrorOutput = $errorOutput }
    } finally {
        $process.Dispose()
    }
}

$help = Invoke-CliProbe -Arguments @('extension', '--help') -ExpectedExitCode 0
if ($help.Output -notmatch 'extension install' -or $help.Output -notmatch 'extension uninstall' -or $help.ErrorOutput) {
    throw 'CLI help was not written cleanly to stdout'
}
$invalidId = Invoke-CliProbe -Arguments @('extension', 'uninstall', '--id', '../escape') -ExpectedExitCode 2
if ($invalidId.Output -or $invalidId.ErrorOutput -notmatch 'Invalid extension ID') {
    throw 'Invalid arguments must report diagnostics on stderr'
}
$missing = Join-Path ([System.IO.Path]::GetTempPath()) "alwith-cli-missing-$([Guid]::NewGuid())\Unicode 测试 path"
$invalidPath = Invoke-CliProbe -Arguments @('extension', 'install', '--path', $missing, '--json') -ExpectedExitCode 2
$result = $invalidPath.Output | ConvertFrom-Json
if ($result.error.code -ne 'invalidPath' -or $result.exitCode -ne 2 -or $result.installed -ne $false -or $invalidPath.ErrorOutput) {
    throw 'Invalid paths must return structured JSON without starting the GUI'
}
Write-Host 'Extension CLI redirected IO and exit-code probes passed.'
