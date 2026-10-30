# 0.2.0のDOM確認記録

0.2.1実装での利用：既存の左aside内に①〜④の操作領域を追加し、公式カラムの判定は変更していません。ロゴのブラウザバックには0.2.1設計書第7.2節で確認した `header[data-header-state="navbar"]` 内のホームリンクと `svg[role="img"][aria-label="note"]` の組み合わせを使用します。判定は通常クリックの経路上でだけ行い、本文内・通常のホームリンク・拡張追加UIは除外します。2026-10-26に利用者から左メニューのちらつき解消とFirefoxでの動作確認報告があります。以下のDOM調査自体は、全機能・全ブラウザの実機検証を意味しません。

確認日：2026-10-24。確認用のインアプリブラウザ、未ログイン、幅1280px。ページ表示とread-only DOM参照で確認。記事本文やプロフィールデータの複製・フィード取得は実装していません。

## 検索画面（2026-10-25追記）

検索対象タブの実DOMは `a[data-id="NavigationItem"]` で、「記事」のhrefは `/search?context=note&q=...`。同じulにマガジン（context=magazine）・クリエイター（user）・メンバーシップ（circle）へのリンクがあります。「記事」にはsortが付かず、戻ると人気順になるため、通常モードでは他contextから「記事」への通常クリック時のみ、検索語が一致することを確認しmode=search・sort=newを付けて遷移します。documentのキャプチャ段階でクリックを処理するため、後挿入のリンクにも対応します。hrefの書き換えはせず、公式SPAハンドラを止めて検索URLへ通常遷移します。実拡張での切り替え確認は未実施です。

未ログインの `https://note.com/search` と `https://note.com/search?q=きのころ&context=note&mode=search` で、`aside` が `sticky` と `w-[11.375rem]` を持ち、その内側に `nav[aria-label="急上昇"]` があることをread-only DOM参照で確認しました。タグ・フォロー中と同じ境界を使って共通メニューへ差し替えます。記事・マガジン・クリエイター・メンバーシップの検索タブ、検索フォームと結果はasideの外側にあり、変更しません。検索語をタグとして登録するボタンは表示しません。検索クエリの収集・保存は追加しません。

通常モードかつ拡張ON時だけ適用し、OFF・重度モードでは公式表示へ戻します。対象DOMがない場合や左メニューが非表示の場合は差し替えません。拡張を読み込んだ実機での検索操作確認は未実施です。

## タグ画面

`https://note.com/tag/ComfyUI` の左サイドバーに以下を確認しました。

```html
<div class="hidden lg:contents" data-testid="tag-category-menu">
  <!-- 狭い画面向けのカテゴリナビゲーション -->
  <aside class="sticky top-3 hidden h-full max-h-screen w-[11.375rem] overflow-y-auto pr-4 lg:block">
    <div><!-- 左メニュー全体。nav[aria-label="急上昇"]を含む --></div>
  </aside>
</div>
```

実装は `aside` の幅用クラス・sticky・急上昇ナビ・実表示幅を組み合わせて識別します。既存のasideを維持し、その直下へ独立したnavを追加できた場合だけ、元の直下要素に専用の非表示属性を付けます。本文main・右側の関連キーワードaside・上部のカテゴリナビは変更しません。

`/hashtag/ComfyUI` は前回の公開ページ確認では `/tag/ComfyUI` への転送を確認済み。生成リンクは `/tag/` を使い、URL判定は両方を扱います。今回の拡張を読み込んだ状態での転送・SPA動作は未確認です。

### タグ画面の関連商品枠（2026-10-25追加）

利用者のスクリーンショットと実DOM提示により、`section.mb-6` の中に `h2.sr-only`（関連商品）と、`data-aicn-thing-card="true"` / `data-testid="aicn-thing-card"` の商品カードがある構造を確認。拡張ON・通常モードのタグ画面でだけ、その直近section全体を専用属性で非表示にします。カードだけを隠して外側の余白を残す方式は使いません。

記事を含むsection・複数のh2を含むsection・見出しが異なる枠には適用しません。左サイドバーの挿入ができない幅でも独立して適用します。OFF・重度モード・対象外ページへの移動では属性を外し、元へ戻します。広告通信のブロック機能は追加していません。

## フォロー中

`https://note.com/following` は未ログイン環境では通常ホームへ転送されました。そのホームでも同じ幅・sticky・急上昇ナビを持つasideを確認しましたが、ログイン後のフォロー中画面を検証したことにはなりません。

実装は `/following` 上で上記の確認済み構造が存在する場合だけ共通処理を適用します。対象構造がなければ公式画面を維持します。**ログイン後の左メニューと記事操作は手動確認が必要です。**

## クリエイターページ

`https://note.com/ruminar` と `https://note.com/kakipon` の双方で確認しました。

```html
<div class="... lg:grid lg:grid-cols-[24rem_minmax(auto,var(--size-content))] ...">
  <aside class="w-full lg:w-96">
    <div class="px-4 py-2 lg:px-0 lg:py-0">
      <!-- [data-name="avatar"], h1, /<ユーザー>/followings へのリンク -->
    </div>
    <!-- その他のプロフィール左カラム -->
  </aside>
</div>
```

asideの幅用クラス・h1・avatar・対象ユーザーのフォロー一覧リンクを同時に確認し、表示されているプロフィール情報のaside先頭へ独立した帰還リンクを追加します。元のプロフィール要素は隠しません。対象DOMがない別レイアウトや、領域自体が非表示の場合は省略します。

2026-10-25追記：従来は1024px以上だけに限定していましたが、利用者から幅によってリンクが消えるとの報告を受け、この制限を撤廃しました。同じプロフィール情報領域が縦並びになる幅でも先頭へ表示します。「フォロー中のTL」は設定ボタンに合わせた枠・角丸・中央寄せ・全幅のリンクに変更しました。狭い幅では公式プロフィールの内側余白に合わせます。

kakiponの実タブリンクで `/all`、`/magazines`、`/likes`、`/archives` を確認しました。URLが対応するだけでは適用せず、各画面で同じプロフィールDOMが実在することも条件にします。下層画面の全パターン・マガジンが多いログイン済み自己ページ・モバイル表示の受け入れ確認は未実施です。

2026-10-25追記：`/ruminar/followings` と `/ruminar/followers` の両画面で、同じ `aside.w-full.lg:w-96`、h1、avatar、本人のフォロー／フォロワーリンクがあるプロフィール領域を実ブラウザで確認しました。両URLを対象へ追加し、既存と同じ位置・枠付きの「フォロー中のTL」を表示します。ページ番号のクエリでも対象とし、公式のユーザー一覧とページ送りは変更しません。ユーザー一覧の独自取得・保存は追加しません。

## 記事下の「あなたへのおすすめ」

2026-10-25、同じ記事の上部作者欄では、本文外の `time` に近い祖先div内に、プロフィールへのリンク内の `[data-name="avatar"]` と、同じプロフィールURLへ遷移する作者名のaがあることを確認しました。公開記事URLのユーザー名から作ったプロフィールURLと両リンクのURLが一致する場合のみ、名前とアイコンをTL固定リンクの下（上120px・左12px・幅200px）に表示します。探索はtimeから4階層までに限定し、本文内のtimeや、本文を含む広い祖先は使いません。名前はtextContentで設定し、画像は既存のhttps://assets.st-note.comのsrcだけを利用します。未知の画像URLは省き、作者を識別できない場合はTLリンクだけを残します。HTMLの複製・日時のコピー・DOM要素の移動は行いません。実ブラウザでの固定表示・別記事へのSPA移動は未確認です。

記事の固定帰還リンクは、ここで確認済みの `article#note-article` を基準にする。本文のDOM内には挿入せず、body直下へ追加する。幅1100px以上・表示中の記事左端228px以上の場合に限り、左12px・上72px・幅200pxで固定する。位置は利用者のスクリーンショットの指定箇所を基にしたもの。スクロール・実際のウインドウ幅変更・ログイン状態別の重なり確認は実機未確認。

2026-10-25、未ログインの `https://note.com/ruminar/n/n36b92cdcd987` を確認しました。記事本文は `article#note-article` とその内側の `#note-body` にあり、おすすめ枠はその外側、コメント領域の後にある独立したdivです。

```html
<div class="pt-6 px-4 md:px-0">
  <div class="flex items-center justify-between">
    <h2 class="font-bold text-text-primary text-base">あなたへのおすすめ</h2>
  </div>
  <aside class="py-4" aria-label="記事" aria-busy="false"></aside>
</div>
```

`pt-6` を持つdivの要素の子が2つ（h2のみを含むdivと `aside[aria-label="記事"]`）で、h2の文言が完全一致し、article・#note-bodyの内側でない場合だけ対象にします。おすすめ取得前の空asideでも同じ境界です。専用属性とCSSで枠ごと隠し、設定解除・全体OFF・対象外画面・停止時には属性を外します。通常・重度の両モードで使います。DOMの変化で条件が外れた場合は表示へ戻します。通信の遮断や記事本文の収集はしません。

ログイン後・有料記事・別形式の記事と、拡張を読み込んで設定を切り替える実機確認は未実施です。

## 自動検証と実機確認の区別

自動テストは上記境界を再現した代替DOMで、重複防止・公式メニュー復帰・モード切り替え・非対象ページを検証します。ブラウザ拡張を実際に読み込んだ後のSPA再描画・通信ルール・ブラウザ別動作の検証は別途必要です。

ホーム用には実ソースと拡張APIの代替実装を使うローカルブラウザ確認を試みましたが、確認用ブラウザからこのPCのローカルサーバーに接続できませんでした。ブラウザによるホームの描画・レイアウト確認は未実施です。

## 0.2.1 有料記事カード（利用者提供HTML）

利用者提供の¥300の記事カードを基に、grid-rows-subgrid枠と、その直下のカードにあるタイトル・aria-label付きabsolute/inset-0の記事リンク、h3、text-text-successの価格spanを確認。価格は「¥」の子spanと金額テキストからなり、textContent全体で判定する。異なるDOMは隠さない。購入済み一覧はURLで除外し、購入状態そのものは判定しない。実ブラウザでの非表示・余白・追加読み込みは別途確認が必要。

非表示記事の空き枠対策：提供HTMLはカード外にcontents→mb-0/w-full/min-w-0/border-b-0/pb-0→無クラスdivの3段がある。単一子の既知ラッパーを含む一覧アイテム単位で隠し、後続のカードが詰まるようにする。外枠の属性も解除・購入済み画面への遷移時に復元する。

## 0.2.1 ヘッダー検索クリア（2026-10-25）

未ログインのnote.com/searchでread-only DOM参照により確認。header[data-header-state="navbar"]内のform[role="search"][action="/search"]に、data-name="Field"→ラッパー→data-name="TextFieldBase"→input[type="search"][name="q"]があり、入力のaria-labelは「キーワードやクリエイターで検索」。本文側にはtype=textの別検索欄があるため対象外。ヘッダーの検索フォーム末尾にtype=buttonを追加し、独自属性のあるフォームだけ横並びにする。実拡張での消去後の公式再検索・ログイン後・狭い幅での表示確認は別途必要。

## 0.2.1 トピック配下（2026-10-25）

note.com/topic/education_learningでread-only DOM参照により、asideにsticky・w-[11.375rem]があり、内側にnav[aria-label="急上昇"]があることを確認（表示幅182px）。既存の共通左メニューの境界をそのまま使用する。/topicと/topic/自体は対象外。トピックから許可する背景操作はグループ選択だけで、タグ追加は許可しない。実拡張での表示確認は別途必要。

## 0.2.1 ロゴのブラウザバック（2026-10-26）

確認ダイアログは廃止。公式ヘッダーロゴの識別境界を維持し、設定ONの通常クリックでNavigation APIを使い、同一オリジンへ戻れる場合だけ戻る。公式ロゴの右隣に歯車の設定入口を追加する。ロゴ親divがロゴ1個だけを含む場合に横並びにする。TL上の設定ボタンは廃止し、記事の固定位置はTL72px/作者120pxを維持する。外部直前履歴・履歴なし・API未対応・失敗はフラグメントなしの専用ホームへ移動する。実ブラウザでのクリック順序・履歴・配置は別途確認が必要。

## 0.2.1 SSR親ルートの先行制御

利用者のJavaScript停止HTMLでは、3点のpy-4はmin-h-screen/lg:grid/lg:grid-cols-[202px_minmax(0,1fr)]の直下で、mainの兄弟。asideは別のhiddenなS:0内にあり、B:0位置への反映処理を伴う。したがってaside内のローダーだけを指定した以前の試験はこの初期ローダーに一致しない。今回は既存グリッド親へhikikomori-note-navigation-rootを付け、直下py-4とaside>div>div.flex.flex-col.gap-4をCSSで先行非表示にする。記事領域は非表示にしない。実機での効果は未確認。

## 0.2.1 類似レイアウトへの展開

未ログインで/hashtagは通常ホームへ、/hashtag/ComfyUIは/tag/ComfyUIへ転送された。タグの実DOMはmin-h-screen/lg:grid/lg:grid-cols-[12.625rem_minmax(0,1fr)]という親を使い、その下のdiv.hidden.lg:contentsを経て共通asideがある。aside自体は既存のsticky/w-[11.375rem]と急上昇navを維持。親認識へrem表記を追加し、CSSにラッパーを挟む経路を追加した。既存のpx表記・aside直下型も維持する。初回の先行制御は利用者より成功報告あり。今回追加した実レイアウトのちらつきの実拡張確認は別途必要。

検索画面の追加確認：未ログインの/searchでは親は202px表記、左ラッパーはhidden lg:block。タグ画面のlg:contents用ルールだけでは公式メニューを抑止できないため、hiddenとlg:blockを両方持つ直接子ラッパーの経路を追加。mainはその兄弟であり、非表示対象に含めない。

## 0.2.2 プレビュー記事（2026-10-26）

利用者提供の共有プレビューを読み取り専用で確認。通常記事と同じarticle#note-article、本文#note-body、timeを含む作者欄があり、data-name="avatar"を囲むプロフィールリンクと名前のリンクが同じ公開プロフィールを指す。URLには作者名がないため、本文外のこの組み合わせから判定する。共有URL・アクセスキー・本文は記録しない。

## 2026-10-28 記事おすすめの構造変更

利用者指定の公開記事で確認。おすすめの見出しはpt-6 px-4 md:px-0のdiv内、一覧はaside.p-8[aria-busy="false"]でaria-label="記事"はない。記事親divの直下にborder-t・print:hiddenの領域があり、そのdivide-y.divide-border-default内におすすめdivがある。親からの子孫CSSセレクタでおすすめ1枠だけが一致し、記事本文とコメントsectionは対象外であることを読み取り専用のDOM検査で確認。拡張適用後の実表示確認とは区別する。

## 0.2.3 作者表示のDOM境界（2026-10-31）

指定の公開記事2件を未ログインで確認。article#note-article内・#note-body外のdiv#note-paywall.note-paywallは後挿入される。先頭sectionの「ここから先は」と、内側section.flex.flex-col.rounded-lg.border.border-border-strong.px-4を照合する。単品は「記事」＋円価格＋button[data-name="Button"][type="button"]「購入手続きへ」。会員限定は同じ枠の本人/membershipリンク＋「参加手続きへ」。単品価格0でも会員限定の場合があり、価格だけでは判定しない。本文・チップ・生成IDは使わない。実装した検出の全ケースの実機確認とは区別する。

/yekuのプロフィールを幅390pxで確認。h1から5段程度の祖先にavatarと本人の/followingsリンクが同居し、その領域は幅343pxで表示される。プロフィール用操作欄はこの本人領域へ追加する。既存のTLメニューとは別管理とし、重度・全体OFFでも手動変更を残す。見つからない構造では挿入しない。

## 0.2.3 固定作者情報のフォローボタン

記事の左側に固定表示される公式の作者情報では、未フォロー状態の「フォロー」ボタンだけを非表示にする。記事上部の「フォローする」リンクとアバターのホバーカード内のフォローボタンは維持する。確認済みfixed/top-24/left-8の親を持つside-creator-profileに専用属性を付け、直下divのToggleButton（type=button、aria-pressed=false、aria-haspopup=dialog）を子孫CSSで隠す。後挿入のボタンにも適用する。通常／重度・記事／プレビューで有効。拡張OFF・対象外・DOM撤去・停止で属性を外し、公式DOMやフォロー状態そのものは変更しない。
根拠は利用者提供の固定作者情報HTMLと画像。ホバーのポップアップや記事上部の作者欄には専用属性を付けない。実ブラウザでの非表示効果は別途確認する。

## 0.2.3 自分の記事一覧の運営案内

利用者提供の/notesのHTMLを参照。外側flex flex-col gap-4の直下に、hidden md:blockの画像バナーと、flex flex-col gap-4の提案グループがある。バナーはflex-nowrap/overflow-x-auto/md:flex-wrapの中のrelative flex w-60 min-w-60 items-stretch md:w-full。imgのaltとnote.comへのabsolute inset-0リンクのaria-label/titleを確認する。提案はスマホ用border-border-default border-b bg-background-primary md:hidden内のdetails/summaryと、PC用section.hidden.rounded-lg.bg-surface-normal.p-6.md:blockに分かれ、「あなたへの提案」見出しとhttps://note.com/monetization-guideへのリンクがある。

おすすめ非表示ONの/notesだけで親にdata-hikikomori-note-notes-promotionsを付け、確認済み子孫をCSSで非表示。画像はカレンダー等にも入れ替わるため、画像ファイル名・広告文言を固定しない。提供HTMLに基づく確認であり、確認用ブラウザでは未ログインのため実表示は未検証。
