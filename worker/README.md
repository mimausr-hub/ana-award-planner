# seats.aero 中継 Worker（Cloudflare Workers）

GitHub Pages に置いたサイトから seats.aero の API を使うための中継です。seats.aero はブラウザからの直接呼び出し（CORS）を許可していないため、サーバー側で API キーを付けて中継する必要があります。ローカルの `serve.py` と同じ役割を、無料の Cloudflare Workers で常時動かします。

## 初回だけ（5 分）
1. Cloudflare のアカウントを作る（無料）: https://dash.cloudflare.com/sign-up
2. このフォルダで次を実行（Node.js が必要。`npx` で wrangler を都度実行する）
   ```bash
   cd worker
   npx wrangler login                      # ブラウザが開くので Cloudflare にログイン
   npx wrangler secret put SEATS_AERO_KEY  # seats.aero Pro の API キーを貼り付け
   npx wrangler secret put PROXY_TOKEN     # 好きな合言葉（サイトの設定タブに同じものを入れる）
   npx wrangler deploy                     # https://ana-award-proxy.<あなたのsubdomain>.workers.dev が表示される
   ```
3. `wrangler.toml` の `ALLOWED_ORIGINS` に GitHub Pages の URL（`https://<ユーザー名>.github.io`）が入っているか確認。違う場合は書き換えて `npx wrangler deploy` し直す
4. サイトの「設定」タブ → 「中継サーバー（Cloudflare Worker）」に、表示された URL と合言葉を入れる

以降はサイトを開くだけで検索できます。ローカルの `python3 serve.py` は不要です。

## 他の人に使ってもらうとき
通常のサイトURLと合言葉を別々に伝えてください。初回アクセス時に入力画面が出ます。APIキーは渡さないでください。APIキー持ち込みによる認証は廃止しました。

合言葉は `wrangler secret put PROXY_TOKEN` で変更します。新しい合言葉はAPIキーとは別の値にしてください。以前の合言葉は直ちに使えなくなります。

## 仕組み
- API キーは Worker の secret に置き、サイト側（公開リポジトリ・ブラウザ）には置かない
- 許可した Origin にだけ CORS を返す。合言葉が一致しない呼び出しは 401
- seats.aero の残回数ヘッダーはそのまま返すので、サイトの「本日の残り」表示も動く
- 無料枠は 1 日 10 万リクエスト。seats.aero の 1 日 1,000 回より十分大きい
