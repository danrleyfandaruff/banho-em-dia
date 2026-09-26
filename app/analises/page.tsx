import { FinancialDashboard } from '@/components/financial-dashboard';
import { businessDate, dayCount, validDate } from '@/lib/finance-date';
import { METHOD_LABELS, PLAN_LABELS } from '@/lib/financial-analytics';

export default async function AnalysesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = businessDate();
  const start = params.start;
  const end = params.end;
  const valid =
    validDate(start) &&
    validDate(end) &&
    start <= end &&
    end <= today &&
    dayCount(start, end) <= 366;
  const plan =
    typeof params.plan === 'string' && Object.hasOwn(PLAN_LABELS, params.plan)
      ? params.plan
      : 'all';
  const method =
    typeof params.method === 'string' &&
    Object.hasOwn(METHOD_LABELS, params.method)
      ? params.method
      : 'all';
  const page =
    typeof params.page === 'string'
      ? Math.max(1, Math.min(100000, Math.floor(Number(params.page)) || 1))
      : 1;
  return (
    <FinancialDashboard
      initialFilters={{
        start: valid ? start : `${today.slice(0, 7)}-01`,
        end: valid ? end : today,
        plan,
        method,
      }}
      initialPage={page}
    />
  );
}
