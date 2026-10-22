# Run with U open. This probes public endpoints without login tokens or chat data.
# Optional: -AppDirectory 'C:\path\to\ALwith U'
param([string]$AppDirectory)
$ErrorActionPreference = 'Stop'

$candidates = @()
if ($AppDirectory) { $candidates += $AppDirectory }
Get-Process -Name 'alwith-u' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path) { $candidates += Split-Path -Parent $_.Path }
}
foreach ($root in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($root) {
        $candidates += Join-Path $root 'ALwith U'
        $candidates += Join-Path $root 'Programs\ALwith U'
    }
}
$bunPath = $null
foreach ($directory in ($candidates | Select-Object -Unique)) {
    $candidate = Join-Path $directory 'bun.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $bunPath = $candidate; break }
}
if (-not $bunPath) { throw 'Bundled bun.exe was not found. Open U, or rerun with -AppDirectory pointing to its installation folder.' }

$environmentNames = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENAI_BASE_URL', 'CODEX_HOME')
$configured = @($environmentNames | Where-Object { [Environment]::GetEnvironmentVariable($_) })
$internet = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$appExecutable = Join-Path (Split-Path -Parent $bunPath) 'alwith-u.exe'
$appVersion = if (Test-Path -LiteralPath $appExecutable) { (Get-Item -LiteralPath $appExecutable).VersionInfo.ProductVersion } else { 'unknown' }
$metadata = [ordered]@{
    date = [DateTime]::UtcNow.ToString('o')
    os = [Environment]::OSVersion.VersionString
    appVersion = $appVersion
    windowsArchitecture = $env:PROCESSOR_ARCHITECTURE
    configuredEnvironmentNames = $configured
    windowsProxyEnabled = ($internet.ProxyEnable -eq 1)
    windowsPacConfigured = [bool]$internet.AutoConfigURL
    note = 'No credentials are sent. HTTP 401/403/404/405 still demonstrate that DNS, TCP and TLS reached an HTTP server. This terminal environment may differ from the running U process.'
}

$probe = @'
import { lookup } from "node:dns/promises";
import { request } from "node:https";

const endpoints = ["https://chatgpt.com/backend-api/codex/responses", "https://api.openai.com/v1/responses"];
const code = error => typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : "UNKNOWN";
async function dns(host) {
  let timer;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject({ code: "DIAGNOSTIC_TIMEOUT" }), 12000); })
    ]);
    return { host, families: addresses.map(value => value.family), count: addresses.length };
  } catch (error) { return { host, error: code(error) }; }
  finally { clearTimeout(timer); }
}
function direct(url, family) {
  return new Promise(resolve => {
    const result = { transport: "node:https (adapter transport, direct)", host: new URL(url).hostname, family: family || "default", tcpConnected: false, tlsConnected: false };
    const started = Date.now();
    let done = false;
    let timer;
    const finish = extra => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...result, ...extra, elapsedMs: Date.now() - started });
    };
    const req = request(url, { method: "POST", family, headers: { "content-type": "application/json" } }, res => {
      finish({ status: res.statusCode });
      res.destroy();
      req.destroy();
    });
    req.on("socket", socket => {
      socket.once("connect", () => { result.tcpConnected = true; });
      socket.once("secureConnect", () => { result.tlsConnected = true; });
    });
    req.once("error", error => finish({ error: code(error) }));
    timer = setTimeout(() => { finish({ error: "DIAGNOSTIC_TIMEOUT" }); req.destroy(); }, 12000);
    req.end("{}");
  });
}
async function nativeFetch(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12000) });
    const status = res.status;
    await res.body?.cancel();
    return { transport: "Bun.fetch (inherited environment)", host: new URL(url).hostname, status, elapsedMs: Date.now() - started };
  } catch (error) { return { transport: "Bun.fetch (inherited environment)", host: new URL(url).hostname, error: code(error), elapsedMs: Date.now() - started }; }
}
const [dnsResults, requests] = await Promise.all([
  Promise.all(endpoints.map(url => dns(new URL(url).hostname))),
  Promise.all(endpoints.flatMap(url => [direct(url, 0), direct(url, 4), direct(url, 6), nativeFetch(url)]))
]);
console.log(JSON.stringify({ bun: Bun.version, platform: process.platform, arch: process.arch, dns: dnsResults, requests }, null, 2));
'@

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('alwith-network-' + [Guid]::NewGuid().ToString('N') + '.mjs')
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) ('alwith-network-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
    [IO.File]::WriteAllText($temporary, $probe, $utf8)
    $header = $metadata | ConvertTo-Json -Depth 5
    Write-Host 'Probing with U bundled Bun and Windows curl (up to 45 seconds)...'
    $output = @(& $bunPath --no-install $temporary 2>&1)
    $probeExit = $LASTEXITCODE
    $lines = @($header, "Bundled Bun probe exit code: $probeExit") + $output
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path -LiteralPath $curl) {
        foreach ($url in @('https://chatgpt.com/backend-api/codex/responses', 'https://api.openai.com/v1/responses')) {
            $lines += "Windows curl direct: $url"
            # Windows curl provides an independent TLS-stack comparison.
            $curlOutput = & $curl --noproxy '*' --connect-timeout 5 --max-time 12 --output NUL --silent --write-out 'HTTP status: %{http_code}' $url
            $curlExit = $LASTEXITCODE
            $lines += $curlOutput
            $lines += "curl exit code: $curlExit"
        }
    }
    [IO.File]::WriteAllLines($report, [string[]]$lines, $utf8)
    $lines | ForEach-Object { Write-Output $_ }
    Write-Host "Diagnostic report: $report"
} finally {
    Remove-Item -LiteralPath $temporary -ErrorAction SilentlyContinue
}
