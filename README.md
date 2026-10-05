# Remote App Pane

Windows の RDP デスクトップをブラウザで表示・操作します。
Compose は **guacd**、**app**、**cloudflared** の3サービスです。
UI とサーバーは `app/` 内の一つの Node プロジェクトです。
`src/` に実装、`public/` に静的資産、`test/` にテストを置きます。
ビルド成果物は `dist/` に生成し、コンテナには実行に必要なファイルだけを含めます。

```text
compose.yaml                   # guacd + app + cloudflared
app/                           # 一つの Node プロジェクト
  Dockerfile
  package.json
  package-lock.json
  index.html                   # Vite の HTML エントリー
  scripts/
    build-assets.mjs           # vendor minify・gzip/Brotli生成（ビルド専用）
  src/
    server/                    # Node 実行時コード
      index.mjs                # 起動・シグナル処理
      config.mjs               # 環境変数の読取・固定の圧縮設定
      settings.mjs             # config.json の検証・保存
      dimensions.mjs           # 初回・接続中で共通の要求解像度計算
      app.mjs                  # HTTP サーバーの組み立て
      sessions.mjs             # 接続チケット・保持セッション・接続参加
      http/                    # HTTP / WebSocket の入口
        api.mjs                # /api/settings・status・connect・disconnect と入力検証
        upgrade.mjs            # /tunnel の WebSocket upgrade
        static.mjs             # 事前圧縮資産の配信・ETag・キャッシュ
        util.mjs               # json / body / sameOrigin
      guacamole/               # guacd との通信
        protocol.mjs           # プロトコルの解析・組立
        rdp-params.mjs         # RDP 設定と connect 命令の組立
        tunnel.mjs             # WebSocket と guacd の中継
    client/                    # ブラウザコード
      main.js                  # 接続画面（ボタン・ダイアログ）
      styles.css
      core/                    # 通信・セッション
        api.js                 # fetch ラッパー
        display-resize.js      # 表示領域の監視・サイズ更新
        webp.js                # WebP 対応判定
        remote-session.js      # Guacamole クライアントと入力の配線
      ui/
        settings-dialog.js    # 歯車からの設定読込・編集・保存
      input/                   # リモートへの入力
        mouse.js               # mousemoveの統合・タッチ操作・即時カーソル更新
        text-input.js          # クリップボード経由の文章入力ダイアログ
  public/vendor/               # そのまま配信する外部ライブラリ
  test/                        # 単体・接続・ブラウザテスト
  dist/                        # 生成物（git 管理外）
```

## 起動

必要: Docker Compose と、接続先 Windows での RDP 有効化。

```bash
cp .env.example .env
# .env の RDP_HOST を接続先 Windows に設定
# この環境の .env は設定済みなのでコピー不要
mkdir -p app-config
# コンテナの node ユーザー（UID/GID 1000）が書き込めるようにする
sudo chown 1000:1000 app-config
docker compose up --build -d
```

Cloudflare Tunnel に設定した公開ホスト名を開き「接続」を押します。
`.env` の `CLOUDFLARE_TOKEN` にトンネルのトークンを設定し、
Cloudflare 側の転送先（Service URL）は **`http://app:8443`** にします。
`cloudflared` と `app` は Compose の内部ネットワークで通信するため、
ホスト側へのポート公開は不要です。localhost / LAN からの直接アクセスは提供しません。

**アプリ自体に認証はありません。** アクセス制御は Cloudflare Access に任せています。
公開ホスト名には必ず Access ポリシーを設定してください。未設定のまま公開すると、
`RDP_USERNAME` / `RDP_PASSWORD` を設定している場合は誰でもデスクトップを操作できます。

```text
ブラウザ → Cloudflare → cloudflared → app :8443 → guacd :4822 → Windows :3389
```

Docker Desktop では通常 `RDP_HOST=host.docker.internal`。
WSL 内の Docker では `ip route show default` のゲートウェイ IP を指定します。
それ以外では Windows PC の IP アドレスを指定します。
`RDP_HOST` は guacd から到達できるアドレスにしてください。
guacd の接続先は `guacd:4822`、RDP のポートは `3389` に固定しています。
コンテナ間通信には Compose が自動作成するネットワークを使い、guacd のポートはホストに公開しません。

UI は50pxのヘッダーと、その下の RDP 画面だけです。
接続／切断をヘッダーで切り替えます。RDP の要求解像度は
**幅 = 表示欄の幅 × 2 × 解像度倍率、高さ = 表示欄の高さ × 解像度倍率**です。
倍率の初期値は1.2。各辺4096pxを上限に縦横比を保って収め、幅を偶数、高さを整数に丸めます。
各辺の最小値は200pxです（極端な縦横比では最小値を優先します）。DPI は96固定で、devicePixelRatioは加算しません。
表示欄には左半分か右半分だけを表示し、ヘッダーの正方形ボタンをタップするたびに「1」（左）と「2」（右）が切り替わります。選択中の数字が大きく、もう一方が右下に小さく表示されます。
初期値は「1」で、再接続しても選択を保ちます。
画面回転やブラウザのサイズ変更では、120msの待ち時間で変更をまとめて RDP 解像度も自動調整します。
Guacamole の `resize-method=display-update` を使い、Windows への接続を保ったまま更新します。
接続先が Display Update に非対応の場合は、受信した解像度を表示欄に収めます。
文章入力中のソフトキーボードによる高さだけの変化は RDP 解像度へ反映せず、入力ダイアログを閉じた後に再計測します。
接続中はヘッダーに下りの使用帯域を `kbps`（1,000 bit/秒）で表示し、1秒ごとに更新します。
値は app の接続別ソケットから書き出した **WebSocket圧縮後**のバイト数の区間平均です。
WebSocket のヘッダー・同期応答・転送量通知を含み、未送信キューと接続開始時の HTTP ハンドシェイクは含みません。
Cloudflare 経由では app → cloudflared の測定値です。Cloudflare → スマホ間の圧縮交渉・TLS・TCP/IP のヘッダー・再送、上り通信、ページ読み込みは含まれません。
スマホ回線に必要な下り帯域の目安として使えますが、回線の最大速度や端末の受信完了速度を測るものではありません。
例えば 1,000 kbps が続くと、この測定範囲で約 7.5 MB/分です。携帯回線全体の消費量は端末側でも確認してください。
接続後はマウス・タッチ・キーボードでそのまま操作できます。
ヘッダーの指／ポインターのアイコンのボタンをタップするたびに「Tap／マウス」が切り替わります。選択中のアイコンが大きく、もう一方が右下に小さく表示されます。初期値は相対操作の「マウス」です。
Tap は触った位置をクリックし、長押しで右クリック、1本指の上下スワイプでスクロールします。
マウスは指を滑らせて RDP のカーソルを動かし、タップで左クリック、
2本指タップで右クリック、2本指スワイプでスクロールします（指の動きに内容が付いてくる向き）。
どちらもタップ直後に指を戻して動かすとドラッグできます。
ジェスチャーは Guacamole 標準の Touchscreen / Touchpad を使用し、Tap のスワイプをホイール入力で補い、マウスの2本指スクロールの向きを反転します。
マウスのカーソル移動量は、Guacamole 標準の指の速さに応じた加速の後に、設定のポインタ速度を掛けて決めます。Tap には影響しません。
ヘッダーのキーボードアイコンで文章を入力し、「送信」で RDP 側のクリップボードへ転送して
Ctrl+V で貼り付けます。「送信＋Enter」は貼り付け後に Enter も送ります。
先に RDP 側の入力欄を選択してください。日本語・改行・絵文字をまとめて転送し、
送信後はダイアログを閉じます。右上の × またはダイアログの外側で閉じられます。
閉じるだけの場合や送信エラー時は入力を残します。
操作バーと入力ダイアログの見た目・フォーカス制御は `remote-window-control/web-ui` に合わせています。
ブラウザのクリップボード権限は不要です。RDP 側のクリップボードは送信した文章に置き換わります。
ページを閉じたりリロードしても、Node → guacd → Windows の接続を保持します。
同じブラウザで再訪すると、保持中の接続に自動で戻ります。接続を終了するには「切断」を押します。
接続済みだった WebSocket が意図せず閉じたとき（画面ロックや回線断など）と、ページが再び表示されたとき（`visibilitychange`、bfcache 復帰）にも、保持中なら自動で参加し直します。
保持中の接続がない、またはサーバーに届かない場合は自動再接続せず、ヘッダーは「接続」に戻って手動で操作します。接続が確立する前に失敗したときは再試行しません。
ブラウザ不在時は Node が同期応答を返し、描画データは保存せず破棄します。
再訪時の画面同期には guacd の既存接続への参加機能を使います。
Node / guacd の停止・再起動や接続先からの切断では、保持中の接続も終了します。
接続終了後の新規接続は手動です。

ブラウザの対応を確認してWebPをguacdに通知し、PNG/JPEGとともに内容に応じて使い分けます。
壁紙・テーマは無効、フォントの滑らか表示は有効です。
appからguacdへのTCPは `setNoDelay(true)` を使用します。
mousemoveは毎秒約60回を上限に最新座標へまとめ、ローカルカーソルは即時更新します。
クリック・ホイール・キー入力は即時送信し、切断時には未送信の移動を破棄します。

WebSocketは、相手が対応していればpermessage-deflateを使用します。
初期設定はlevel 1、memLevel 7、threshold 1024 bytes、concurrencyLimit 4、
server/clientともにcontext takeover無効です。小さいメッセージと転送量通知は圧縮しません。
圧縮レベルだけを設定画面で変更でき、その他の圧縮設定はコード内の固定値です。

### 設定

ヘッダーの歯車から、未接続時・接続中ともに設定を開けます。
スライダーで編集し「保存」を押すと、app全体で共有する設定を保存します。
保存前の編集は適用されません。解像度倍率は保存した画面へその場で反映し、
他の接続中画面では次の表示領域変更・画面接続時に適用します。
ポインタ速度も保存した画面へその場で反映し、他の接続中画面では次の画面接続時に適用します。
圧縮変更は次の WebSocket 接続から適用します。リロードでも反映でき、Windowsへの接続は保持します。

Compose は `./app-config/` を app の `/app/data/` に書き込み可能でマウントします。
`config.json` は初回起動時に次の初期値で生成します。

```json
{
  "resolutionScale": 1.2,
  "pointerSpeed": 1,
  "websocketCompressionLevel": 1
}
```

- `resolutionScale`: 数値0.5〜4。UIの刻みは0.1。縦横それぞれ1.2倍なら面積は1.44倍、表示上の文字は約83%になります。
- `pointerSpeed`: 数値0.5〜3。UIの刻みは0.1。マウスモードのカーソル移動量に掛ける倍率で、1が標準です。
- `websocketCompressionLevel`: 整数0〜9。0は圧縮無効、1〜9は圧縮レベル（高いほどCPU負荷が増える傾向）。

UIは `GET /api/settings` で読み込み、`PUT /api/settings` で3項目をまとめて保存します。
保存は一時ファイルからの置き換えで行い、失敗時は現在の設定を保持します。
構文不正・必須項目不足・未知の項目・範囲外があるファイルでは起動しません。
ホストから直接編集した内容は `docker compose restart app` で読み込みます。再ビルドは不要です（再起動では保持中のRDP接続も終了します）。
ディレクトリごとマウントするため、ファイルの置き換えもホストに反映します。
RDP接続先と認証情報は従来どおり環境変数で指定します。

ビルド時にvendor JSをminifyし、HTML/JS/CSSのgzip/Brotli版を生成します。追加の依存は不要です。
ブラウザのAccept-Encodingに応じて事前圧縮版を配信するため、リモート接続中のCPU負荷は増やしません。
ハッシュ付きJS/CSSは長期キャッシュ、HTML等はETagで再検証します。
これはページ読み込みと再訪時の転送量を減らす仕組みで、RDP画面のストリームには適用しません。

認証情報は接続時のダイアログで入力します。Windows Hello の PIN は使えません。
入力したパスワードは接続要求後に消去し、ブラウザへ保存しません。
`RDP_USERNAME` / `RDP_PASSWORD` を設定すれば入力を省略できます。
`.env` は git 管理外です。接続チケットは60秒・1回限りです。
保持中の接続を識別するランダムなトークンだけを HttpOnly / SameSite=Strict Cookie に保存します。
パスワードは再訪時の接続参加には不要です。Cookie を削除すると自動復帰できなくなります。

次の接続設定は固定です（変更するには `app/src/server/config.mjs` / `app/src/server/guacamole/rdp-params.mjs` を編集）。
キーボードレイアウトは日本語 (`ja-jp-qwerty`)、タイムゾーンは `Asia/Tokyo`、
RDP ポートは 3389、guacd は `guacd:4822` です。

接続方式は NLA (`nla`)、証明書検証の省略は有効 (`ignore-cert=true`) に固定しています。
TLS を使い、デスクトップセッションの開始前にユーザー認証を行います。
自己署名証明書でも接続できますが、接続先の真正性の確認は省略されます。暗号化とユーザー認証は有効です。
詳しくは [Guacamole の認証・セキュリティ設定](https://guacamole.apache.org/doc/gug/configuring-guacamole.html#authentication-and-security) を参照してください。

停止は `docker compose down`、ログは `docker compose logs -f`。
変更後は `docker compose up --build -d` で反映します。

## 動作確認

```bash
cd app
npm ci
npm test
npx playwright install chromium
npm run test:browser
# npm start の設定ファイルは app/data/config.json に生成します
```

疑似 guacd で描画・入力座標・切断・再接続・スマホ表示を検証します。
実 Windows へのログインと Display Update、Cloudflare 経由の圧縮・帯域表示は別途確認してください。
疑似 guacd の成功は、それらの実環境検証を意味しません。

Copyright (c) 2026 tanetakumi

同梱する Guacamole JavaScript 1.6.0 の情報とライセンスは
[app/public/vendor/README.md](app/public/vendor/README.md) を参照してください。
