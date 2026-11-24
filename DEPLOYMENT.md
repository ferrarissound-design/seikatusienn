# iPhoneからの設定・公開手順

本手順はGitHub、Supabase、VercelのWeb管理画面を使います。Windows/Macは不要です。画面名はサービスの更新で変わる場合があります。iPhoneではSafariの「デスクトップ用Webサイトを表示」が必要な画面があります。

既存の公開先は https://ferrarissound-design.github.io/seikatusienn/ です。今回の表示不具合は、GitHub Pagesの標準Jekyll配信がViteのビルドをせず、`/src/main.tsx`を参照する開発用HTMLを公開していたことが原因です。GitHub Actionsでビルドした`dist`の配信へ切り替えます。

この修復は既存の公開GitHubリポジトリとPagesを使用し、**有料プランの契約や課金設定の変更は行いません**。Vercelでの新規公開や有料サービス契約は、別途内容・料金を確認し、開発者の承認後に行ってください。

## 1. GitHubでコードを確認

1. Safariで https://github.com/ferrarissound-design/seikatusienn を開きます。名前は`seikatusienn`です。
2. 変更ブランチ・Pull Requestがある場合、内容とGitHub Actionsの結果を確認します。
3. GitHub Pagesの公開対象は`main`です。Vercelでは選択した公開ブランチにそろえます。`.env`、秘密鍵、実際の個人データをコミットしません。
4. ローカルモードだけを公開する場合は、Supabaseの手順を省略できます。クラウドバックアップがない旨を利用者に説明してください。

## 2. Supabaseを設定（任意）

1. Safariで https://supabase.com/dashboard にログインします。新規プロジェクトの作成画面でプラン・費用・リージョンを確認します。有料契約を選ぶ前に承認を得ます。
2. プロジェクトのSQL Editorを開き、GitHub上の`supabase/schema.sql`の内容をコピーして実行します。
3. 続けて`supabase/rls.sql`を実行します。失敗した場合はそのまま公開せず、エラーを確認してください。
4. Table EditorまたはSQL Editorで`life_partner_records`と`life_partner_mutations`のRLSが有効であることを確認します。
5. Project Settings → API（またはConnect/API Keys）でProject URLと**公開用のanon key / publishable key**を確認します。管理者用の`service_role`・secret keyはフロントエンドに設定しません。
6. Authentication → URL Configurationに、公開後のHTTPS URLをSite URLとして登録します。Redirect URLsにも同じURLを登録します。プレビューURLを使う場合は必要なものだけ追加してください。
7. Authentication → ProvidersでEmailを確認します。メール確認を有効にする場合、登録後に届く確認メールを開く必要があります。実際のメール配送制限・SMTP設定も確認してください。

## 3. GitHub Pagesで公開・修復（現在のURL）

1. Safariでリポジトリを開き、Settings → Pagesへ進みます。このリポジトリはAPI上で既にSourceが**GitHub Actions**であることを確認済みのため、設定変更は不要です。別のリポジトリで導入するときはGitHub Actionsを選びます。「Deploy from a branch」で開発用のリポジトリルートを配信しないでください。
2. `.github/workflows/pages.yml`を含む修正を`main`へ反映します。pushすると「Deploy GitHub Pages」が自動実行されます。手動ではActions → Deploy GitHub Pages → Run workflow → `main`を選びます。
3. ワークフローはNode.js 24で`npm ci`、`npm test`、`npm run build`を実行し、生成された`dist`をPagesへ送ります。テストやビルドが失敗した場合は公開に進みません。
4. `VITE_BASE_PATH`はリポジトリ名から`/seikatusienn/`を設定します。アセット、Manifest、アイコン、Service Workerも同じサブパスを使います。Vercelのルート配信は引き続き使用できます。
5. Actionsのbuild/deployが成功した後、https://ferrarissound-design.github.io/seikatusienn/ を開いて確認します。古い画面の場合は更新を確認します。表示の修復のために利用者のIndexedDBやSafariの全データを削除する必要はありません。
6. クラウド同期を使わない場合、追加の環境変数は不要です。使う場合はGitHubのSettings → Secrets and variables → Actions → **Variables**に`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`を登録して再実行します。公開用キーのみを使用し、`service_role`・secret keyは置かないでください。
7. SupabaseのSite URL / Redirect URLsを、サブパスを含む`https://ferrarissound-design.github.io/seikatusienn/`に設定します。

このワークフローは`main`へのpushと手動実行にのみ対応し、Pull Requestの未確認コードをPagesへ公開しません。`github-pages`環境の承認ルールが設定されている場合、Actions上で必要な承認を行ってください。追加の有料プランはこの設定に必要ありません。

カスタムドメインを将来使う場合は、配信先のパスに合わせて`VITE_BASE_PATH`の設定も見直してください。URLを変更すると別オリジンのIndexedDBになる場合があるため、先にJSONバックアップを保存します。

## 4. Vercelから公開

1. Safariで https://vercel.com にログインし、GitHubとの連携を許可します。必要最小限のリポジトリアクセスにします。
2. Add New → Projectで **`ferrarissound-design/seikatusienn`** を選びます。似た名前のリポジトリを選ばないでください。
3. Framework PresetはVite、Root Directoryはリポジトリ直下、Build Commandは`npm run build`、Output Directoryは`dist`です。
4. クラウド同期を使う場合、Environment Variablesに次の2つだけを追加します。

   | 名前 | 値 |
   | --- | --- |
   | `VITE_SUPABASE_URL` | SupabaseのProject URL（HTTPS） |
   | `VITE_SUPABASE_ANON_KEY` | Supabaseの公開用anon / publishable key |

5. **料金と公開範囲を確認し、承認後にDeployを押します。** 公開URL自体へのアクセス制限はこのアプリのログインとは別です。アプリ本体は公開されても、RLSにより個人のクラウド記録は本人に限定されます。
6. 完了後のURLを開き、設定画面で保存・同期状態を確認します。環境変数を後で変更した場合は再デプロイが必要です。
7. SupabaseのSite URL / Redirect URLsをこのURLに合わせます。GitHubへの以降のpushで自動デプロイされる設定も確認してください。

## 5. アカウント削除用Edge Function

クラウド内の記録削除RPCと、認証アカウント自体の削除は別です。後者には`delete-account` Edge Functionの配置が必要です。

1. Supabase Dashboard → Edge Functionsで新規関数を作成します。ブラウザーのコード編集機能が利用できる場合は名前を`delete-account`にします。
2. `supabase/functions/delete-account/index.ts`をコピーして配置します。環境にブラウザー編集が提供されていなければ、iPhoneから操作できるGitHub Codespaces等のクラウドターミナルでSupabase CLIを使えます。サービスの利用制限・費用を先に確認してください。
3. サーバー環境に`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`が存在することを確認します。通常Supabase側で提供されます。秘密鍵を`VITE_`付きにしたりGitHubへ記載したりしません。
4. JWT検証は有効にします。関数内でも`auth.getUser`でトークンを検証します。任意の利用者IDを指定して削除するAPIではありません。
5. 架空データを持つテストアカウントで、設定の削除確認から実行して検証します。実際のアカウントを試験用に削除しないでください。

CLIを使う場合の例（クラウドターミナル内で認証済みであること）:

```sh
supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF
```

秘密鍵をコマンド引数やチャットへ貼る必要はありません。

## 6. 公開前の確認

- `npm test`、`npm run build`とGitHub Actionsの成功を確認。
- 実Supabaseで2人のテストユーザーを作り、他人のレコードを読めない・書けないことを確認。
- 同一ユーザーの2端末で同期・競合・オフライン復帰・削除を確認。
- [IPHONE_TEST.md](IPHONE_TEST.md)の実機項目を確認。
- JSONバックアップを安全な場所に保存でき、復元できることを確認。
- 時刻指定Web Pushは未実装であることを利用者に説明。

## 更新

更新前にJSONバックアップを保存します。Service Workerのキャッシュ更新とIndexedDBのデータ削除は別です。表示が古いだけの場合に利用者データを削除して解決しようとしないでください。データベースの変更時はバージョン付き移行と既存データの保持を確認します。

## 問題が起きたら

- 同期できない: HTTPS、Project URL、公開キー、SQL適用、認証状態、メール確認、ネットワークを確認。端末内の記録は削除しないでください。
- メールが来ない: 迷惑メール・メール配送制限・SupabaseのAuth設定を確認。
- アカウント削除できない: Edge Functionの配置とサーバー環境変数を確認。クライアントに管理者鍵を追加しないでください。削除結果が不明な場合は端末内の削除処理中の印により同期を止めます。必要なJSONを保存し、対象を再確認して同じ削除を再試行します。
- GitHub Pagesが真っ白: Settings → PagesのSourceがGitHub Actionsか、「Deploy GitHub Pages」のbuild/deployが成功しているか確認します。ページソースに`/src/main.tsx`が残っていれば開発用ソースが配信されています。`dist`の配信へ切り替えてください。
- PWAが開けない: オンラインで一度開き直し、キャッシュ完了後に機内モードを試します。初回アクセス前のオフライン起動はできません。

## ブラウザー自動試験（別の検証環境）

`e2e/life-partner.spec.ts`はPlaywrightの試験ソースです。現在のクラウド環境ではプレビュー接続が利用できず、**ブラウザー試験は実行していません**。iPhone実機検証の代わりにはなりません。

ブラウザーと試験用サーバーを利用できる環境で、次を行います。

1. `npm ci`、`npm run build`を実行します。
2. PlaywrightのChromium/WebKitを利用可能にします。必要なら`npx playwright install --with-deps chromium webkit`を実行します。
3. 本番ビルドをHTTPSの試験用URL（またはlocalhost）で配信します。開発用ViteではService Workerが登録されないためオフライン起動試験はできません。
4. 配信済みの検証用URLを指定して実行します。設定ファイルはサーバーを自動起動しません。

```sh
PW_BASE_URL=https://YOUR-TEST-URL npm run test:e2e
```

各試験は新規のブラウザー領域で架空データのみを登録します。実際の記録やログイン済みの本番ブラウザーセッションを使わないでください。再読み込み、タブ再起動、オフライン記録・再起動、JSON不正入力・重複を増やさない復元、支出記録、モバイルナビゲーションを対象とします。失敗時のスクリーンショット・traceには入力した架空データが含まれます。`playwright-report/`、`test-results/`はGit管理から除外しています。
