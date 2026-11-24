# 変更履歴

## 0.1.1 — GitHub Pages表示修復

- GitHub Pagesで開発用HTMLがそのまま配信され、アプリが起動しない原因を修正。
- `main`のテスト・Viteビルド後に`dist`を配信するPagesワークフローを追加。
- `/seikatusienn/`への配信に合わせ、アセット・Manifest・Service Workerのベースパスに対応。
- 既存のGitHub Pages URLを修復する設定手順を追加。Vercel対応も維持。
- 有料プランの契約や課金設定の変更は行わない。

配信・動作確認の結果は`TEST_REPORT.md`に記載します。

## 0.1.0 — 2026-11-24

- `seikatusienn`にLife Partnerの初期実装を追加。
- React / TypeScript / Vite、Dexie永続保存、PWAの土台を作成。
- ホーム、忘れ物チェック、タスク、お金、設定の各画面を追加。
- 整数円の予算計算、ローカルバックアップ・復元、CSV出力を追加。
- 任意のSupabase認証・同期、競合保持、RLS SQLとアカウント削除用関数を追加。
- 自動テスト、CI、本番ビルド、iPhone向け公開・操作・検証資料を追加。

このバージョンは初期実装です。実SupabaseとiPhone実機の検証、時刻指定Web Pushの配信スケジューラーは完了していません。本番公開は実施していません。
