$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($file in @('src/common.js', 'src/platform/browser-api.js', 'src/content.js')) {
        & node --check $file
        if ($LASTEXITCODE -ne 0) { throw "構文検証失敗: $file" }
    }
    & node --test tests/extension.test.cjs
    if ($LASTEXITCODE -ne 0) { throw 'テスト失敗' }
} finally {
    Pop-Location
}
