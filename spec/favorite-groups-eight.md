# お気に入り8グループ仕様

2026-11-16。実装・テストのみ。アプリのバージョン・タグ・公開・Git commit/pushは変更しない。おしゃべりnoteは変更しない。

## モードと共通処理

modeはnormal（ひとみしりモード（通常））、normal-double（ひとみしりモード（2段））、social、severe。旧normalと初期値は変えない。normalとnormal-doubleはusesTagsで共通処理し、availableGroupsが前者でgroup1〜4、後者でgroup1〜8を返す。social/severeでは操作可能グループなし。

通常・2段とも既存の5種の登録、編集、削除、並べ替え、移動を共用。登録フォーム・専用ホーム・メニュー・移動先を操作可能グループに絞る。バックグラウンドでも操作元と移動先を最新モードで検証する。旧画面に残った⑤〜⑧の操作は拒否する。記事の重複確認は非表示グループを含む全グループで維持。

左サイドバーは既存幅のまま4列、2段モードのみ2行。ハンバーガー内は8列1行。画面幅だけでなく親コンポーネントをCSS条件に用いる。狭幅は間隔と横paddingを縮め、文字の丸数字は維持。320px幅でもスクロールせず収め、タップ領域は最低32px幅・44px高（8個を320px内に収めるため幅44pxは要求しない）。専用ホームは既存の管理UIを共用。

## 保存形式と移行

保存キーはhikikomoriNote.settings.v2、グループは{id,name,tags}を維持。新しいキーを作らずgroup1〜group8をID順に保持する。8グループの保存はtagSchemaVersion=7。旧保存2〜6は4グループとして読み、2段モードを保存すると不足する後半4グループを空name/tagsで補う。移行はIDによる補完なので繰り返しても重複せず、読み取りだけでは書き込みを行わない。新規の初期モード・旧4グループ形式は従来どおり。

8グループの保存から通常・social・severeに変更しても8グループを残す。⑤〜⑧選択中にnormalへ変更するとgroup1へ戻し、選択更新番号を進める。破損・未知の保存形式は従来どおり編集停止し、通常設定の保存で壊れた元データを上書きしない。

## 製品間で共通にするJSON

外部JSONは既存のtagGroups配列、各グループの{id,name,items}を維持する。8グループはschemaVersion=9。4グループは既存の7（記事なし）／8（記事あり）を維持する。保存側tagsと外部itemsの既存変換を共用し、5種の項目形式は変更しない。8グループ形式は表示モードと独立し、normalへ戻しても8個すべてを書き出す。

```json
{
  "format": "hikikomori-note-settings",
  "schemaVersion": 9,
  "settings": {
    "mode": "normal-double",
    "tagGroups": [
      {"id":"group1","name":"","items":[{"type":"tag","tag":"Sample"}]},
      {"id":"group2","name":"","items":[]},
      {"id":"group3","name":"","items":[]},
      {"id":"group4","name":"","items":[]},
      {"id":"group5","name":"後半","items":[]},
      {"id":"group6","name":"","items":[]},
      {"id":"group7","name":"","items":[]},
      {"id":"group8","name":"","items":[]}
    ],
    "selectedTagGroupId":"group5"
  }
}
```

modeはひきこもりnote固有のUI設定であり、共通グループ構造の判定に利用しない。おしゃべりnote側はtagGroupsのID・name・items、selectedTagGroupIdを独立に取り込み、normal-doubleを自製品でサポートしなければ無視してよい。旧読込器は⑤〜⑧を無視する可能性があるので、完全な往復には相手側の8グループ対応が必要。

読み込みでは形式名・版省略／未知を理由に拒否しない既存仕様を維持。group5〜8があれば表示モードに関係なく保存領域を補い、対応項目のみ部分更新する。省略グループと無効項目は現在値を維持、items:[]は明示的クリア。旧JSONの4グループを既存8グループ設定へ読む場合、⑤〜⑧は維持する。最終モードがnormalなら選択group5〜8はgroup1へ補正し、読み込み結果に理由を出す。

共通データの契約：IDはgroup1〜group8固定で、書き出しはID順。nameは空文字可・40文字以内。itemsは配列で、既存のtag/user/magazine/membership/articleの5種を維持。読み込みはIDで対応付けるため入力順に依存せず、重複IDは先頭を採用する。itemsとtagsが混在した旧形式ではitemsを優先し、無視理由を表示する。部分JSONでも読めるため上記サンプルで他の設定値を省略しているが、実際の書き出しには既存の表示設定・テーマ・作者管理なども含める。

共通項目の例：

```json
[
  {"type":"tag","tag":"Sample"},
  {"type":"user","userId":"sample_author","displayName":"Sample Author"},
  {"type":"magazine","userId":"sample_author","magazineId":"m123","displayName":"Sample Magazine"},
  {"type":"membership","userId":"sample_author","displayName":"Sample Membership"},
  {"type":"article","articleId":"n123","url":"https://note.com/sample_author/n/n123","title":"Sample Article"}
]
```

記事IDによる全グループ横断の重複防止、既存の項目検証・URL正規化・JSONサイズ上限を維持する。製品固有modeと保存用tagSchemaVersionは共通itemsの判別条件にしない。

## 検証

既存テストに加え、4→8の反復移行・5種の後半グループ操作・非表示グループの拒否・モード変更と古い画面の競合・JSON往復／部分読み込み・旧JSONによる後半保持・破損保護・左4列／メニュー8列の識別を確認する。PC／スマートフォンの実機操作とタップ表示は利用者の最終確認事項とする。

実施記録：構文・自動テスト467件成功（従来459件＋今回8件）。管理画面・通知反映・登録先切替・モード変更後の選択と後半保持も合成DOMで検証。確認用ブラウザからローカルHTTPサーバへ接続できなかったため、実ブラウザのピクセル配置と実機タップは未確認。アプリのバージョンは変更せず、コミット・Push・タグ・公開は行わない。
