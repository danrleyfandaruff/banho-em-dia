import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase';
import {
  analyzeFinance,
  csvReceipts,
  METHOD_LABELS,
  PLAN_LABELS,
  type FinanceRow,
} from '@/lib/financial-analytics';
import { businessDate, dayCount, validDate } from '@/lib/finance-date';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const today = businessDate();
  const start = params.get('start') ?? `${today.slice(0, 7)}-01`;
  const end = params.get('end') ?? today;
  const plan = params.get('plan') ?? 'all';
  const method = params.get('method') ?? 'all';
  if (
    !validDate(start) ||
    !validDate(end) ||
    start > end ||
    end > today ||
    dayCount(start, end) > 366 ||
    (plan !== 'all' && !Object.hasOwn(PLAN_LABELS, plan)) ||
    (method !== 'all' && !Object.hasOwn(METHOD_LABELS, method))
  ) {
    return Response.json({ error: 'invalid_period' }, { status: 400 });
  }
  try {
    const admin = createSupabaseAdmin();
    const rows: FinanceRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin
        .from('appointments')
        .select(
          'id,group_id,client_id,pet_id,owner_name,dog_name,plan_type,paid,amount_cents,payment_method,payment_details,scheduled_date,scheduled_time,status,services,session_number,created_at',
        )
        .order('id')
        .range(offset, offset + 999)
        .overrideTypes<FinanceRow[], { merge: false }>();
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const report = analyzeFinance(rows, { start, end, plan, method }, today);
    if (params.get('format') === 'csv')
      return new Response(csvReceipts(report.receipts), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="recebimentos-${start}-${end}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1));
    const total = report.receipts.length;
    const totalPages = Math.max(1, Math.ceil(total / 25));
    const safePage = Math.min(Math.floor(page), totalPages);
    return Response.json(
      {
        ...report,
        customers: report.customers.slice(0, 10),
        receipts: report.receipts.slice((safePage - 1) * 25, safePage * 25),
        pagination: { page: safePage, totalPages, total },
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'analytics_unavailable' }, { status: 500 });
  }
}
