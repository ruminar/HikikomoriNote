param(
    [ValidateSet('all', 'chromium', 'firefox')]
    [string]$Browser = 'all'
)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & (Join-Path $PSScriptRoot 'check.ps1')
    $targets = if ($Browser -eq 'all') { @('chromium', 'firefox') } else { @($Browser) }
    foreach ($target in $targets) {
        $output = & node scripts/package.mjs $target
        if ($LASTEXITCODE -ne 0) { throw "生成失敗: $target" }
        $zip = "$output.zip"
        Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -Force
        Write-Output "読込用フォルダ: $output"
        Write-Output "ZIP: $zip"
    }
} finally {
    Pop-Location
}
