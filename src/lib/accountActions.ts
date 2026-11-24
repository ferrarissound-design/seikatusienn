import { clearOwner, db } from "./db";
import { pauseSyncOwner } from "./sync";

/** Keep a durable barrier if server deletion has an uncertain result or local cleanup fails. */
export async function deleteCloudScope(
  owner: string,
  deleteRemote: () => Promise<void>,
  signOut: () => Promise<void>,
  accountDeleted = false,
): Promise<void> {
  if (owner === "local")
    throw new Error("クラウドの削除にはログインが必要です");
  const release = await pauseSyncOwner(owner);
  try {
    // Persist first: a storage failure must not trigger an irreversible remote deletion.
    await db.meta.put({
      key: `${owner}:deletionPending`,
      value: new Date().toISOString(),
    });
    try {
      await deleteRemote();
    } catch {
      throw new Error(
        "削除の完了を確認できませんでした。安全のため、このアカウントの同期を停止しています。必要ならJSONバックアップを保存してから、同じ削除操作を再試行してください。",
      );
    }
    let localCleared = true;
    let signedOut = true;
    try {
      await clearOwner(owner);
    } catch {
      localCleared = false;
    }
    // Always sign out, even if deleting IndexedDB fails after server confirmation.
    try {
      await signOut();
    } catch {
      signedOut = false;
    }
    if (!localCleared)
      throw new Error(
        "クラウドの削除は完了しましたが、端末の記録削除を完了できませんでした。このアカウントの同期は停止しています。" +
          (accountDeleted
            ? "端末内の残った記録を消す場合は、他の必要なローカル記録を先にJSON保存し、Safariの設定からこのサイトのデータを削除してください。"
            : "空き容量とブラウザ設定を確認し、再ログイン後に同じ削除操作を再試行してください。"),
      );
    if (!signedOut)
      throw new Error(
        "クラウドと端末の記録は削除しました。ログアウトを完了できなかったため、設定からログアウトしてください。",
      );
  } finally {
    release();
  }
}
