# Remote App Pane

Windows の RDP デスクトップを、スマホを含むブラウザから表示・操作するための社内向け Web アプリです。
[Apache Guacamole](https://guacamole.apache.org/) の guacd で RDP を中継し、Cloudflare Tunnel で公開します。

## 特長

- **ブラウザだけで操作** — マウス・タッチ・キーボードに対応。専用クライアントは不要です。
- **スマホ向け操作** — 画面を左右に分けて表示し、Tap（直接）／マウス（相対）の2つのタッチ操作を切り替えられます。
- **特殊キーと文章入力** — Backspace・Shift+Enter・矢印キーのパレットと、日本語・改行・絵文字をまとめて送れる入力ダイアログ。
- **接続を保持** — ページを閉じても Windows への接続は残り、再訪や画面ロック復帰時に自動で戻ります。
- **画面サイズに追従** — 画面回転やウィンドウサイズの変更に合わせて RDP 解像度を自動調整します。
- **帯域の可視化** — 下り使用帯域（kbps / Mbps）をヘッダーに表示します。

## 構成

```text
ブラウザ → Cloudflare → cloudflared → app :8443 → guacd :4822 → Windows :3389
```

Compose は **guacd**・**app**・**cloudflared** の3サービスです。
ポートはホストに公開せず、サービス間は Compose の内部ネットワークで通信します。

## セットアップ

必要なもの: Docker Compose、RDP を有効にした Windows、Cloudflare Tunnel のトークン。

```bash
cp .env.example .env
# .env に RDP_HOST と CLOUDFLARE_TOKEN を設定
mkdir -p app-config
sudo chown 1000:1000 app-config   # コンテナの node ユーザー（UID/GID 1000）が書き込めるようにする
docker compose up --build -d
```

Cloudflare 側の転送先（Service URL）は **`http://app:8443`** にし、公開ホスト名を開いて「接続」を押します。

> [!WARNING]
> **アプリ自体に認証はありません。** アクセス制御は Cloudflare Access に任せています。
> 公開ホスト名には必ず Access ポリシーを設定してください。未設定のまま公開し、
> `RDP_USERNAME` / `RDP_PASSWORD` も設定していると、誰でもデスクトップを操作できます。

停止は `docker compose down`、ログは `docker compose logs -f`、変更後の反映は `docker compose up --build -d` です。

### 環境変数（`.env`）

| 変数 | 内容 |
| --- | --- |
| `RDP_HOST` | 接続先 Windows。guacd から到達できるアドレスを指定します（下記）。 |
| `RDP_USERNAME` / `RDP_PASSWORD` | 設定すると接続時の入力を省略できます。空欄ならブラウザで入力します。 |
| `CLOUDFLARE_TOKEN` | Cloudflare Tunnel のトークン（必須）。 |

`RDP_HOST` の目安:

- Docker Desktop: `host.docker.internal`
- WSL 内の Docker: `ip route show default` のゲートウェイ IP
- それ以外: Windows PC の IP アドレス

RDP のポート（3389）と guacd の接続先（`guacd:4822`）は固定です。`.env` は git 管理外です。

## 使い方

### ヘッダー

50px のヘッダーと RDP 画面だけの UI です。左から「電源（接続／切断）・設定・下り帯域」、
右寄せで「特殊キー・文章入力・1/2 切替・Tap／マウス切替」が並びます。
設定の「バーを下に表示」でヘッダーを画面下端へ移せます。

認証情報は接続時のダイアログで入力します（Windows Hello の PIN は使えません）。
入力したパスワードは接続要求後に消去し、ブラウザには保存しません。

### 画面の表示範囲

RDP の要求解像度は次の式で決まります。

**幅 = 表示欄の幅 × 2 × 解像度倍率、高さ = 表示欄の高さ × 解像度倍率**

倍率の初期値は 1.2 です。各辺は 4096px を上限に縦横比を保って収め、最小は 200px、DPI は 96 固定です。
表示欄には左半分か右半分だけを映し、「1」「2」のボタンで切り替えます（初期値は「1」。再接続しても保持）。
画面回転やサイズ変更は 120ms でまとめて、接続を保ったまま解像度を更新します（`resize-method=display-update`）。
接続先が Display Update に非対応のときは、受信した解像度を表示欄に収めます。
ソフトキーボードによる高さだけの変化は解像度に反映せず、入力ダイアログを閉じた後に再計測します。

### 操作モード

ヘッダーのボタンで切り替えます。初期値は「マウス」です。

| モード | 移動 | クリック | 右クリック | スクロール |
| --- | --- | --- | --- | --- |
| Tap | 触った位置 | タップ | 長押し | 1本指の上下スワイプ |
| マウス | 指を滑らせてカーソルを動かす | タップ | 長押し（動かさず 0.5 秒） | 2本指スワイプ（指に内容が付いてくる向き） |

どちらも、タップ直後に指を戻して動かすとドラッグできます。
マウスモードの長押しは、タップ直後に指を戻したドラッグ中には右クリックになりません。
マウスの移動量は Guacamole 標準の加速のあと、設定のポインタ速度を掛けて決まります（Tap には影響しません）。

### 文章入力

キーボードアイコンのダイアログで文章を入力し、「送信」で RDP 側のクリップボードへ転送して Ctrl+V で貼り付けます。
「送信＋Enter」は貼り付け後に Enter も送ります。先に RDP 側の入力欄を選択してください。
送信後はダイアログを閉じ、閉じるだけの場合や送信エラー時は入力を残します。
ブラウザのクリップボード権限は不要ですが、RDP 側のクリップボードは送信した文章に置き換わります。

### 特殊キー

4つの四角のアイコンでパレットを開閉します。BS（Backspace）・⇧↵（Shift+Enter）・矢印キー4つを、タップで1回ずつ送ります。
左端の点6つのバーをドラッグすると表示領域内で動かせ、位置は閉じても保持します。未接続時と切断時は閉じます。

### 接続の保持と再接続

ページを閉じたりリロードしても、Node → guacd → Windows の接続は保持します。
同じブラウザで再訪すると保持中の接続に自動で戻り、終了するには「切断」を押します。

- 接続済みの WebSocket が意図せず閉じたとき（画面ロックや回線断など）と、ページが再表示されたとき（`visibilitychange`、bfcache 復帰）は、保持中なら自動で参加し直します。
- 保持中の接続がない、またはサーバーに届かないときは自動再接続せず、ヘッダーは「接続」に戻ります。接続の確立前に失敗したときも再試行しません。
- ブラウザ不在の間、Node が同期応答を返し、描画データは保存せず破棄します。
- Node / guacd の停止・再起動や接続先からの切断では、保持中の接続も終了します。

保持中の接続を識別するランダムなトークンだけを、HttpOnly / SameSite=Strict の Cookie に保存します。
Cookie を削除すると自動復帰できなくなります。

### 下り帯域の表示

接続中、ヘッダーに下りの使用帯域を `kbps`（1,000 bit/秒）で1秒ごとに表示します。
表示幅が変わらないよう有効数字3桁で、999.5 kbps 以上は `Mbps` に切り替えます（例: `5.2` `99.9` `100` `999` kbps、`1.00` `10.0` `12.3` Mbps）。
app の接続別ソケットから書き出した **WebSocket 圧縮後**のバイト数の区間平均で、WebSocket のヘッダー・同期応答・転送量通知を含みます。

Cloudflare 経由では app → cloudflared の測定値です。Cloudflare → スマホ間の TLS・TCP/IP ヘッダー・再送、上り通信、ページ読み込みは含みません。
回線に必要な下り帯域の目安であり、最大速度や端末の受信完了速度を測るものではありません。
1,000 kbps が続くと約 7.5 MB/分です。携帯回線全体の消費量は端末側でも確認してください。

## 設定

ヘッダーの歯車から、未接続時・接続中ともに開けます。

| 項目 | 範囲 | 内容 |
| --- | --- | --- |
| 解像度倍率 `resolutionScale` | 0.5〜4（刻み 0.1） | 縦横それぞれ 1.2 倍なら面積は 1.44 倍、表示上の文字は約 83% になります。 |
| ポインタ速度 `pointerSpeed` | 0.5〜3（刻み 0.1） | マウスモードのカーソル移動量に掛ける倍率。1 が標準です。 |
| WebSocket 圧縮レベル `websocketCompressionLevel` | 整数 0〜9 | 0 は無効。高いほど圧縮は強くなり、CPU 負荷も増える傾向があります。 |
| バーを下に表示 | オン／オフ | この端末だけの設定。保存を待たず反映し、`localStorage` に保持します。接続・解像度には影響しません。 |

上の3項目は「保存」で app 全体の設定として保存します（保存前の編集は適用されません）。

- 解像度倍率とポインタ速度は、保存した画面にはその場で反映し、他の接続中画面では次の表示領域変更・画面接続時に適用します。
- 圧縮レベルは次の WebSocket 接続から適用します。リロードでも反映でき、Windows への接続は保持します。

設定は `./app-config/config.json` に保存します（Compose が `/app/data/` へマウント）。初回起動時に次の初期値で生成します。

```json
{
  "resolutionScale": 1.2,
  "pointerSpeed": 1,
  "websocketCompressionLevel": 1
}
```

保存は一時ファイルからの置き換えで行い、失敗時は現在の設定を保持します。
構文不正・必須項目不足・未知の項目・範囲外があるファイルでは起動しません。
ホストで直接編集したときは `docker compose restart app` で読み込みます（再ビルド不要。ただし保持中の RDP 接続は終了します）。

## 技術メモ

### 通信と描画

- 描画: ブラウザの対応を確認して WebP を guacd に通知し、PNG/JPEG と内容に応じて使い分けます。壁紙・テーマは無効、フォントの滑らか表示は有効です。
- 遅延: app → guacd の TCP は `setNoDelay(true)`。mousemove は毎秒約 60 回を上限に最新座標へまとめ、ローカルカーソルは即時更新します。クリック・ホイール・キー入力は即時送信し、切断時は未送信の移動を破棄します。
- 圧縮: 相手が対応していれば permessage-deflate を使います。level 1・memLevel 7・threshold 1024 bytes・concurrencyLimit 4・context takeover 無効が初期値で、変更できるのはレベルだけです。小さいメッセージと転送量通知は圧縮しません。
- 静的資産: ビルド時に vendor JS を minify し、HTML/JS/CSS の gzip/Brotli 版を生成します。Accept-Encoding に応じて事前圧縮版を配信するため、接続中の CPU 負荷は増えません。ハッシュ付き JS/CSS は長期キャッシュ、HTML 等は ETag で再検証します。RDP 画面のストリームには適用しません。

### セキュリティ

- 接続方式は NLA に固定です。TLS を使い、セッション開始前にユーザー認証を行います。
- 証明書検証は省略（`ignore-cert=true`）しています。自己署名証明書でも接続できますが、接続先の真正性は確認されません。暗号化とユーザー認証は有効です。詳しくは [Guacamole の認証・セキュリティ設定](https://guacamole.apache.org/doc/gug/configuring-guacamole.html#authentication-and-security) を参照してください。
- 接続チケットは 60 秒・1 回限りです。

### 固定の接続設定

キーボードレイアウトは日本語（`ja-jp-qwerty`）、タイムゾーンは `Asia/Tokyo` です。
変更するには `app/src/server/config.mjs` / `app/src/server/guacamole/rdp-params.mjs` を編集してください。

## 開発

UI とサーバーは `app/` 内の一つの Node プロジェクトです。ビルド成果物は `dist/`（git 管理外）に生成し、コンテナには実行に必要なファイルだけを含めます。

```text
compose.yaml                   # guacd + app + cloudflared
app/
  Dockerfile
  index.html                   # Vite の HTML エントリー
  scripts/build-assets.mjs     # vendor minify・gzip/Brotli 生成（ビルド専用）
  src/
    server/                    # Node 実行時コード
      index.mjs                # 起動・シグナル処理
      config.mjs               # 環境変数の読取・固定の圧縮設定
      settings.mjs             # config.json の検証・保存
      dimensions.mjs           # 初回・接続中で共通の要求解像度計算
      app.mjs                  # HTTP サーバーの組み立て
      sessions.mjs             # 接続チケット・保持セッション・接続参加
      http/                    # api.mjs / upgrade.mjs（/tunnel）/ static.mjs / util.mjs
      guacamole/               # protocol.mjs / rdp-params.mjs / tunnel.mjs
    client/                    # ブラウザコード
      main.js                  # 接続画面（ボタン・ダイアログ）
      styles.css
      core/                    # api / display-resize / webp / remote-session
      ui/settings-dialog.js    # 設定の読込・編集・保存
      input/                   # mouse / text-input / special-keys
  public/vendor/               # そのまま配信する外部ライブラリ
  test/                        # 単体・接続・ブラウザテスト
```

### テスト

```bash
cd app
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

`npm start` の設定ファイルは `app/data/config.json` に生成します。
疑似 guacd で描画・入力座標・切断・再接続・スマホ表示を検証します。
実 Windows へのログインと Display Update、Cloudflare 経由の圧縮・帯域表示は別途確認してください。疑似 guacd の成功は、それらの実環境検証を意味しません。

## ライセンス

Copyright (c) 2026 tanetakumi

同梱する Guacamole JavaScript 1.6.0 の情報とライセンスは [app/public/vendor/README.md](app/public/vendor/README.md) を参照してください。
