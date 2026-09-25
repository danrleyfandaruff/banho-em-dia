import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('audit_logs')
    .select('id,actor_email,actor_name,action,entity_type,entity_id,description,created_at')
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) throw error;
  return Response.json({
    logs: (data ?? []).map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      description: row.description,
      createdAt: row.created_at,
    })),
  });
}
