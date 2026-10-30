$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($file in @('src/common.js', 'src/platform/browser-api.js', 'src/content.js', 'src/note-ui.js', 'src/routing.js', 'src/background.js', 'src/home.js')) {
        & node --check $file
        if ($LASTEXITCODE -ne 0) { throw "構文検証失敗: $file" }
    }
    & node --check scripts/package.mjs
    if ($LASTEXITCODE -ne 0) { throw '配布生成スクリプトの構文検証失敗' }
    # dist内のソース提出検証用コピーまで再帰探索しない。
    & node --test tests/extension.test.cjs tests/package.test.cjs tests/v0.2.test.cjs tests/author-display.test.cjs
    if ($LASTEXITCODE -ne 0) { throw 'テスト失敗' }
} finally {
    Pop-Location
}
