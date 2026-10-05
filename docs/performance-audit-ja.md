# 通信量・遅延の調査

調査日: 2026-10-05。対象: このリポジトリ、稼働中の `guacamole/guacd:1.6.0`、同梱の Guacamole JavaScript 1.6.0、`ws` 8.22.0。アプリや稼働設定の変更は行っていない。

この資料は最適化前の調査記録。調査後、WebP対応通知、壁紙・テーマ無効化、TCP_NODELAY、mousemove統合、WebSocket圧縮、静的資産のminify・事前圧縮・キャッシュを実装した。フォントの滑らか表示、解像度、送信待ちの閾値は維持。現在の設定は [README](../README.md) を参照。

**結論**

改善の中心は、画像形式の交渉、生成する画面の大きさ、装飾、通信経路、送信待ちの制御である。guacd 起動オプションだけで画質・帯域・FPSを指定する仕組みはない。RDP接続設定、ブラウザの対応形式、アプリの中継を組み合わせる必要がある。

現状で優先して検証する変更は、WebPの対応通知、解像度の上限と動的変更、壁紙などの無効化、app→guacd の TCP_NODELAY、送信待ち時間の計測と制御。WebSocket圧縮とGFXの比較は、CPU時間・文字品質・遅延も測って決める。

**調査の範囲と確認方法**

- `compose.yaml`、`.env.example`、Dockerfile、package.json、HTML、CSS、自作JavaScript全ファイル、既存テストを確認した。認証情報やトークンの値は調査資料に含めない。
- 同梱ライブラリの接続、命令解析、画像復号、描画、入力、同期、統計、タイマーを確認した。未使用の音声・ファイル転送・録画等の機能は、読み込まれることと、実際に使用されることを区別した。
- 稼働コンテナの `guacd -v`、CLI一覧、entrypoint、リンク先ライブラリを確認した。
- guacdに `select rdp` だけを送信して `args` を取得した。Windowsへのログインやデスクトップ接続は行っていない。実機が受け付ける設定は**88項目**とプロトコルバージョン1項目。
- 稼働appの中継・解析・HTTP実装と同梱ライブラリのSHA-256が、ワークスペース内のファイルと一致することを確認した。
- `npm test`: 8件成功。`npm run test:browser`: ビルドとブラウザテスト1件成功。疑似guacdによる機能確認であり、実Windows・WANの性能測定ではない。

Windowsの実際の描画設定、Cloudflare側の入口設定、利用端末の復号時間、経路ごとのRTT・損失は未測定。以下の効果は、コード上の根拠に基づく改善候補であり、実測済みの削減率ではない。

このappは `select rdp` に固定されているため、接続設定一覧はRDPとRDPで使用可能な共通機能を対象とする。VNC・SSH・Telnet・Kubernetes等の別プロトコル専用設定は、現在の通信経路では使用されない。

**1. 通信と処理の全体像**

```text
LAN: ブラウザ ─HTTP/WebSocket→ app ─TCP/Guacamole→ guacd ─RDP→ Windows
外部: ブラウザ ─HTTPS/WSS→ Cloudflare ─Tunnel→ cloudflared ─HTTP/WS→ app
                                                          ↓
                                                        guacd ─RDP→ Windows

画面: Windows描画 → RDP符号化 → guacd復号・変更領域の最適化
      → PNG/JPEG等の画像符号化 → Base64を含むGuacamole命令
      → app解析・中継 → ブラウザ解析・画像復号 → Canvas描画 → sync応答
入力: マウス/キー → ブラウザ命令 → app → guacd → RDP → Windows
```

RDPの圧縮とブラウザ向け画像圧縮は別段階。GFXを有効にしても、Windowsの映像圧縮データをそのままブラウザの動画デコーダへ流す構成にはならない。このアプリは `video` の対応形式を空で通知している。

通信量を減らすと、回線が詰まっている場合は待ち時間も減る。ただし圧縮のCPU時間が増えると、空いているLANでは遅くなる場合がある。静止画、文字入力、スクロール、動画を別々に比較する。

**2. guacdデーモンの設定項目: 全項目**

| CLI | guacd.conf | 内容 | 現状と性能上の意味 |
|---|---|---|---|
| `-b HOST` | `[server] bind_host` | 待受アドレス | Docker entrypointが `0.0.0.0` を指定。画像圧縮とは無関係 |
| `-l PORT` | `[server] bind_port` | 待受ポート | 4822。変更するならappの接続先も変更 |
| `-L LEVEL` | `[daemon] log_level` | `trace/debug/info/warning/error` | entrypointの既定はinfo。詳細ログは調査時に限定 |
| `-p FILE` | `[daemon] pid_file` | PIDファイル | 帯域・描画遅延への実質的影響なし |
| `-C FILE` | `[ssl] server_certificate` | app↔guacdのTLS証明書 | 現状は未使用。app側も `tls.connect` 等の対応が必要 |
| `-K FILE` | `[ssl] server_key` | TLS秘密鍵 | 同上 |
| `-f` | なし | フォアグラウンド実行 | Docker entrypointが指定済み |
| `-v` | なし | バージョン表示して終了 | 調査用 |

設定ファイルは `/etc/guacamole/guacd.conf`。CLIが設定ファイルに優先する。Docker entrypointは `-f -b 0.0.0.0 -L ...` を付けるため、同じ項目を設定ファイルだけで変えてもCLI側に上書きされる。Composeの `command` で後続のCLI引数を渡せる。

実コンテナのentrypointが読む環境変数は `LOG_LEVEL`、互換用の `GUACD_LOG_LEVEL`。後者は非推奨。`GUACD_HOSTNAME` 等、公式Java Webアプリ側の環境変数をこのNodeアプリに追加しても、現実装は読まない。

FPS上限、目標kbps、JPEG品質、圧縮レベル、描画worker数を直接設定するデーモンオプションはない。

根拠: [guacd CLIの公式ソース](https://github.com/apache/guacamole-server/blob/1.6.0/src/guacd/man/guacd.8.in)、[guacd.confの公式ソース](https://github.com/apache/guacamole-server/blob/1.6.0/src/guacd/man/guacd.conf.5.in)、[Docker entrypoint](https://github.com/apache/guacamole-server/blob/1.6.0/src/guacd-docker/bin/entrypoint.sh)。

**3. RDP接続設定: 実コンテナが受け付ける88項目**

以下の「未指定」は、appが接続時に空文字を渡し、guacd側が既定値を適用する意味。環境変数で変更できるものは接続先と認証情報のみ。その他は現在 `app/src/guacamole/tunnel.mjs` の `parameters` を変更する必要がある。

一覧の項目名は実コンテナから取得した `args` に照合した。動作の解釈は [RDP設定の公式実装](https://github.com/apache/guacamole-server/blob/1.6.0/src/protocols/rdp/settings.c) と [1.6.0公式マニュアル](https://guacamole.apache.org/doc/1.6.0/gug/configuring-guacamole.html#rdp) に基づく。

**3a. 接続先、認証、セッション**

| パラメータ | 現在 | 用途・性能上の意味 |
|---|---|---|
| `hostname` | RDP_HOST | guacdから到達するWindows。配置・経路の距離が重要 |
| `port` | 3389固定 | RDP接続先ポート |
| `timeout` | 未指定 | 接続先応答待ち。既定10秒。定常時の描画遅延を下げる値ではない |
| `domain` | 未指定 | Windowsドメイン |
| `username` | ブラウザ入力または環境変数 | Windows認証 |
| `password` | 同上 | Windows認証。資料には値を記録しない |
| `security` | nla固定 | 認証・暗号方式。性能のために弱める必要はない |
| `ignore-cert` | true固定 | 証明書検証省略。画像量には影響しない |
| `cert-tofu` | 未指定 | 初回の証明書を記憶して照合 |
| `cert-fingerprints` | 未指定 | 許可する証明書指紋 |
| `disable-auth` | 未指定 | 接続認証の無効化。NLA使用時は有効化できない |
| `client-name` | 未指定 | Windowsに通知するクライアント名 |
| `console` | 未指定 | 管理セッションへの接続 |
| `initial-program` | 未指定 | ログイン後に開始するプログラム |
| `server-layout` | ja-jp-qwerty | サーバーのキーボード配列。帯域最適化ではない |
| `timezone` | 接続パラメータは未指定 | 別のhandshake命令でAsia/Tokyoを通知済み |
| `read-only` | 未指定 | 入力を受け付けない接続。画面転送は継続 |

**3b. 解像度、描画、キャッシュ: 最優先の確認箇所**

| パラメータ | 現在／実効上の既定 | 用途・変更候補 |
|---|---|---|
| `width` | 接続時のviewer幅、200〜4096 | 生成する画面の幅。上限・プリセットを設ける |
| `height` | 接続時のviewer高さ、200〜4096 | 高さ。同じく画素数を制限 |
| `dpi` | 96固定 | リモートUIの大きさ。単体で帯域削減を保証しない |
| `color-depth` | 未指定。GFX有効時は32bpp | 低色深度を試すならGFXとの組み合わせに注意 |
| `resize-method` | 未指定＝変更しない | `display-update` または `reconnect`。appのsendSize対応も必要 |
| `force-lossless` | 未指定＝false | 非可逆圧縮を許可済み。節約用途でtrueにしない |
| `enable-wallpaper` | true | 壁紙を有効化中。falseを比較 |
| `enable-theming` | true | テーマ有効。falseを比較 |
| `enable-font-smoothing` | true | 滑らかな文字。通信量と可読性を比較して決める |
| `enable-full-window-drag` | 未指定＝false | 移動中のウィンドウ内容。無効のままが節約向き |
| `enable-desktop-composition` | 未指定＝false | 合成効果。無効のままが節約向き |
| `enable-menu-animations` | 未指定＝false | メニューアニメーション。無効のままが節約向き |
| `disable-bitmap-caching` | 未指定＝false | キャッシュを維持。無効化は互換性問題時に比較 |
| `disable-offscreen-caching` | 未指定＝false | 画面外キャッシュを維持。同上 |
| `disable-glyph-caching` | 未指定だが実装で強制無効 | 値をfalseにしても、この版ではglyph cacheは有効にならない |
| `disable-gfx` | 未指定＝false | GFXは既定で有効。実Windowsとの確立は別途確認 |

重要な制約: **GFXを有効にすると、要求したcolor-depthにかかわらず32bppに設定される**。`color-depth=16` だけ追加しても期待した低色深度にはならない。比較するなら `disable-gfx=true` と `color-depth=16` の組み合わせを用い、標準のGFX構成と測定する。GFX無効化が必ず通信量・遅延を改善するわけではない。

**3c. 音声、入力、印刷、ドライブ、クリップボード**

| パラメータ | 現在 | 用途・性能上の意味 |
|---|---|---|
| `disable-audio` | true | 音声出力無効。音声転送量を抑制済み |
| `enable-audio-input` | 未指定＝false | マイク入力無効 |
| `enable-touch` | 未指定＝false | RDPの直接タッチ入力無効。現UIはタッチをマウスに変換 |
| `console-audio` | 未指定 | 管理セッションの音声。現在は音声自体を無効化 |
| `enable-printing` | 未指定＝false | 仮想プリンター無効 |
| `printer-name` | 未指定 | 仮想プリンター名 |
| `enable-drive` | 未指定＝false | 仮想ドライブ・ファイル転送無効 |
| `drive-name` | 未指定 | 仮想ドライブ名 |
| `drive-path` | 未指定 | guacd側のファイル格納場所 |
| `create-drive-path` | 未指定 | 格納先の自動作成 |
| `disable-download` | 未指定 | ドライブ利用時のダウンロード禁止。現在ドライブ無効 |
| `disable-upload` | 未指定 | ドライブ利用時のアップロード禁止。同上 |
| `disable-copy` | true | リモート→ローカルのクリップボード無効 |
| `disable-paste` | true | ローカル→リモートのクリップボード無効 |
| `normalize-clipboard` | 未指定 | 改行をpreserve/unix/windowsに正規化。現在clipboard無効 |
| `static-channels` | 未指定 | 追加の静的チャネル。不要な通信を追加しない |

**3d. RemoteApp、ゲートウェイ、接続振り分け**

| パラメータ | 現在 | 用途・性能上の意味 |
|---|---|---|
| `remote-app` | 未指定 | RDS側が対応する特定アプリだけを公開。現状はデスクトップ全体 |
| `remote-app-dir` | 未指定 | RemoteAppの作業ディレクトリ |
| `remote-app-args` | 未指定 | RemoteAppの起動引数 |
| `preconnection-id` | 未指定 | 接続先内部の識別番号 |
| `preconnection-blob` | 未指定 | Hyper-V等の接続先識別情報 |
| `gateway-hostname` | 未指定 | RD Gateway経由の接続。現在は直接接続 |
| `gateway-port` | 未指定 | RD Gatewayポート。使用時の既定443 |
| `gateway-domain` | 未指定 | Gateway認証ドメイン |
| `gateway-username` | 未指定 | Gateway認証ユーザー |
| `gateway-password` | 未指定 | Gateway認証パスワード |
| `load-balance-info` | 未指定 | 接続ブローカーに送る振り分け情報 |

RemoteAppを使えば描画対象が減る可能性があるが、Windows/RDS側の設定が必要。名前を設定するだけでWindowsデスクトップが自動的に最適化される機能ではない。

**3e. SFTP: 全15項目、現在は未使用**

| パラメータ | 現在 | 用途 |
|---|---|---|
| `enable-sftp` | 未指定＝false | SFTPによる別系統のファイル転送 |
| `sftp-hostname` | 未指定 | SFTP接続先 |
| `sftp-host-key` | 未指定 | サーバー鍵検証 |
| `sftp-port` | 未指定 | SFTPポート |
| `sftp-timeout` | 未指定 | 接続待ち時間 |
| `sftp-username` | 未指定 | 認証ユーザー |
| `sftp-password` | 未指定 | パスワード |
| `sftp-private-key` | 未指定 | 秘密鍵 |
| `sftp-passphrase` | 未指定 | 秘密鍵のパスフレーズ |
| `sftp-public-key` | 未指定 | 公開鍵 |
| `sftp-directory` | 未指定 | 初期ディレクトリ |
| `sftp-root-directory` | 未指定 | 公開範囲のルート |
| `sftp-server-alive-interval` | 未指定 | SFTP keepalive間隔 |
| `sftp-disable-download` | 未指定 | SFTPダウンロード禁止 |
| `sftp-disable-upload` | 未指定 | SFTPアップロード禁止 |

SFTPを使わなければ、この設定群を調整しても画面転送の帯域・遅延は変わらない。

**3f. 録画とWake-on-LAN: 全13項目、現在は未使用**

| パラメータ | 現在 | 用途・性能上の意味 |
|---|---|---|
| `recording-path` | 未指定 | Guacamole命令の録画先。未指定なので録画なし |
| `recording-name` | 未指定 | 録画名 |
| `recording-exclude-output` | 未指定 | 画面出力を録画から除外 |
| `recording-exclude-mouse` | 未指定 | マウスを録画から除外 |
| `recording-exclude-touch` | 未指定 | タッチを録画から除外 |
| `recording-include-keys` | 未指定 | キー入力を録画へ含める |
| `create-recording-path` | 未指定 | 録画先の自動作成 |
| `recording-write-existing` | 未指定 | 既存録画への書き込み許可 |
| `wol-send-packet` | 未指定＝false | 接続前に起動パケットを送る |
| `wol-mac-addr` | 未指定 | 起動先MAC |
| `wol-broadcast-addr` | 未指定 | 起動パケット送信先 |
| `wol-udp-port` | 未指定 | 起動パケット用UDPポート |
| `wol-wait-time` | 未指定 | 起動後の待ち時間 |

録画を有効にするとディスクI/O等を追加する。WOLは接続開始時の機能であり、画面転送をUDP化する設定ではない。

**4. 接続handshakeとguacd内部の最適化**

`tunnel.mjs:39〜67` は `select rdp` → `args` → `size/audio/video/image/timezone/connect` → `ready` の順で接続する。設定項目の順序を固定せず、guacdが返したargsの順に値を並べる処理は適切。

| handshake情報 | 現在 | 評価 |
|---|---|---|
| プロトコル版 | VERSION_1_5_0 | 実guacdが要求する版と一致。1.6.0へ文字列だけ変更する必要はない |
| `size` | 接続時の幅・高さ、DPI96 | RDP側にも同じ幅・高さを指定 |
| `audio` | 対応形式なし | 音声無効化と整合 |
| `video` | 対応形式なし | ブラウザへの動画ストリームは使用していない |
| `image` | image/png、image/jpeg | WebPを通知していない。優先的な改善候補 |
| `timezone` | Asia/Tokyo | 帯域にほぼ関係しない |

実guacdはlibwebpにリンク済み。同梱JSの `img` 命令処理はMIMEを受け取り画像を復号するため、ブラウザがWebPに対応していれば対応形式に `image/webp` を追加できる。ブラウザ側で対応を確認し、POSTの許可リストを通してサーバーに伝える方法がよい。PNG/JPEGへのフォールバックも維持する。

guacdの画像選択は内容と更新頻度による。WebPを通知しても、文字中心の更新等ではPNGが選ばれるため、全画像がWebPになるわけではない。非可逆画像の品質はprocessing lagに応じて30〜90の範囲で内部調整される。これは設定可能な `jpeg-quality` 項目ではない。[画像選択・品質調整の公式実装](https://github.com/apache/guacamole-server/blob/1.6.0/src/libguac/display-worker.c)。

描画の変更領域や操作の統合、workerによる画像符号化、sync応答に基づく待機はguacd側に既にある。描画スレッドには10msと100msの時間定数があるが、これらは待機や更新の内部処理用で、単純な「FPS設定」ではない。[描画スレッド](https://github.com/apache/guacamole-server/blob/1.6.0/src/libguac/display-render-thread.c)。

worker数は利用可能CPU数から決まる。`cpus` のquotaと、CPU affinity/cpusetが示すCPU数は同じ意味ではない。CPUを絞る場合はworker数とCPU throttlingを実測する。調査時のコンテナ内 `_NPROCESSORS_ONLN` は20だったが、実際に作るworker数は起動ログ等で別途確認する。[worker生成処理](https://github.com/apache/guacamole-server/blob/1.6.0/src/libguac/display.c)。

FPS上限、任意の画像品質、目標帯域を直接制御したければ、guacd側の改修・ビルドが必要になる。アプリで出力済み命令を間引く方法は、状態を持つ差分描画との整合を失うため不適切。

**5. app内の処理: 全経路の確認**

**5a. config、起動、HTTP、接続チケット**

| 場所 | 現在の処理 | 性能上の意味・候補 |
|---|---|---|
| `src/config.mjs` | HOST/PORT、RDP_HOST、認証情報を読む。guacd:4822、RDP:3389、NLAを固定 | guacd接続先を配置別に選ぶにはコード変更が必要 |
| `src/index.mjs` | 単一NodeプロセスでHTTP/WS起動 | 中継処理が重いと同プロセスの他セッションも影響する |
| 同上 | SIGINT/SIGTERMでWSとHTTPを閉じる | 手動再接続時は再handshakeと初期画面転送が発生 |
| `src/app.mjs:53` | 初回GET /api/status | ページ表示時1回。定期HTTPポーリングなし |
| `src/app.mjs:56` | POST /api/connect、JSONと認証情報を検証 | 接続開始にHTTP往復1回を追加。定常帯域への影響は小さい |
| 同上 | 幅・高さを整数200〜4096で検証、未指定1280×720 | 上限が軸ごとなので最大約1678万画素まで許す |
| 同上 | 最大32件、60秒・1回限りのticket | 接続開始管理。描画品質やFPSに関係しない |
| `src/app.mjs:37` | 10秒間隔で期限切れticket削除 | 小さな管理処理。描画転送の主因ではない |
| `src/app.mjs:80` | Origin/ticket/subprotocol確認後にWebSocketへupgrade | 接続のたびにHTTP→WSの確立が必要 |
| `src/app.mjs:40` | WS受信上限128KiB、perMessageDeflate=false | 受信上限はブラウザ→app用。画面側の送信フレーム上限ではない |
| `src/app.mjs:72` | 静的ファイルを毎回readFile、no-cache | ETag/Last-Modifiedがなく、再読込時に本体を再送し得る |
| 同上 | gzip/Brotliの実装なし | vendor JSの初回取得が大きい。接続中の画面帯域とは別問題 |
| `src/app.mjs:42` | HTTPセキュリティヘッダー | 帯域・描画遅延への影響は小さい |

`no-cache` は保存禁止ではなく再検証を要求する指定。ただしこの実装には条件付きGETに応じる処理がない。HTMLは再検証、ハッシュ名JS/CSSは長期キャッシュ、バージョン付きvendorは更新方法を決めてキャッシュする。静的配信は事前圧縮とメモリキャッシュも候補。

**5b. guacd↔app↔ブラウザの中継**

| 場所 | 現在 | 改善候補・制約 |
|---|---|---|
| `tunnel.mjs:6` | net.createConnectionでTCP接続 | app側はsetNoDelay未指定。`tcp.setNoDelay(true)` を候補にする |
| `tunnel.mjs:36` | handshake中のTCP無通信タイムアウト30秒 | ready後は解除。定常時の遅延上限ではない |
| `tunnel.mjs:40` | 全下り命令を解析、errorを処理、描画命令をpendingへ | 画像Base64も全文字を走査している。CPU/GCを計測 |
| `tunnel.mjs:77` | TCP dataイベント内で完全命令をjoin、WSテキスト1メッセージで送る | 命令ごと送信を避けている。意図的な待機タイマーはない |
| `tunnel.mjs:27` | string→Buffer変換後、binary:falseで送信 | UTF-8符号化とコピーが追加される |
| `tunnel.mjs:25` | bufferedAmount>16MiBで切断 | メモリ保護。操作遅延を抑える閾値としては大きい |
| `tunnel.mjs:26` | bufferedAmount>1MiBでTCP読取停止 | 帯域不足への背圧はあるが、送信待ち時間の制御はない |
| `tunnel.mjs:28` | send callback後、1MiB未満なら読取再開 | callbackはブラウザで描画済みという意味ではない |
| `tunnel.mjs:85` | 上り命令も解析、TCP writeがfalseならws.pause | 上り背圧あり。同一message内の残り命令までは処理が続く |
| `tunnel.mjs:90` | TCP drainでws.resume | 停止・再開の仕組みは存在する |
| `tunnel.mjs:86` | 空opcodeのpingをappからecho | guacdには送らない。browser↔app経路の生存確認 |
| `tunnel.mjs:69` | 1秒ごとapp-bitrate命令 | 小さな常時通信。計測値の定義に注意 |
| `tunnel.mjs:95` | TCP/WSエラー・終了を相互伝播、timer破棄 | 自動再接続はない |

1MiBの送信待ちは、実効1Mbpsなら約8.39秒分、10Mbpsでも約0.84秒分に相当する。これは単純な `queued bytes × 8 / throughput` の換算であり、現在の実測遅延ではない。さらにOS・Cloudflare・ブラウザ内の待ちがあり、ws.bufferedAmountだけでは総待ち時間はわからない。

低遅延には「キュー容量を増やして保持する」より、画面生成量を先に下げる制御が必要。送信待ちの高水位・低水位を分け、現在送る分のサイズも加味して止める。古いデータが何ms滞留しているかを測り、解像度低下などに結び付ける。具体的な閾値は回線と描画負荷を測って決定する。

`tcp.setNoDelay(true)` は小さな入力やsyncを速やかに送るための候補。guacdの受け入れTCP側と `ws` のソケット側は既にTCP_NODELAYを設定している。欠けているのはappからguacdへ張るnet.Socket側。設定すると小パケットが増える可能性はある。[Nodeの仕様](https://nodejs.org/api/net.html#socketsetnodelaynodelay)。

WSメッセージを数ms貯めてさらに統合すればヘッダーを減らせるが、必ずその待ちを追加する。まず現在のメッセージサイズ分布とイベントループ時間を測り、重い画像は即時、小さい制御命令は必要な範囲だけ統合する。現在既にTCP受信単位で統合済みなので、最初から長いbatch待ちを追加しない。

**5c. 命令の解析・組立**

`protocol.mjs` の `instruction()` は文字数をUnicode code pointとして計算する。日本語・絵文字・区切り記号を正しく扱うために必要。入力の長さをbyte長へ置き換えてはいけない。

`InstructionParser` はUTF-8のチャンク境界をStringDecoderで扱い、未完成要素を途中から再開する。大画像をチャンクごとに先頭から再走査する問題は対策済み。一方、Base64の全code pointのループ、要素とrawのslice、pendingのjoin、送信用Buffer生成は残る。画像量が大きい場合のCPUとGCの候補。

既定の下り解析上限は8MiB、上りは128KiB。上限の判定はJS文字列の長さであり、厳密なUTF-8 byte量とは一致しない。受信batch全体を足してから上限判定するため、単一要素だけの上限とも異なる。

将来、handshake後の下りをより直接中継する方式を検討できる。ただしerror処理、独自統計命令との並び、途中命令、UTF-8境界、背圧を維持する必要がある。ブラウザのGuacamole.Parserは分割受信を扱うが、単純に各TCP chunkを `toString()` する変更はUnicodeを壊し得る。処理時間を測って必要なら進める。

**5d. ブラウザの接続、画面サイズ、入力、終了**

| 場所 | 現在 | 性能上の意味・候補 |
|---|---|---|
| `client/main.js:18` | fetchでstatus/connect | HTTPは接続開始時のみ |
| `client/main.js:58` | viewerのCSS pixelをRDPの初期サイズにする | devicePixelRatioを掛けていない。高DPI端末で画素数が増えにくい |
| `client/main.js:31` | display.scaleで画面をfit | 見た目の倍率だけ。RDP画像の画素数・通信量は変わらない |
| `client/main.js:135` | ResizeObserverでfitDisplay | sendSizeなし。ウィンドウ縮小後も元の解像度を転送 |
| `client/main.js:66` | WebSocketTunnelのみ | HTTP tunnel fallbackは使用せず、定期HTTP readなし |
| `client/main.js:69` | app-bitrateを表示、それ以外をGuacamole.Clientへ | FPS・遅延・画像形式の計測は未実装 |
| `client/main.js:81` | Keyboardでkeydown/upを送信 | キーは順序を維持し、間引かない |
| `client/main.js:87` | MouseとTouchscreenの各イベントを即送信 | 高頻度mousemoveは統合候補 |
| `client/main.js:85` | blurでキー状態reset | キー押しっぱなし防止。保持すべき |
| `client/main.js:38` | 切断、画面要素破棄、generation更新 | 古い非同期応答の影響を避ける |
| `client/main.js:134` | pagehideで切断 | ページ終了時に中継を止める |
| 全体 | visibilitychangeによる制御なし | 非表示タブでも接続・リモート画面転送は継続し得る |

mousemoveだけを短い間隔で最新位置へまとめる方法は、上り通信とWindows側のhover更新を減らせる。mousedown/up、wheel、keydown/up、syncを間引かない。drag中の経路を使う描画アプリでは中間座標も必要なので、用途別に動作確認する。リモート入力を間引いてもローカルカーソルは即時更新する。

表示解像度の変更には `resize-method=display-update` と `client.sendSize()` の両方が必要。ResizeObserverの全イベントに即追随すると連続リサイズによる再描画が増えるため、落ち着いてから更新し、整数化・上下限・面積上限を設ける。頻繁な縮小拡大を避けるヒステリシスも必要。

1920×1080→1280×720は画素数が約56%少なくなる。ただしGuacamoleは差分転送なので、通信量が常に56%減るとは限らない。DPI変更はUIの見やすさの補助として扱う。

非表示タブに対しては、読取停止だけで対応すると後で古い画面を消化することになる。低解像度化、接続を切って復帰時に再接続、guacd側の更新抑制のいずれが用途に合うかを選ぶ。再接続は初期画像転送とログイン処理を追加する。

**5e. 同梱Guacamole JSの通信・復号・描画**

| 処理 | 確認結果 | 最適化に使える点 |
|---|---|---|
| WebSocketTunnel | テキスト命令をParserへ渡す | 独自binary形式へ変えるなら双方の実装変更が必要 |
| 生存確認 | ping頻度の内部定数は500ms | 空画面でも小さな通信は発生。引数で変更できる公開設定ではない |
| タイマー | 受信時にreceive/unstable/pingタイマーを更新 | 大量の細かいメッセージでは管理処理も増える |
| sendMouseState | 座標を倍率補正し、ローカルカーソルを先に移動 | 即応性は既に確保。統合時も維持する |
| `img/blob/end` | 画像ストリームを組み立て復号 | Base64による転送増と復号CPUがある |
| drawStream | ImageDecoder＋ReadableStreamを使える場合は利用 | 1.6.0にストリーム復号の経路が既にある |
| フォールバック | DataURIReaderとImageによる復号 | 端末・ブラウザによって性能が変わる |
| Display | 命令をタスク・フレームとして順序処理 | 未復号画像で後続の描画が待つ場合がある |
| sync | display.flush完了後に応答 | guacdの混雑推定に必要。即座に偽のACKを返さない |
| Client.onsync | sync受信時に通知 | 描画完了イベントではない。ここで描画遅延を確定しない |
| Display.statisticWindow | 既定0、現在利用なし | 有効化すると既存の統計APIを利用できる |
| Display.onstatistics | processingLag、client/server/desktop FPS、dropRate | 新たな画面ポーリングなしで計測可能 |

`processingLag` はブラウザで受信してから描画処理を終えるまでの指標であり、クリックからWindows反応までの全遅延ではない。統計のFPSも、画面が静止して更新がない場合には低くなる。低FPSだけで接続不良と判定しない。[Display公式ソース](https://github.com/apache/guacamole-client/blob/1.6.0/guacamole-common-js/src/main/webapp/modules/Display.js)、[Client公式ソース](https://github.com/apache/guacamole-client/blob/1.6.0/guacamole-common-js/src/main/webapp/modules/Client.js)。

ImageDecoderはSecure Contextを必要とする。LAN内の `http://IP:8443` と、HTTPS公開URLでは、同じブラウザでも利用できるAPIが違う可能性がある。localhostを含む実端末上で `window.isSecureContext`、`window.ImageDecoder` と復号形式を確認して比較する。[WebCodecs仕様](https://www.w3.org/TR/webcodecs/#imagedecoder-interface)。

この環境のChromiumで稼働appを開いて確認した結果、localhost HTTPではSecure Context=true、ImageDecoderあり、PNG/JPEG/WebP対応。非loopback IPのLAN HTTPではSecure Context=false、ImageDecoderなしだった。Windowsに接続せず、APIの可用性だけを調べた結果である。LANの最適化でもHTTPSを用意すると復号経路を改善できる可能性がある。直接LANとCloudflareの性能比較では、通信経路に加えてこの差も分けて測る。

Guacamole命令は画面全体を毎回送る単純なフレーム列ではなく、レイヤー・コピー・部分更新を含む。任意のblob・copy・syncを捨てると画面が壊れる。帯域制限をappのsleepや命令の破棄で実装すると、遅延蓄積や差分の不整合につながる。

**5f. HTML、CSS、配信ライブラリ、ビルド**

- HTMLはvendor JSを通常scriptで読み、その後ViteのUIモジュールを実行する。vendor取得・解析が初回表示に影響する。
- 同梱vendorは533,971 bytes。ローカルでgzip level 6にすると108,083 bytesだった。現Nodeサーバーはこれをgzip配信していない。CloudflareでHTTP資産が圧縮されるかは別途確認が必要。
- ViteビルドはUIを小さなハッシュ名JS/CSSにする。一方、public/vendorのファイルはそのままコピーされ、Viteによるminifyは適用されない。
- vendorには音声、ファイル/文字列/JSONストリーム、HTTP/Chained/Static tunnel、画面録画再生、スクリーンキーボード、直接Touch等の定義も含まれる。現UIはその多くを使わない。依存関係を守った必要モジュールのビルドやminifyは初回読み込みに有効だが、接続中のデスクトップ転送量は直接減らさない。
- CSSは画面のfit、touch-action、スクロール抑制等が中心。UI自体に常時動くアニメーションや重い描画処理はない。
- Dockerは2段ビルド、実行時にdev依存を含めない。ビルド最適化は起動・配信サイズの問題で、RDP画像生成の主因ではない。

同梱ファイルのトップレベル定義40個の一覧も確認した。定義があるだけで定期通信や録画が始まるわけではない。

| 種類 | 定義 | 現在の用途 |
|---|---|---|
| 接続・描画・基本型 | API_VERSION、Tunnel、WebSocketTunnel、Parser、Client、Display、Layer、Event、Status、IntegerPool、Position | 現在の接続・描画とその基盤 |
| 入力 | Keyboard、Mouse、Touch、OnScreenKeyboard、InputSink、KeyEventInterpreter | UIが直接使うのはKeyboard、MouseとMouse.Touchscreen。その他のUI・直接Touch・録画キー解釈は未使用 |
| ストリーム・データ | InputStream、OutputStream、DataURIReader、ArrayBufferReader、ArrayBufferWriter、BlobReader、BlobWriter、JSONReader、StringReader、StringWriter、UTF8Parser、Object | 画像受信に必要な経路と、未使用のファイル・任意データ機能が混在 |
| 音声 | AudioContextFactory、AudioPlayer、AudioRecorder、RawAudioFormat、RawAudioPlayer、RawAudioRecorder | 音声を交渉せず、出力・入力とも未使用 |
| 動画 | VideoPlayer | 動画形式を交渉せず未使用 |
| 別tunnel・録画再生 | HTTPTunnel、ChainedTunnel、StaticHTTPTunnel、SessionRecording | 現UIはWebSocketTunnelだけを使う。録画再生なし |

**6. WebSocket圧縮をどう扱うか**

現状の `perMessageDeflate: false` を設定可能にし、圧縮なしと低いzlib levelの圧縮ありを比較する価値がある。PNG/JPEG/WebP自体は圧縮済みでも、Base64化で画像のbyte数が概ね4/3に増えるため、テキストとしてさらに圧縮できる余地がある。画像の圧縮前byte数と比べた増加を回収する程度の場合もあり、大幅削減を前提にしない。

`ws` で検討できる設定は `threshold`、`zlibDeflateOptions.level`、`memLevel`、`concurrencyLimit`、`serverNoContextTakeover`、`clientNoContextTakeover`、window bits等。context takeoverは圧縮率とメモリ・セッション単位の状態保持のトレードオフ。単に高圧縮レベルを選ぶとCPU待ちが増える。[ws公式API](https://github.com/websockets/ws/blob/8.22.0/doc/ws.md#class-websocketserver)。

圧縮は接続確立時に交渉される。Cloudflareを通る経路でも `Sec-WebSocket-Extensions` が期待どおり交渉されたか確認する。接続中に単純なbooleanで有効・無効を切り替える構成にはしない。小さな独自統計・ping等はcompress:falseを使う候補。

現appのkbpsは圧縮前Buffer長を加算するので、圧縮を追加してもその表示値だけでは回線削減を評価できない。測る値を必ず分ける。

**7. 既存kbps表示の正確な意味**

`bytesSent × 8 / elapsedMilliseconds` の値はdecimal kbpsとして正しい。1秒intervalが正確でなくても実経過時間を使う。

ただし加算はWS send callback成功時、対象は送信前のUTF-8 payload byte数。Windows→guacdのRDP量、WSヘッダー、TLS、TCP/IP、Cloudflare Tunnelの外側は含めない。UUIDとecho pingは既定のmeasure=trueで含み、独自app-bitrate命令は除外する。厳密には「画面画像だけ」の量でもない。0表示でもping等の回線通信が完全にゼロになるわけではない。

必要な計測値は以下。

| 指標 | 取得場所 | 意味 |
|---|---|---|
| 上り/下りGuacamole payload bytes | app | 入力量と圧縮前描画量 |
| PNG/JPEG/WebPごとの画像byte量・個数 | appのimg/blob/end解析 | 実際に選ばれた形式と構成比 |
| WSメッセージ数・サイズ分布 | app | batchとヘッダー負担 |
| bufferedAmount、水位、停止時間、send callback待ち | app | ローカル中継の送信待ち |
| TCP writableLength、drain待ち | app | app→guacdの待ち |
| event loop delay/utilization、CPU、メモリ、GC | Node/Docker | 解析・圧縮・多重接続の負荷 |
| processingLag、FPS、dropRate | Display統計 | ブラウザ描画とguacd更新の状態 |
| browser↔app RTT | 独自の小さなecho計測等 | LAN/Cloudflare経路の往復時間 |
| guacd sync送信から返答までの時間 | app両方向のsync観測 | 転送・ブラウザ処理を含む応答時間 |
| 実回線bytesとパケット再送 | OS/インターフェース計測 | 圧縮後・ヘッダー込みの通信量 |
| input→Windows反応→画面表示時間 | 制御したWindowsテスト | 実操作の体感遅延 |

Docker Net I/Oはコンテナの複数通信をまとめた累積値なので、そのままブラウザ向け帯域にしない。Cloudflaredの累積値もトンネル維持や他セッションを含む。時計の違う端末のtimestampを単純に引いて片道遅延を算出しない。

**8. Compose、Cloudflare、Windows側**

Composeは現在guacd/app/cloudflaredの3サービス。READMEの「2サービス」は現構成とずれている。guacdはホストへ公開せず、app:8443だけを公開。Docker/WSLの構成次第でWindowsポート転送を通るが、READMEが参照する `scripts/enable-lan.ps1` は現在のワークスペースに存在しない。

`.env` のHOST/PORTはホスト側port mappingに使う。appコンテナ内はDockerfileのHOST=0.0.0.0、PORT=8443を使用するため、公開PORT変更をapp内部の待受ポート変更と混同しない。

cloudflaredはtoken指定、protocol選択の明示なし、imageはlatest。実際のQUIC/HTTP2選択、入口からappへの設定、地域・RTTはこのComposeだけでは確定しない。Cloudflare公式ではprotocol=auto/quic/http2を選べる。QUICを選んでもブラウザWebSocketやguacdのRDP設定がUDPに置き換わるわけではない。[Tunnel実行パラメータ](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)。

近距離LANでは直接appに接続する経路と、Cloudflare経由を別に測る。外部接続ではCloudflare入口・トンネル・Windowsまでの距離が追加される。HTTP資産のCDNキャッシュを調整しても、RDP画面のWebSocketストリームを同じようにキャッシュして速くすることはできない。[Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)。

Windows側では、画面内のアニメーション・壁紙・透明効果・動画再生・常時更新アプリ、RDPの画面サイズ要求が実際に適用されたか、GFXのネゴシエーション、CPU/GPU負荷を確認する。appのperformance flagsが現Windowsでどこまで反映されるかは実機で検証する。WindowsのGPU/映像ポリシーを変更してもブラウザ側の画像形式を直接選ぶことにはならない。

**9. 最小化する仕組みの設計案**

現構成を活かすなら、まず接続プロファイルを作り、接続開始時の設定と接続中に変えられる設定を区別する。

| 制御 | 接続中に変更 | 方針 |
|---|---|---|
| RDP解像度 | display-update対応時は可能 | 混雑時に段階的に低下。回復時はゆっくり上げる |
| ブラウザ表示倍率 | 可能 | 見やすさのため。帯域制御として数えない |
| mousemove頻度 | 可能 | 目的に応じて制限。クリック・キー・同期は維持 |
| 壁紙・テーマ・smooth font | 現アプリでは接続時 | 省通信プロファイルで設定 |
| GFX・color-depth | 接続時 | プロファイルを比較して採用 |
| PNG/JPEG/WebP対応形式 | handshake時 | ブラウザ対応と実測結果で選ぶ |
| WebSocket圧縮交渉 | 接続確立時 | プロファイル別に比較。頻繁に再接続しない |
| 任意のJPEG品質/FPS/kbps | 公開接続パラメータなし | 必要ならguacdの制御追加を検討 |

1. メトリクスを追加し、LAN/WAN、文字/動画、端末別の基準値を取得する。
2. WebP対応通知、装飾無効、解像度上限、TCP_NODELAYを個別に比較する。
3. send queueと描画processingLagの両方を見て解像度を調整する。単純な「kbpsが高いから低品質」では、回線が空いている場合も不要に劣化させる。
4. 混雑判定は数秒の移動平均・複数サンプルで行い、解像度の上昇は低下より遅くする。リサイズによる初期描画量も含めて評価する。
5. WebSocket圧縮の有無をCPU時間と実回線bytesで比較する。
6. なおCPUが支配的なら中継の再解析・コピーを最適化し、必要ならguacdの画像品質や更新頻度の制御に進む。

遅延と画質・通信量はトレードオフを持つので、文字の可読性と必要な操作感を下限条件にする。GUIの大きさまで変わる動的リサイズが受け入れられない場合は、固定解像度の接続プロファイルを優先する。

**10. 推奨する実装順と検証**

| 優先 | 変更 | 検証すること |
|---|---|---|
| 1 | 統計・RTT・送信待ち・実byte計測 | 現在どの区間が支配的か |
| 2 | WebPを対応通知 | 使用形式、帯域、guacd CPU、端末復号、文字品質 |
| 2 | 壁紙・テーマを無効化しsmooth fontを比較 | Windowsでの適用と可読性 |
| 2 | 解像度上限・面積上限・プリセット | 小画面/大画面で操作できるか |
| 2 | app→guacdにTCP_NODELAY | 入力・sync遅延と小パケット増 |
| 2 | LANでのHTTPSと復号API確認 | ImageDecoder経路、画像復号時間、通信経路との差 |
| 3 | display-update＋sendSize | 連続resize、復帰、文字入力、マウス座標 |
| 3 | 水位を分けた背圧、待ち時間に応じた制御 | 低帯域・高RTT時に古い画面がたまらないか |
| 3 | mousemove統合 | drag、wheel、タッチ、描画アプリ、ローカルカーソル |
| 3 | WebSocket圧縮の比較 | 圧縮後bytes、CPU待ち、Cloudflare経由の交渉 |
| 4 | vendor minify、静的圧縮、キャッシュ | 初回表示と再訪の転送量 |
| 4 | 解析・文字列コピー削減 | 高更新時CPU/GCとUnicode/分割命令の互換性 |
| 条件付き | GFXなし＋16bpp | 同じWindows/操作でGFX標準と比較 |
| 条件付き | guacd改修による品質/FPS/帯域目標 | 公開設定だけでは不足した場合 |

比較は同じ画面サイズ・同じ操作・同じ経路で、一度に1項目ずつ変更する。静止10秒、文字入力、スクロール、ウィンドウ移動、動画、非表示/復帰を各シナリオとして、通信総量、遅延中央値/p95、CPU、画質を記録する。通信量を減らした結果、入力や描画が遅くなった変更は、その経路用プロファイルから除外する。

今回の既存テストでは、低帯域の長時間背圧、圧縮あり、WebP実画像、動的RDP resize、実Windows上のGFX、実Cloudflare経路の性能は検証していない。実装時には変更対象に合わせてこれらを確認する。
