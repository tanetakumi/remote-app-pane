# Guacamole JavaScript 1.6.0

Apache の公式リポジトリの `guacamole-common-js/src/main/webapp/common/license.js` と
`modules/*.js`（ファイル名順）を連結しています。
このディレクトリの `LICENSE` / `NOTICE` は Guacamole の同梱ライセンスです。

- ソース: https://github.com/apache/guacamole-client/tree/1.6.0/guacamole-common-js
- 取り込み元: https://codeload.github.com/apache/guacamole-client/tar.gz/refs/tags/1.6.0
- アーカイブ SHA-256: `de5c489471544f93dfc0cc821cf95805aaf9b84e2e3314b6d52e41aeeffd7c16`
- 連結 JS SHA-256: `0ed08efab099807a60a09f7a85e3a9f790350e0648cf8662ab68fb7deb54d154`

元の連結JSは変更せず、appのビルド時にVite同梱のminifierでscriptとしてminifyします。
生成物は先頭のApacheライセンスを保持し、内容ハッシュ付きファイル名でdistへ出力します。
同梱のLICENSE/NOTICEも引き続き配信します。上記SHA-256は変換前のファイルの値です。
