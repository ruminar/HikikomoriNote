# 0.2.0のDOM確認記録

## 0.2.9・マガジン一覧の運営案内

利用者提示outerHTMLに基づく。asideのw-full/[grid-area:aside]/md:max-w-[17.5rem]内に、space-y-2/md:space-y-4のDIVがあり、その直属にメンバーシップの案内バナーと「マガジンをもっと活用するには」の案内カードが並ぶ。前者はassets.st-note.comの手動配信画像と公式/lp/membership/startのオーバーレイリンク、後者はh3と公式ヘルプ・運営notemag記事へのリンクで確認する。

対象は/magazines/all・my・follow・editable・readableのみ。おすすめ非表示ONで、2枠だけのasideならasideごと、別枠が混在すれば識別済みの2枠だけを専用属性で隠す。有料記事非表示の単独ONは適用しない。既存DOM通知で後挿入・差し替えを処理し、解除・OFF・離脱・停止で復元する。実サイトをログインして操作した確認とは区別する。

## 0.2.9・メンバーシップ設定の参考事例

利用者提供outerHTMLに基づく。order-2/w-full/flex-none/md:order-3のasideに、flex/flex-col/gap-y-4の外側DIV、その中に同じ縦並びとbg-background-primary/p-4/md:p-6を持つ参考事例ボックスがある。block/md:hiddenとhidden/md:blockの2つのdetailsに「参考事例」のsummary、GET /searchとhidden context=circleの検索フォーム、カテゴリ別候補がそれぞれ存在する。動的IDと具体的な候補名・価格は識別に使わない。

/membership/settingsと/manageだけで、有料記事非表示またはおすすめ非表示ON時に専用属性で外枠ごと非表示にする。asideに別枠が混在すれば参考事例ボックスだけに留める。子候補の後挿入は外枠のCSSで隠し、全体の後挿入・差し替えは既存DOM通知で再判定する。確認用ブラウザではログインが必要なため、実画面のDOM読み取りと実拡張表示確認は未実施。

## 0.2.9・メンバーシップのお気に入り（2026-11-02）

`https://note.com/akb428/membership`を未ログインで開くと`/membership/join`へSPA転送された。h1「AI活用実践ラボ」は`header.w-full`内の`div.min-w-0.flex-1`にあり、その兄弟に作者リンクを含む行がある。リンクは`https://note.com/akb428`、aria-labelは「秋葉原IT戦略研究所さんのクリエイターページ」でimgを含む。390px指定時も同じ構造で、タイトルのホスト幅は343px。ログイン済みホームのDOMは未取得で、利用者提示画像の見出し下配置に同じ識別条件を適用する。

登録UIはこのホストの末尾へ拡張所有の操作枠を追加し、人SVGトグルと初期閉フォームを置く。公式の参加手続き・プラン選択ボタンには触れない。作者IDはURLと公式作者リンクで照合し、h1が本文内・拡張所有要素内・公式グローバルヘッダ内の場合や未知構造では登録UIを出さない。既存フォーム・保存キュー・DOM更新経路を共用し、追加監視やAPI取得は行わない。実拡張での表示確認とは区別する。

## 0.2.9・作者追加UIの固定順序

既存の作者識別が返す公式ホストを共用し、その先頭に拡張所有のprofile-controlsを1つ置く。内部のnavigation・favorites・author領域に各機能を配置し、公式ホストへの独立したprependを廃止する。DOMの探索条件自体は拡張しない。マガジンは従来どおり公式操作列の本トグルと詳細末尾の登録欄を使う。既存の更新経路で親・子領域・ホストの欠落を検出して復元し、ページ離脱・停止で除去する。実サイトの新たなDOM調査・実拡張の表示確認は未実施で、既存DOMの回帰テストに基づく変更。

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


## 0.2.4のモード条件（既存DOMを再利用）

独自共通メニューとSSR親への先行クラスはmode=normalに限る。設定未取得時は公式領域を隠さず、storage読込後に既存の親クラス方式を適用する。social/severeへの変更では親クラス・直下の非表示印・狭幅UIを撤去する。

プロフィールへのTL追加はnormal/socialで有効だが公式情報は隠さない。記事／プレビューの固定作者は全モード、TLはnormal/socialのみ。重度の作者単独ボタンはtop72px、公式固定プロフィールはtop124pxへ移し、両ボタン時は従来のtop184pxとする。未検出・狭幅・OFF時は位置調整も戻す。

socialの公式ロゴは操作を奪わず、確認済みヘッダーに歯車だけ常時追加する。記事・非表示枠・検索・管理画面のDOM識別条件は従来どおり。新たなDOM探索対象や監視は追加しない。0.2.4の実ブラウザ受け入れ確認は未実施。

## 有料マガジンカード（2026-10-31・0.2.5）

利用者指定のマガジン検索を未ログインの確認用ブラウザで参照。価格span.text-text-successは入れ子の円記号を含む。マガジン1件の外側DIVはrelative／mb-[6px]／mr-[6px]／flex／w-[calc(100%-6px)]。直下にabsolute inset-0のtitle・aria-label付き /ユーザー/m/mIDリンクがあり、別の直下DIVにbefore:-z-20／after:-z-10／rounded-lg／border-border-defaultとh3がある。価格は作者avatarと同じisolateの行内、text-text-successのDIV配下にある。

既存の価格走査・変更通知・非表示属性を共用し、外側の1件分を隠して空きを詰める。許可作者は既存のID照合で除外。本文内・外部ドメイン・未知構造・価格なしは対象外。マガジン詳細の取得や課金推測はしない。固定済み0.2.4とは別の開発変更。


## 作者ページの販促枠（2026-10-31・0.2.5）

note.com/nontsuをread-onlyで確認。作者表示管理UIと同じ識別結果（h1、avatar、URLの作者と一致するfollowingsリンクを持つ既知の親）を共有し、main-content内で成立する場合だけ適用する。TL追加用のasideクラス・幅条件は使わない。PCはaside内のmb-8/flex/flex-col/items-stretch/gap-4/empty:mb-0のDIV群、狭幅はmt-4/block/empty:hidden/lg:hidden内のflex/flex-nowrap/overflow-autoカルーセルにあるflex/items-stretch/gap-2のDIV群を対象とする。

Amazonはamazon.co.jpまたはwww.amazon.co.jpのHTTPS商品dpリンク、確認済みSECTIONのクラス・商品画像・h3・タイトル付きオーバーレイを組み合わせて識別。ストアは貼付DOMのborder-border-strong等のクラス・画像・h3・価格を持つ外部商品カードと、同じ作者の/store向けButton「ストアをみる」を識別する。一般のプロフィール文中リンク、ストアタブ、記事、メンバーシップ、ストア直接アクセスは変更しない。リンク先を取得して調べる処理はない。

専用非表示属性で1件分のラッパーを隠す。全子が対象の場合だけグループを隠し、狭幅では既知の外枠の余白も詰める。未知の子が混じるグループは残す。既存のDOM変更通知とdirtyフラグを使用し、監視やタイマーを増やさない。

有料記事非表示ON、拡張ON、自己ID設定済み、他作者で表示許可以外、作者データ正常が条件。自分・許可作者・設定解除・OFF・作者移動・停止で印を外す。実DOM構造は確認済み、自動テスト210件成功。実拡張でのPC／Androidの表示確認は未実施。


## 作者ホームの参加プラン（2026-10-31・0.2.5追加）

完成後のDOMで、section内のh2から同じ作者のmembershipへリンクし、直下のmy-4/flex/flex-col/gap-4にrelativeのプランDIVとborder-border-defaultのhrが交互に入ることを確認。プランDIVはabsolute inset-0の/membership/joinリンク、h3、p.text-text-successの正の月額料金（¥500 / 月等）、data-name=Buttonの参加手続きへ／募集終了を持つ。

作者ホームだけに適用する。対象プランと区切り線だけなら一覧親へ既存の販促非表示属性を付けるため、後挿入も同じ親のdisplay:noneを継承する。無料や未知の子があれば一覧は残し、確認済みカードと対象カード間の区切り線だけを隠す。紹介欄・membership直接表示は維持。新たなDOM監視・取得通信はなし。構文・自動テスト213件成功。実拡張では未確認。

参加プランの適用URLは作者ホームと/作者ID/all（末尾スラッシュ可）。同じDOM判定と非表示条件を共用し、membershipへの直接アクセスは引き続き対象外。

参加プランの適用URLに/作者ID/magazinesも追加。既存の作者識別とプラン判定を共用し、一覧本体の判定条件は変更しない。

参加プランの適用URLに/作者ID/likesも追加。左側プランの識別・非表示だけを共用し、スキ一覧本体の制御は変更しない。

ストア画面（/nontsu/store）をread-onlyで参照し、既存と同じ作者プロフィールを確認。/作者ID/storeを作者ページとして扱い、既存のTL追加・作者表示管理を再利用する。商品の非表示はストア画面全体で明示的に除外。未知の配下URLは対象外。


## 公式ホームのおすすめメンバーシップ（2026-10-31・0.2.5）

利用者貼付DOMで、div.mb-5 > div.px-4.lg:px-0 > div[data-testid=recommended-memberships]の中にh2「おすすめメンバーシップ」・カード群・横送りボタンがあることを確認。カードの月額価格はspan.text-text-success、記事カードとは異なる形。

社会復帰＋有料記事非表示ONの公式ホームでdocumentElementにdata-hikikomori-note-home-paid-hiddenを付ける。CSSは対象本体と:hasによる既知の外側1行を隠し、遅延挿入にも適用。公式カードを個別に取得・再実装しない。許可作者も含め行全体を隠す。未知外枠は隠さず対象本体だけ縮退。OFF・設定解除・モード変更・SPA離脱・停止で属性を除去。

構文と自動テスト218件成功。ローカルブラウザから検証用HTTPサーバーへの接続がタイムアウトしたため、実ブラウザでのCSS表示確認は未完了。実拡張のホーム画面での確認は利用者に依頼する。


## 公式ホームの記事カード（2026-10-31・0.2.5）

未ログインの確認用ブラウザで、note.com/の公式記事オーバーレイリンク60件をread-only調査。リンク親はflex w-full rounded md:rounded-lg bg-surface-normal [grid-row:2] min-w-0等、その親はrelative w-full border-b-0 py-0 sm:border-b-0 sm:py-0。2件の価格付きカード（¥300、¥580）を確認。grid-rows-subgridはない。

この外側カードをホームだけで追加の候補とし、従来のタイトル・h3・価格・鍵・許可作者判定を再利用。横並びの1件分はh-auto shrink-0 w-36 sm:w-48、その親のflex overflow-x-auto overflow-y-hiddenを確認して外枠も隠す。未知の外枠は一括非表示にしない。ホーム以外にSPA遷移したら新構造の印を解除。新規の全体走査や監視を追加せず、既存の価格・鍵走査内で扱う。自動テスト222件成功、実拡張でのホーム表示は未確認。


## 公式ホーム中央の運営バナー（2026-10-31・0.2.5）

利用者提示DOM：div.mb-5 > div.px-4.lg:px-0 > div.relative.mx-auto.max-w-[960px]内に、alt付き幅960画像とnote.comへのオーバーレイリンク。画像srcはassets.st-note.com/poc-image/manual/production/配下。タイトル・画像名はキャンペーンごとに変わるため固定しない。

おすすめ非表示ONのホームだけで、既知の画像・リンク・枠を確認して専用属性を付ける。単一の既知親なら行全体、混在する親ならバナー本体だけを隠す。既存DOM通知とdirtyフラグで後挿入へ追従。本文・一般の投稿画像・外部リンクは対象外。設定解除・OFF・ホーム離脱・停止で復元。提示DOMに基づく自動テスト225件成功、実拡張表示は未確認。


## 固定記事の非表示漏れ（2026-10-31・0.2.5固定後の修正）

note.com/yekuの固定記事「あのクソゲーはこうして生まれた～元・ゲーマー開発者の懺悔～」に¥300を確認。内側はホームと同じflex/w-full/bg-surface-normal/[grid-row:2]/min-w-0を持つが、外側はrelative/w-full/grid/grid-rows-subgrid。ホーム構造に一致したカードをホーム以外で除外する条件が、既存の固定カードにもかかっていた。

grid-rows-subgridの既存カードはその制限から除外し、通常の価格・鍵・許可作者判定を適用する。表示許可は引き続き優先。固定記事の価格・鍵・無料化・後挿入を回帰テストで確認。修正前に2件のテスト失敗を再現し、修正後は全227件成功。固定済み0.2.5のタグと提出ZIPは変更しない。

0.2.5固定後の追加：参加プランの適用URLに/作者ID/archivesも追加。/allと同じ作者識別・プランのDOM条件・許可作者の例外を使用する。TLと作者表示管理、Amazon・ストア枠は既存のプロフィール共通判定を維持。実DOMが未知の場合は推測で隠さない。


## ヘッダのスクロール非表示と常時表示（2026-11-01・開発中）

公式記事 /yeku/n/n3d8afae640a0 を読み取り確認。header[data-header-state="navbar"] は with-navbar-layout_navbarContainer__ で始まるクラスを持ち、記事ではsticky／top:0／z-index:21。下スクロールでcreatorRowOnly系クラスが付き、PCではtransformによって-65px、幅390pxでは-49px移動する。子の検索・ロゴ行は残り、狭幅では公式作者行がabsoluteで出る。ホームのヘッダは同じ名前部分を持つがposition:relative。

keepNoteHeaderVisibleがONなら、公式ロゴも確認したヘッダだけに専用属性を付け、screen CSSでsticky／top:0／transform:noneを適用する。公式の高さ・重なり順・作者行の処理は維持する。既存のDOM監視を共用し、解除時は属性だけ除去する。未知のヘッダ・本文内は対象外。実拡張の表示は利用者確認待ち。

追加調査：/ruminar/n/na68901f3be0bでは下スクロールでdata-header-stateがnavbarからcreator-row-onlyへ変化する。最初の実装はJSとCSS両方でnavbarだけに限定していたため、隠れる瞬間に対象外になっていた。常時表示だけは状態属性を参照せず、安定したヘッダクラスの名前部分・公式ロゴ・本文外の条件で印を維持し、CSSも専用属性だけを参照する。232件の自動テスト成功。

同日の狭幅追加調査：幅390pxのcreator-row-onlyでは、通常ロゴ行はdisplay:flexのまま上へ移動し、直属div.with-navbar-layout_creatorRow__…がtop:48px／position:absolute／display:blockで代わりに見える。親のtransformを止めるだけではこの作者行が通常ヘッダの下へ余分に出る。そのため常時表示中のみ、この確認済みの直属作者行をCSSで非表示にする。歯車・ロゴ・検索クリア・☰は共通の安定したヘッダ識別へ統合し、状態変更で再生成しない。全235件成功。

作者ページ追加調査：/ruminarのヘッダは記事と異なり元のz-indexがauto。スクロールでdiv.visible.fixed.top-0.left-0.z-[11].w-fullが上端へ現れ、作者名とコンテンツナビを表示するため、sticky化だけではヘッダを覆う。常時表示のヘッダを記事と同じz-index:21にし、確認済みの作者バーだけをヘッダ実測高さ分下へ配置する。grid/min-h-[49px]/border-b/bg-background-primary、avatar、nav、現在作者のホーム向けNavigationItemも確認する。専用属性と拡張所有styleだけを追加し、公式inline styleは変更しない。リサイズは既存updateを共用し、解除・OFF・離脱・停止で戻す。237件成功。利用者がFirefoxの記事動作を確認済み、作者ページの再確認は待ち。

仕様変更（2026-11-01）：利用者の指定により、常時表示ON中の作者固定バーは下へずらす方式を廃止し、非表示へ変更。確認済みDOMの識別は維持し、専用属性と既存content.cssだけで制御する。高さの実測・動的style生成は削除。通常のタブは保持し、設定解除・拡張OFF・離脱・停止で属性を外して公式表示へ戻す。

followingの左メニュー追加調査（2026-11-01）：公式asideはsticky/top-3/max-h-screen/w-[11.375rem]/overflow-y-autoで、top:12px、max-height:100vh。PCのヘッダ高65pxの下へ来るよう、常時表示ONでは固定位置をヘッダ実測高さ＋12px（確認時77px）へ変更し、最大高さも画面高からその分を引く。公式・独自メニュー共通のasideへ専用属性を付け、拡張所有styleで高さのCSS変数を設定する。リサイズ・後生成は既存update経路で処理し、変更がない場合はstyleを再生成しない。解除・OFF・離脱・ヘッダ不在・停止で属性とstyleを除去。239件成功、実拡張での再確認待ち。

## 作者ページの有料マガジン（2026-11-01・0.2.7開発中）

/kan11jpと/allで確認。左マガジン欄はdiv.flex.flex-col.gap-4内のdiv.relative、直属のオーバーレイリンク（title・aria-label・作者ID/m/m…）とh3・imgを持つ。価格行はdiv.flex.items-center.gap-1.font-bold.text-text-success.text-xsで、先頭のtext-text-primaryな件数DIV（SVGを含む）と価格のテキストが混在し、全体は「3件¥2,480」。件数の文字列を先頭から除き、残りだけを既存の正額判定へ渡す。ボタンの有無では判定しない。

別の一覧形はul.grid > li.border-border-default.border-b > div.relative.flex.items-start.gap-4.bg-surface-normal.py-4。右側のrelative.z-10.ml-auto内の価格spanを判定し、liごと隠す。無料カードはそのまま。既存のプロフィール販促処理・作者識別・dirtyフラグ・専用属性を共用し、正常な自分ID設定・別作者・有料非表示ON・非許可の条件を維持する。ホーム/all/magazines/likes/archivesが対象で、store・マガジン直接表示は変更しない。未知構造・本文内・別作者のリンクは保持する。

## 作者のお気に入り登録（0.2.7開発中）

/kinokoroでh1の表示名とavatar・followingsリンクを含む祖先（確認時はh1から4段上）が既存の作者識別に合致することを読み取り確認。作者表示管理の識別結果を共用して登録欄を同じホストへ配置し、自分の場合も識別は行うが表示管理UIは従来どおり出さない。登録欄は拡張所有DOMとし、通常モード・拡張ONのときだけ出す。新規の監視・ネットワーク取得は追加しない。登録先は閲覧グループと独立した未選択状態から選ぶ。非同期保存中は送信内容を固定し、ページ移動・DOM差し替え時に古い欄を撤去する。保存先・送信境界とJSON形式5の詳細は0.2.7仕様書を参照。
## マガジンのお気に入り（2026-11-02・0.2.8開発中）

`/kinokoro/m/m95cee8dfaa5e`で公式見出し付近のh1と`flex flex-col gap-4 px-4 md:row-span-2`の詳細コンテナ、その親内の「きのころのクリエイターページへ」リンクを確認。同じページのnavに`data-id=NavigationItem`のマガジン本体・archive・hashtagへのリンクがある。URLだけでなく、このリンクの作者・マガジンIDも照合する。

詳細内の`flex flex-wrap justify-end gap-4`の操作列に、無料では`button[data-name=ToggleButton]`の「フォロー」、有料の`/kan11jp/m/m5b134c353cc3`では`button[data-name=Button]`の「購入手続きへ」がある。PC・狭幅の両列がDOMに存在し、親で表示を切り替えることを390px指定時にも確認。既存の可視判定で表示中の列の左端だけへ拡張所有の本ボタンを置く。公式ボタン自体は移動しない。登録欄は詳細コンテナの末尾へ置き、作者登録と同じフォーム処理を共用する。

名前はh1のtextContentを既存規則で検証する。公式リンク・見出し・操作列が一致しなければ登録UIは出さない。追加監視・記事取得はなく、既存の更新経路で差し替えと幅変更へ追従する。これは公式DOMの読み取り確認であり、実拡張を入れた全ブラウザ・Android実機の受け入れ確認とは区別する。
# 0.3.0追記：スキ数と埋め込み（2026-11-04）

スキ済みカードの利用者提供DOMでは、ハートbuttonはaria-pressed=true、SVGはaria-label=「スキを取り消す」に変化する。数字buttonのaria-labelは「531スキ この記事にスキをつけたユーザーを見る」のまま。両ラベルを操作ハートの判定に含め、数字buttonだけを隠す。

新しいDIVの左カラムでは先行非表示CSSも更新が必要。専用ルートクラスから、直下・hidden lg:block・hidden lg:contentsの既知経路で幅とstickyを持つ左カラムへ限定し、カテゴリナビゲーションを直接含む公式の縦並び枠だけを非表示にする。独自navやmainを隠さないこと、後挿入直後と復元をローカル実ブラウザで27項目検証済み。

同日の/following実DOMでは左カラムがasideからdiv、縦並びナビのaria-labelが急上昇からカテゴリナビゲーションへ変更。sticky・top-3・hidden・h-full・max-h-screen・w-[11.375rem]・overflow-y-auto・pr-4・lg:block、既知のグリッド直下と兄弟main（検索はhidden lg:block、タグはhidden lg:contentsを1段挟む）、縦並びnavの公式/trendリンクを照合して既存の差し替え処理へ渡す。横並びカテゴリナビ、本文、未知構造は除外。狭幅切替とヘッダ固定もDIVへ対応する。実拡張での再確認は利用者が行う。

一覧・記事のスキ操作はaria-pressedを持つbuttonと「Nスキ この記事にスキをつけたユーザーを見る」の独立した数字button。ハートのSVGだけでは判定せず、同じ小さな操作グループ内で役割と数値を照合する。数字buttonだけに専用属性を付ける。

本文の公式noteカードは同一オリジンの`/embed/notes/n...` iframe。確認済みの`p-noteEmbed__suki`は`p-noteEmbed__sukiIcon > i.c-icon--heart`と`p-noteEmbed__sukiLabel`で構成され、記事遷移のoverlayリンクは兄弟にある。操作部品が混在しない数値表示だけを、ハートと一緒に隠す。親のCSSは届かないため、参照可能な公式埋め込み文書に専用スタイルを追加し、OFF・停止・差し替え時に撤去する。詳しくは[0.3.0仕様](../spec/hikikomori-note_SPEC_v0.3.0.md)を参照。

## 0.3.0追記：公式の作者検索

作者ページの三点メニューから「きのころの記事を検索」を実行し、/search?q=from%3A%40kinokoro%20&context=note&mode=search&autofocus=1への遷移を確認。検索欄はfrom:@kinokoro、初期の並び順は人気。検索共通の左カラムとhidden lg:blockラッパーを維持している。作者指定はURLのqの先頭のfrom:@IDを読み、引用符があっても戻り先として識別する。後続の語句はリンク判定に使わない。記事・マガジン以外の検索対象も既知の共通左領域へ追加する。独自メニューのTL直下へ作者ページのリンクを追加できる。記事カードや公式の検索入力・並び順操作は変更しない。

作者検索のアイコン・表示名は検索結果内のa[data-name=avatar]から取得できる。/search?q=from:@kinokoroの実DOMでhref=https://note.com/kinokoro、aria-label=「きのころのプロフィールへのリンク」、子imgのsrc=https://assets.st-note.com/...を確認。同じ作者IDと検証した情報だけを、拡張の作者ページリンクへ表示する。記事日時を含むtextContent全体は表示名として使わない。

## 0.3.0追記：質問箱（2026-11-05）

/qa/nontsuの作者情報はmain外のdiv.mx-auto.w-full.max-w-content-small内。DIV[data-name=avatar]のimg.altは作者名、同じ領域のa[aria-label="note アカウント"]はhttps://note.com/nontsuを指す。本文はmain#main直下のdiv.mx-auto.w-full.max-w-content-small。質問詳細では本文のmax-w-content-small内に、/qa/nontsuを指すリンクの子avatarと、公式プロフィールへのnoteアカウントリンクがある。画像altには「 のアイコン」が付く。

一覧・詳細とも本文の実測左端322.5px、幅620px。390px幅では本文左端16px。公式の質問箱ヘッダは既存のnote記事ヘッダとは異なるため書き換えず、余白がある場合だけ独立した作者ページリンクを固定表示する。実拡張での表示確認は利用者が行う。


### 2026-11-05：マガジン一覧・質問箱のスキ数

- /nontsu/magazines：svg[aria-label="スキの数"][role="img"][data-id="Icon"]と数値SPANがflex/items-center/justify-center/gap-1/text-text-likeのDIVに同居。親はmt-2/flex/items-center/gap-2/text-smの統計行、さらにラッパー1段外はflex/w-full/bg-surface-normal/flex-colの記事カードで公式記事リンクを含む。37件一致。操作可能な祖先・子孫はない。隣接する価格は統計行内の別要素。
- /qa/nontsu：既存のflex/items-center/justify-center内にaria-pressed付き操作ハートと数値ボタン。数値のaria-labelは「2スキ この記事にスキをつけたユーザーを見る}」と末尾に波括弧が1個付く。質問箱URLに限ってこの既知の表記を受け入れる。ハート操作は維持。


### 2026-11-05：閲覧履歴の価格付きカード（利用者提供DOM）

/notes/viewedはrelative/w-full/border-b-0/py-0の外枠に、flex/w-full/bg-surface-normal/[grid-row:2]/min-w-0の内枠とabsolute/inset-0の記事リンク、h3を持つ。価格はtext-text-successのSPANに¥の子SPANと金額のテキストがあり、作者はa[data-name=avatar]で照合可能。ホームと共通のカード認識を閲覧履歴にも適用するが、横スクロール用スロットの非表示はホームだけに維持する。


### 2026-11-05：検索境界の実表示

提供されたNo.52〜60の9件を未ログインで確認。引用付き先頭fromは記事約400件、後続未閉じ引用付きは約100件、マガジン＋創作は約1件。先頭が-from、先頭以外のfrom、追加のfrom付き、引用other_user＋from:kinokoroは0件。クリエイター対象では約10,000件で他の作者が出る。追加確認の引用付き先頭from・circleは0件。userとcircleにも検索共通のカテゴリnavと左カラムがある。戻りリンクは件数や結果の作者から推測せず、先頭のIDだけで決める。詳細はテストURL一覧の観察表。


### 2026-11-05：記事の作者新着検索ボタン

/dreamy_bear8625/n/nfa64d1911cd6で記事上部のtime周辺に既知のavatarとプロフィールリンク、表示名「カピバラさん」があることを確認。article左端322.5px、公式side-creator-profileの親はfixed/top-24/left-8。追加の＠作者検索は既存の作者情報を共用し、作者ページボタンの下へ同じタブの新着検索リンクを作る。公式作者欄は追加ボタンの下へ移す。


### 2026-11-05：note埋め込み内の先行CSS

/ruminar/n/na68901f3be0bの本文内にiframe.note-embedがあり、loading=lazy、src=https://note.com/embed/notes/n7cb755a96b56?theme=auto等を持つ。同URLを開いて.p-noteEmbed.note-embed > .p-noteEmbed__inner > .p-noteEmbed__sukiの直下が.p-noteEmbed__sukiIcon > i.c-icon.c-icon--heartと.p-noteEmbed__sukiLabel（9）の2件であることを確認。innerには別要素として記事リンク・本文・作者フッターがある。専用document_start CSSで既知スキ欄だけを待機し、埋め込み自身の設定読込・厳密判定に引き継ぐ。親ページCSSではiframe内を指定できない。実DOMで:has等のセレクタがスキ欄にのみ一致することを読み取り確認。実拡張の描画タイミングは別途実機確認する。


### 2026-11-05：質問箱のTL導線

質問箱の確認済み作者領域・本文余白を共用し、通常・社会復帰でTLリンクを左上72pxへ追加。既存作者リンクを120px、自己リンクを178pxへ移す。重度は作者72px・自己130pxを維持し、狭幅は従来どおり非表示。


### 2026-11-05：メンバーシップ参加画面

/nontsu/membership/joinでh1「古性のちの頭の中」と画像付き作者リンク（古性のち | Noci Koshoさんのクリエイターページ）を確認。ヘッダのmx-auto/max-w-[30rem]/lg:flex/lg:max-w-screen-lg枠と、main#main-content > div.w-full > div.mx-auto.my-4.max-w-[30rem].lg:max-w-[58.75rem]が既知のコンテンツ枠。1280px幅ではヘッダ枠左端162pxで、固定メニューの左余白条件を満たさないため非表示。両枠左端228px以上・幅1100px以上で質問箱と同じ導線を追加する。申込欄は変更しない。
