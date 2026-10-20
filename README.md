# ひきこもりnote v0.1.0

**枠を超えたら落選したので、殻を作りました。**

創作大賞に落選して傷ついた創作者が、安心してnoteを利用するためのブラウザ拡張です。

noteのホームを、自分の記事への導線とユーザー設定だけの画面にする非公式ブラウザ拡張です。note株式会社とは関係ありません。

## ローカル導入

Visual Studio、npmは不要です。Edge/Chromeはこのフォルダをそのまま読み込めます。Firefoxは後述のFirefox用フォルダを使用してください。

1. Edgeで `edge://extensions/`、Chromeで `chrome://extensions/` を開きます。
2. 「開発者モード」を有効にします。
3. 「展開して読み込み」または「パッケージ化されていない拡張機能を読み込む」を選びます。
4. **manifest.jsonのあるHikikomoriNoteフォルダ**を指定します。
5. ブラウザ右上の拡張機能メニューから「ひきこもりnote」を押し、専用ホームを開きます。「設定と転送状態を確認しました。」と表示されれば準備完了です。
6. noteユーザー名（例：`ruminar`）または公開プロフィールURLを入力して保存します。
7. <https://note.com/> やプロフィール左上のnoteロゴからも専用ホームへ移動できます。

ソースを変更した後は、拡張機能の管理画面で拡張を再読み込みし、noteのタブも再読み込みしてください。旧版からの更新では、転送用の権限が追加されます。ブラウザに権限の確認が出た場合は内容を確認して有効にしてください。ユーザー名・ON/OFFの保存形式は以前の版と共通です。

## Firefox版（デスクトップ140以降）

Firefox向けのManifest V3版を追加しています。機能はEdge/Chrome版と同じです。Firefox実機での動作確認はまだです。

1. Firefox版ZIPを解凍するか、下の生成コマンドで `dist/HikikomoriNote-0.1.0-firefox/` を作成します。
2. Firefoxで `about:debugging#/runtime/this-firefox` を開きます。
3. 「一時的なアドオンを読み込む」から、**Firefox用フォルダ内の** `manifest.json` を選びます。リポジトリ直下のManifestはChromium用です。
4. 拡張アイコンから専用ホームを開き、状態確認後、ユーザー名を保存して使用します。noteへのサイトアクセス権限が必要な場合は許可します。

未署名の一時アドオンはFirefox終了時に外れます。一般利用者に継続利用してもらう配布にはMozillaの署名が必要です。ストアに掲載しない自己配布（unlisted）の署名も選べます。今回は署名・申請を行っていません。[Mozillaの署名と配布](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

詳しい手順：[Firefox版](docs/install-firefox.md)、[Edge/Chrome版](docs/install-chromium.md)。noteに導入手順を書く際にも利用できます。

## 配布用フォルダ・ZIPの生成

開発者側のみNode.js 22以降とPowerShellを使用します。利用者側には不要です。

```powershell
./scripts/package.ps1
# Firefox版だけの場合
./scripts/package.ps1 -Browser firefox
```

検証後、`dist/HikikomoriNote-0.1.0-chromium/` と `dist/HikikomoriNote-0.1.0-firefox/` および各フォルダ名のZIPを作成します。ZIP直下に `manifest.json` が入り、必要な実行ファイル・アイコン・ライセンス・各ブラウザ向けの `INSTALL.md` だけを含みます。再実行すると同名の生成フォルダとZIPを置き換えます。FirefoxのZIPは未署名の試用用であり、署名済みXPIではありません。

## v0.1.0でできること

- ON時は `https://note.com/` への通常のページ移動を、通信前のブラウザルールで拡張内の `home.html` へ転送します。クエリ文字列・ハッシュ付きも対象です。アドレスバーは拡張専用URLになります。
- 登録したユーザーの公開プロフィールから、自分の記事を開けます。
- ユーザー名とON/OFFをブラウザ内の拡張専用ストレージに保存します。
- 「通常のnoteを表示（OFF）」は転送ルールの解除と保存が成功してから通常ホームを開きます。
- OFFからの再開はブラウザの拡張アイコンを押すだけです。ONの保存と転送適用を完了してから専用ホームを開きます。画面下部に別のONボタンはありません。
- プロフィール・記事・編集・ログイン・購入・設定など、ホーム以外のURLは転送しません。

**記事一覧の自動取得は未対応です。** noteの実DOMが未確認のため、仕様F-02のフォールバックとして公開プロフィールへのリンクを提供します。投稿・下書き管理はOFFにして公式ホームから操作してください。タグ登録・タグ収集・キャッシュ・AI・スキ操作はこの版に含めません。

## 権限とデータ

権限は `storage`、`declarativeNetRequestWithHostAccess`、ホスト権限 `https://note.com/*` です。保存・転送に使用し、Cookie・認証情報・記事本文を収集しません。背景処理（ChromiumのService Worker／FirefoxのEvent Page）が設定と動的転送ルールをまとめて更新します。ルールはインストール済み拡張のブラウザ再起動後も残り、起動時に保存値と整合させます。Firefoxの一時アドオンは終了時に外れるため、この対象外です。初回導入時は上記の準備完了を確認してから使用してください。

note上では `document_start` のコンテンツスクリプトがホームへの通常クリックを捕捉し、サイト側のSPA処理より先に専用ホームへ移動します。キャンセル可能なNavigationイベントも扱い、履歴等でホームに到着した場合は専用ホームへ移動する補助処理を使います。noteのDOMを隠す旧方式は廃止しました。

ON時はホームURLそのものへの事前取得など、文書以外のリクエストも遮断します。記事・プロフィールや `/api/` など別URLの通信は対象外です。note側のスクリプトやService Workerによる別URLの先読み、導入前・ルール適用前に始まった通信まで止めるものではありません。「noteへの通信がすべてゼロ」という保証ではありません。OFF時はホームへのアクセスを通常どおり許可します。

設定・転送処理の失敗時は専用ホームにエラーを出し、OFFが成功しないまま通常URLを開くことはしません。「状態を再確認」で再試行できます。復旧できない場合は拡張を無効化してnoteを再読み込みしてください。ユーザー設定はブラウザ間で同期しません。

## 構成・検証

- `manifest.json`：Chrome/Edge向けManifest V3。
- `manifests/firefox.json`：Firefox向けの背景処理・拡張ID・最低版・データ収集なしの宣言を上書きする生成用定義。
- `src/common.js`：URL判定、ユーザー名検証、設定の正規化。
- `src/platform/browser-api.js`：ブラウザ拡張APIのアダプター。
- `home.html` / `src/home.js` / `src/home.css`：拡張内の専用ホームと設定。
- `src/content.js`：note上のホーム導線とSPA遷移の処理。
- `src/routing.js` / `src/background.js`：転送ルールと設定の単一書込制御。
- [仕様書](spec/hikikomori-note_SPEC.md) / [手動確認表](docs/manual-test.md)。

実行用ファイルはそのまま配置済みです。開発時の構文確認・ユニットテストにはNode.js 22以降を使用します（利用者の導入には不要）。

```powershell
./scripts/check.ps1
```

または `node --test`。自動テスト28件が成功しています。テストのDOM・APIは代替実装であり、note実サイトの描画・SPA・通信転送の実動作を保証しません。2026-10-20に作者からChrome/Edgeの基本機能が動作したとの報告がありました。今回のアイコンによるON復帰、通信の詳細や再起動などの確認項目は別途確認が必要です。Firefox実機の受け入れ確認は未実施です。

実装時に参照した公式資料：[コンテンツスクリプト](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[通信前の転送ルール](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)、[拡張ページの公開範囲](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)。利用・公開前には[noteの最新規約](https://note.com/terms)と実際の挙動を再確認してください。ストア公開や規約適合性の確認完了を示すものではありません。

ライセンス：MIT（[LICENSE](LICENSE)）。
