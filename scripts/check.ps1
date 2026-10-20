$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($file in @('src/common.js', 'src/platform/browser-api.js', 'src/content.js', 'src/routing.js', 'src/background.js', 'src/home.js')) {
        & node --check $file
        if ($LASTEXITCODE -ne 0) { throw "構文検証失敗: $file" }
    }
    & node --check scripts/package.mjs
    if ($LASTEXITCODE -ne 0) { throw '配布生成スクリプトの構文検証失敗' }
    & node --test
    if ($LASTEXITCODE -ne 0) { throw 'テスト失敗' }
} finally {
    Pop-Location
}
