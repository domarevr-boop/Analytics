import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';

type Action = 'me' | 'bootstrap' | 'list-users' | 'create-user' | 'update-user' | 'delete-user' | 'list-sessions' | 'log-session-event';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const adminEmail = (Deno.env.get('ADMIN_EMAIL') || '').toLowerCase();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Function not configured' }, 500);

  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json({ error: 'Missing token' }, 401);

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  const user = userData.user;

  const { count: adminCount } = await client.from('app_admins').select('*', { count: 'exact', head: true });
  const { data: adminRow } = await client.from('app_admins').select('user_id,email').eq('user_id', user.id).maybeSingle();
  const isAdmin = !!adminRow;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action as Action | undefined;
  if (!action) return json({ error: 'Missing action' }, 400);

  const requireAdmin = () => {
    if (!isAdmin) return json({ error: 'Admin only' }, 403);
    return null;
  };

  if (action === 'me') {
    return json({
      isAdmin,
      adminCount: adminCount ?? 0,
      bootstrapAllowed: (adminCount ?? 0) === 0 && !!adminEmail && user.email?.toLowerCase() === adminEmail,
      email: user.email,
    });
  }

  if (action === 'bootstrap') {
    if ((adminCount ?? 0) > 0) return json({ error: 'Admin already exists' }, 400);
    if (!adminEmail || user.email?.toLowerCase() !== adminEmail) return json({ error: 'Email is not allowed' }, 403);
    const { error } = await client.from('app_admins').insert({ user_id: user.id, email: user.email ?? adminEmail });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  const denied = requireAdmin();
  if (denied) return denied;

  if (action === 'list-users') {
    const { data, error } = await client.auth.admin.listUsers();
    if (error) return json({ error: error.message }, 400);
    return json({ users: (data.users || []).map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      updated_at: u.updated_at,
      confirmed_at: u.confirmed_at,
    })) });
  }

  if (action === 'create-user') {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) return json({ error: 'Missing email or password' }, 400);
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: !!data.user });
  }

  if (action === 'update-user') {
    const userId = String(body.userId || '');
    const email = body.email ? String(body.email).trim() : undefined;
    const password = body.password ? String(body.password) : undefined;
    if (!userId) return json({ error: 'Missing userId' }, 400);
    const { error } = await client.auth.admin.updateUserById(userId, {
      email: email || undefined,
      password: password || undefined,
      email_confirm: email ? true : undefined,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'delete-user') {
    const userId = String(body.userId || '');
    if (!userId) return json({ error: 'Missing userId' }, 400);
    const { error } = await client.from('app_admins').delete().eq('user_id', userId);
    if (error) return json({ error: error.message }, 400);
    const { error: delError } = await client.auth.admin.deleteUser(userId);
    if (delError) return json({ error: delError.message }, 400);
    return json({ ok: true });
  }

  if (action === 'list-sessions') {
    const { data, error } = await client.from('auth_session_events').select('id,user_id,email,event,created_at').order('created_at', { ascending: false }).limit(500);
    if (error) return json({ error: error.message }, 400);
    return json({ logs: data || [] });
  }

  if (action === 'log-session-event') {
    const event = String(body.event || '');
    if (!event) return json({ error: 'Missing event' }, 400);
    const { error } = await client.from('auth_session_events').insert({
      user_id: user.id,
      email: user.email,
      event,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
