import { env } from 'cloudflare:workers';
import { requireAdmin } from '@/lib/auth';

type AuditRow = {
  id: string;
  actor_email: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  description: string;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const results = await env.DB.prepare(`SELECT
    id, actor_email, actor_name, action, entity_type, entity_id, description, created_at
    FROM audit_logs ORDER BY created_at DESC LIMIT 150`)
    .all<AuditRow>();
  return Response.json({
    logs: results.results.map((row) => ({
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
