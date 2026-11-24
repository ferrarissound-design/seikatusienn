import { defineConfig, devices } from "@playwright/test";

// 既に起動している検証用URLを明示してください。この設定はサーバーを起動しません。
// 例: PW_BASE_URL=https://your-test-deployment.example npm run test:e2e
// 本番・実データのあるブラウザーセッションは使用しません。
const baseURL = process.env.PW_BASE_URL;
if (!baseURL)
  throw new Error(
    "PW_BASE_URLに検証用URLを指定してください。PWA試験には本番ビルドとHTTPS（またはlocalhost）が必要です。",
  );

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
