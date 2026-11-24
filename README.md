# Life Partner

生活支援アプリ。忘れ物チェック、タスク、お金の見通しを1つのPWAで管理します。リポジトリ名は **`seikatusienn`** です。

React / TypeScript / Vite / Dexie（IndexedDB）/ Supabase。iPhoneのSafariからホーム画面に追加して使用でき、Androidにも対応する設計です。医療上の診断・治療を目的としません。

## 開発

Node.js 24を使用します。

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
# Dockerがある場合のSQL/RLS回帰試験（実Supabaseへは接続しません）
bash supabase/tests/run.sh
```

`localhost`以外ではPWA・通知などにHTTPSが必要です。開発サーバーのネットワーク公開だけでiPhoneのPWAテストを完了したことにはなりません。

## 保存とバックアップ

アカウントなしでも端末内に記録を保存します。架空の金銭記録を初期データとして自動登録しません。データと同期キューを同じIndexedDBトランザクションで保存し、クラウドへの保存確認後に同期完了とします。通信のない間も記録できます。

**端末内保存はバックアップではありません。** PWAの削除、端末の故障、OSによるストレージ削除などで失われる可能性があります。設定画面からJSONバックアップを定期的に保存してください。JSONやCSVには個人情報が含まれるため、安全な保存先を選んでください。

クラウド同期にはSupabaseの設定が必要です。`.env.example`を参考に`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`を設定し、SQLを適用します。`service_role`や秘密鍵はブラウザー・GitHubに含めません。手順は[DEPLOYMENT.md](DEPLOYMENT.md)をご覧ください。

## 対応範囲と検証

ローカル記録、タスクの分解・集中モード、チェックリスト、整数円での予算計算、バックアップ・復元、同期のクライアント実装とサーバーSQLを含みます。Supabase接続、複数端末、RLS実行、アカウント削除には実サービスでの検証が必要です。

**時刻指定Web Pushのサーバースケジューラーは未実装です。** アプリを開いている際の通知案内を代替手段とします。アプリを閉じた状態で指定時刻に届く通知は保証しません。iPhone実機確認もクラウド環境からは実施できません。実施済みと未検証の区別は[TEST_REPORT.md](TEST_REPORT.md)に記載します。

有料サービスの契約・本番公開は行っていません。Vercelでの公開前に利用者自身の承認・設定が必要です。

## ドキュメント

- [使い方](USER_GUIDE.md)
- [構成と設計](ARCHITECTURE.md)
- [データベースと同期](DATABASE.md)
- [セキュリティとプライバシー](SECURITY.md)
- [公開手順](DEPLOYMENT.md)
- [テスト結果](TEST_REPORT.md)
- [iPhone実機確認](IPHONE_TEST.md)
- [変更履歴](CHANGELOG.md)

GitHub: https://github.com/ferrarissound-design/seikatusienn
