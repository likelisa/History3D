param([string]$DataDir = '', [int]$Port = 5210)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
# Node's fetch does not inherit Windows Internet Settings. Reuse the configured
# system proxy for this child process; do not change the user's network settings.
if (-not $env:HTTPS_PROXY) {
    $agentProxySettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($agentProxySettings.ProxyEnable -eq 1 -and $agentProxySettings.ProxyServer) {
        $agentProxyByScheme = @{}
        foreach ($agentProxyPart in ($agentProxySettings.ProxyServer -split ';')) {
            if ($agentProxyPart -match '^(https?)=(.+)$') { $agentProxyByScheme[$Matches[1]] = $Matches[2] }
            elseif ($agentProxyPart -notmatch '=') { $agentProxyByScheme['http'] = $agentProxyPart; $agentProxyByScheme['https'] = $agentProxyPart }
        }
        foreach ($agentProxyScheme in @('http', 'https')) {
            $agentProxyTarget = $agentProxyByScheme[$agentProxyScheme]
            if ($agentProxyTarget) {
                if ($agentProxyTarget -notmatch '^https?://') { $agentProxyTarget = 'http://' + $agentProxyTarget }
                $agentProxyUri = [Uri]$agentProxyTarget
                if ($agentProxyUri.Scheme -notin @('http', 'https') -or $agentProxyUri.UserInfo) { throw 'Unsupported system proxy; configure HTTP_PROXY/HTTPS_PROXY explicitly.' }
                if ($agentProxyScheme -eq 'https') { $env:HTTPS_PROXY = $agentProxyUri.AbsoluteUri } else { $env:HTTP_PROXY = $agentProxyUri.AbsoluteUri }
            }
        }
    }
}
$env:NODE_USE_ENV_PROXY = '1'
$env:NO_PROXY = (@($env:NO_PROXY, '127.0.0.1', 'localhost', '::1') | Where-Object { $_ }) -join ','
if ($DataDir) { & node --use-env-proxy --import tsx scripts/serve-heritage-validation.mts $DataDir $Port }
else { & node --use-env-proxy --import tsx agent/server.ts }
exit $LASTEXITCODE
