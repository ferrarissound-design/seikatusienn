// Supabase Edge Function. 秘密鍵はサーバーの環境変数のみ。ブラウザーに配布しません。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const reply = (status: number, error?: string) => new Response(JSON.stringify(error ? { error } : { success: true }), { status, headers });
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, 'POST required');
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, 'Authentication required');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply(503, 'Server configuration required');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // JWTを文字列として信用せず、認証サーバーで検証。リクエストのuser IDは受け取りません。
  const { data: { user }, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !user) return reply(401, 'Authentication required');
  try {
    const body = await request.json();
    if (body?.confirmation !== 'DELETE') return reply(400, 'Explicit confirmation required');
  } catch { return reply(400, 'Invalid JSON'); }
  const { error: deletionError } = await admin.auth.admin.deleteUser(user.id);
  // auth.users外部キーのON DELETE CASCADEで本人のデータとACKも削除。
  if (deletionError) return reply(500, 'Account deletion failed');
  return reply(200);
});
