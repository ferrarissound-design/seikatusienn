import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// 架空データのみ。各テストの新規ブラウザーコンテキストでIndexedDBを分離します。
async function openSection(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function addTask(page: Page, title: string, steps: string[] = []) {
  await openSection(page, "タスク");
  await page.getByRole("button", { name: "タスクを追加", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "タスクを追加",
    exact: true,
  });
  await dialog.getByLabel("タスクの名前", { exact: true }).fill(title);
  for (const step of steps) {
    await dialog.getByLabel("追加する作業", { exact: true }).fill(step);
    await dialog
      .getByRole("button", { name: "作業を追加", exact: true })
      .click();
  }
  await dialog.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function uploadBackup(page: Page, content: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "life-partner-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(content, "utf8"),
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "メインナビゲーション" }),
  ).toBeVisible();
  const skip = page.getByRole("button", {
    name: "あとで設定する",
    exact: true,
  });
  if (await skip.isVisible()) {
    await skip.click();
    await expect(skip).toBeHidden();
  }
});

test("小さな作業の状態が再読み込みとタブ再起動後にも残る", async ({
  page,
  context,
  baseURL,
}) => {
  await addTask(page, "架空の部屋を整える", [
    "架空のゴミを集める",
    "架空の机を拭く",
  ]);
  await page
    .getByRole("checkbox", { name: "架空のゴミを集める", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "架空のゴミを集める", exact: true }),
  ).toBeChecked();
  await page.reload();
  await openSection(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "架空の部屋を整える", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "架空のゴミを集める", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "架空の机を拭く", exact: true }),
  ).not.toBeChecked();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(baseURL!);
  await openSection(reopened, "タスク");
  await expect(
    reopened.getByRole("checkbox", { name: "架空のゴミを集める", exact: true }),
  ).toBeChecked();
});

test("本番PWAをオフラインで開き直し、未接続中の記録を保持する", async ({
  page,
  context,
  baseURL,
}) => {
  // 開発用ViteではService Workerを登録しないため、本番ビルドの配信が必要。
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && navigator.serviceWorker.controller);
  });
  await context.setOffline(true);
  await addTask(page, "架空のオフライン作業");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(baseURL!, { waitUntil: "domcontentloaded" });
  await expect(
    reopened.getByText("オフライン · 端末に保存", { exact: true }),
  ).toBeVisible();
  await openSection(reopened, "タスク");
  await expect(
    reopened.getByRole("heading", {
      name: "架空のオフライン作業",
      exact: true,
    }),
  ).toBeVisible();
  await addTask(reopened, "架空の再起動後の作業");
  await context.setOffline(false);
  await reopened.reload();
  await openSection(reopened, "タスク");
  await expect(
    reopened.getByRole("heading", {
      name: "架空のオフライン作業",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", {
      name: "架空の再起動後の作業",
      exact: true,
    }),
  ).toBeVisible();
});

test("不正なJSONを拒否して既存の記録を保持する", async ({ page }) => {
  await addTask(page, "架空の残しておく作業");
  await openSection(page, "設定");
  await uploadBackup(page, '{"invalid":');
  await expect(
    page.getByText("JSON形式のファイルを選んでください", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "復元前の確認", exact: true }),
  ).toBeHidden();
  await uploadBackup(
    page,
    JSON.stringify({ format: "unrelated-data", version: 1, records: [] }),
  );
  await expect(
    page.getByText("Life Partnerのバックアップ形式を確認してください", {
      exact: true,
    }),
  ).toBeVisible();
  await openSection(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "架空の残しておく作業", exact: true }),
  ).toBeVisible();
});

test("JSON出力から重複を増やさず既存データを残して復元する", async ({
  page,
}) => {
  await addTask(page, "架空の既存作業");
  await openSection(page, "設定");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSONを保存", exact: true }).click(),
  ]);
  const filePath = await download.path();
  if (!filePath) throw new Error("JSONファイルを取得できませんでした");
  const backup = JSON.parse(await readFile(filePath, "utf8"));
  const source = backup.records.find(
    (record: { kind: string }) => record.kind === "task",
  );
  expect(source).toBeTruthy();
  // 正規の出力形式を使用し、既存と新規の架空レコードを混在させる。
  backup.records = [
    source,
    {
      ...source,
      id: randomUUID(),
      data: { ...source.data, title: "架空の復元で追加した作業" },
    },
  ];
  backup.conflicts = [];
  const content = JSON.stringify(backup);
  await uploadBackup(page, content);
  await expect(
    page.getByRole("heading", { name: "復元前の確認", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/新しく取り込む記録：1件/)).toBeVisible();
  await expect(page.getByText(/同じ内容の記録：1件/)).toBeVisible();
  await page
    .getByRole("button", { name: "確認して取り込む", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "復元前の確認", exact: true }),
  ).toBeHidden();
  await openSection(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "架空の既存作業", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "架空の復元で追加した作業",
      exact: true,
    }),
  ).toHaveCount(1);
  await openSection(page, "設定");
  await uploadBackup(page, content);
  await expect(page.getByText(/新しく取り込む記録：0件/)).toBeVisible();
  await expect(page.getByText(/同じ内容の記録：2件/)).toBeVisible();
  await page
    .getByRole("button", { name: "確認して取り込む", exact: true })
    .click();
  await openSection(page, "タスク");
  await expect(
    page.getByRole("heading", { name: "架空の既存作業", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "架空の復元で追加した作業",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("金額とカテゴリーを登録し、再読み込み後に確認する", async ({ page }) => {
  await openSection(page, "お金");
  await page.getByRole("button", { name: "記録する", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "お金を記録", exact: true });
  await dialog.getByLabel("金額（円）", { exact: true }).fill("680");
  await dialog.getByRole("button", { name: "日用品", exact: true }).click();
  await dialog
    .getByLabel("メモ（任意）", { exact: true })
    .fill("架空のテスト支出");
  await dialog.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await openSection(page, "お金");
  await expect(
    page.locator(".list-row").filter({ hasText: "架空のテスト支出" }),
  ).toContainText("680");
  await expect(
    page.locator(".list-row").filter({ hasText: "架空のテスト支出" }),
  ).toContainText("日用品");
});

test("モバイルナビゲーションの各画面を操作できる", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  for (const name of ["ホーム", "忘れ物", "タスク", "お金", "設定"]) {
    const button = nav.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
