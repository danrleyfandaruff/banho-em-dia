'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  LoaderCircle,
  PawPrint,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  businessDate,
  dateRange,
  dayCount,
  monthEnd,
  shiftDate,
  validDate,
} from '@/lib/finance-date';
import {
  METHOD_LABELS,
  PLAN_LABELS,
  WEEKDAYS,
  type FinanceFilters,
  type FinanceReport,
} from '@/lib/financial-analytics';

type Report = FinanceReport & {
  pagination: { page: number; totalPages: number; total: number };
  updatedAt: string;
};
const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value / 100);
const shortMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value / 100);
const percent = (value: number) =>
  `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}-01T12:00:00Z`));
const field =
  'h-11 rounded-xl border border-[#ddd7e5] bg-white px-3 text-sm text-[#40364c] outline-none focus:ring-2 focus:ring-[#7353a6]/30';
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#ddd7e5] bg-white px-3 text-sm font-semibold text-[#51405f] transition hover:bg-[#f5f0fa] disabled:opacity-50';
const panel = 'min-w-0 rounded-2xl border border-[#e7e2ec] bg-white p-5 sm:p-6';
function Panel({
  title,
  subtitle,
  children,
  extra,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className={panel}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#302638]">{title}</h2>
          {subtitle && (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-[#7a7084]">
              {subtitle}
            </p>
          )}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-[#f8f6fa] px-4 py-8 text-center text-sm leading-6 text-[#7a7084]">
      {children}
    </p>
  );
}
function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${accent ? 'border-[#7353a6] bg-[#7353a6] text-white' : 'border-[#e7e2ec] bg-white text-[#302638]'}`}
    >
      <p
        className={`text-sm font-semibold ${accent ? 'text-white/85' : 'text-[#7a7084]'}`}
      >
        {label}
      </p>
      <p className="mt-3 break-words text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
        {value}
      </p>
      <p
        className={`mt-2 text-xs leading-5 ${accent ? 'text-white/80' : 'text-[#7a7084]'}`}
      >
        {note}
      </p>
    </div>
  );
}
function Distribution({
  items,
}: {
  items: { label: string; value: number; count: number; share: number }[];
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-semibold">
              {item.label}{' '}
              <span className="font-normal text-[#81748a]">· {item.count}</span>
            </span>
            <span className="font-semibold tabular-nums">
              {money(item.value)}{' '}
              <span className="ml-1 font-normal text-[#81748a]">
                {percent(item.share)}
              </span>
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#f0ecf5]">
            <div
              className="h-full rounded-full bg-[#a58abf]"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FinancialDashboard({
  initialFilters,
  initialPage = 1,
}: {
  initialFilters: FinanceFilters;
  initialPage?: number;
}) {
  const today = businessDate();
  const [filters, setFilters] = useState<FinanceFilters>(initialFilters);
  const [draft, setDraft] = useState({
    start: filters.start,
    end: filters.end,
  });
  const [resource, setResource] = useState<{
    key: string;
    report: Report | null;
    error: string;
  }>({ key: '', report: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [chartMode, setChartMode] = useState<'daily' | 'monthly'>('daily');
  const [calendarMonth, setCalendarMonth] = useState(
    initialFilters.end.slice(0, 7),
  );
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const query = useMemo(
    () => new URLSearchParams({ ...filters, page: String(page) }).toString(),
    [filters, page],
  );
  const requestKey = `${query}&refresh=${refresh}`;
  const loading = resource.key !== requestKey;
  const { report, error } = resource;
  useEffect(() => {
    const abort = new AbortController();
    window.history.replaceState(null, '', `/analises?${query}`);
    void fetch(`/api/analytics?${query}`, {
      signal: abort.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (response.status === 401)
          throw new Error(
            'Sua sessão expirou. Volte à agenda para entrar novamente.',
          );
        if (response.status === 403)
          throw new Error(
            'As análises financeiras estão disponíveis para administradores.',
          );
        if (!response.ok)
          throw new Error(
            response.status === 400
              ? 'Escolha um período válido de até 366 dias, sem datas futuras.'
              : 'Não foi possível carregar as análises. Tente novamente.',
          );
        return response.json() as Promise<Report>;
      })
      .then((data) => {
        if (!abort.signal.aborted)
          setResource({ key: requestKey, report: data, error: '' });
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setResource({
            key: requestKey,
            report: null,
            error:
              failure instanceof Error
                ? failure.message
                : 'Não foi possível carregar.',
          });
      });
    return () => abort.abort();
  }, [query, requestKey]);
  function change(next: FinanceFilters) {
    setFilters(next);
    setExportError('');
    setDraft({ start: next.start, end: next.end });
    setPage(1);
    setCalendarMonth(next.end.slice(0, 7));
  }
  function period(start: string, end: string) {
    change({ ...filters, start, end });
  }
  function preset(value: string) {
    if (value === 'month') period(`${today.slice(0, 7)}-01`, today);
    if (value === 'previous') {
      const end = shiftDate(`${today.slice(0, 7)}-01`, -1);
      period(`${end.slice(0, 7)}-01`, end);
    }
    if (value === '90') period(shiftDate(today, -89), today);
    if (value === 'year') period(`${today.slice(0, 4)}-01-01`, today);
  }
  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch(
        `/api/analytics?${new URLSearchParams({ ...filters, format: 'csv' })}`,
      );
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `recebimentos-${filters.start}-${filters.end}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('Não foi possível exportar. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }
  const invalidDraft =
    !validDate(draft.start) ||
    !validDate(draft.end) ||
    draft.start > draft.end ||
    draft.end > today ||
    dayCount(draft.start, draft.end) > 366;
  const dailyChart = useMemo(() => {
    if (!report) return [];
    if (report.daily.length <= 62)
      return report.daily.map((day) => ({
        key: day.date,
        label: dateLabel(day.date),
        value: day.gross,
      }));
    const months = new Map<string, number>();
    for (const day of report.daily) {
      const month = day.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + day.gross);
    }
    return [...months].map(([key, value]) => ({
      key,
      label: monthLabel(key),
      value,
    }));
  }, [report]);
  const chart =
    chartMode === 'monthly'
      ? (report?.monthly.map((month) => ({
          key: month.month,
          label: monthLabel(month.month),
          value: month.gross,
        })) ?? [])
      : dailyChart;
  const calendar = useMemo(() => {
    if (!report) return [];
    const byDay = new Map(report.daily.map((day) => [day.date, day]));
    return dateRange(`${calendarMonth}-01`, monthEnd(calendarMonth)).map(
      (date) => ({ date, ...byDay.get(date) }),
    );
  }, [calendarMonth, report]);
  const maxDay = Math.max(1, ...calendar.map((day) => day.gross ?? 0));
  const calendarOffset = new Date(`${calendarMonth}-01T12:00:00Z`).getUTCDay();
  return (
    <main className="min-h-screen bg-[#f7f7f9] text-[#302638]">
      <header className="border-b border-[#e7e2ec] bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 font-bold">
            <span className="grid size-10 place-items-center rounded-xl bg-[#7353a6] text-white">
              <PawPrint size={21} />
            </span>
            <span>
              HEIN PET <span className="hidden sm:inline">SALON</span>
            </span>
          </Link>
          <Link href="/" className={button}>
            <ArrowLeft size={16} />
            Voltar à agenda
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-[#8969a7]">
              <BarChart3 size={15} /> Análises do negócio
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Seu negócio, em números.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a7084]">
              Acompanhe o que entrou, descubra os dias mais fortes e entenda o
              movimento do pet shop.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
            <button
              type="button"
              className={button}
              disabled={loading || !!error || !report || exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Exportar CSV
            </button>
          </div>
        </div>
        <section className={panel} aria-label="Filtros das análises">
          <div className="flex flex-wrap gap-2">
            {[
              ['month', 'Este mês'],
              ['previous', 'Mês passado'],
              ['90', 'Últimos 90 dias'],
              ['year', 'Este ano'],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={button}
                onClick={() => preset(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!invalidDraft) period(draft.start, draft.end);
            }}
          >
            <label className="grid gap-1.5 text-xs font-semibold text-[#73677e]">
              De
              <input
                aria-label="Início do período"
                className={field}
                type="date"
                value={draft.start}
                max={today}
                onChange={(event) =>
                  setDraft({ ...draft, start: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#73677e]">
              Até
              <input
                aria-label="Fim do período"
                className={field}
                type="date"
                value={draft.end}
                max={today}
                onChange={(event) =>
                  setDraft({ ...draft, end: event.target.value })
                }
              />
            </label>
            <button
              type="submit"
              className={`${button} !border-[#7353a6] !bg-[#7353a6] !text-white`}
              disabled={invalidDraft}
            >
              Aplicar período
            </button>
            <label className="grid gap-1.5 text-xs font-semibold text-[#73677e]">
              Tipo
              <select
                className={field}
                value={filters.plan}
                onChange={(event) =>
                  change({ ...filters, plan: event.target.value })
                }
              >
                <option value="all">Planos, avulsos e extras</option>
                {Object.entries(PLAN_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#73677e]">
              Pagamento
              <select
                className={field}
                value={filters.method}
                onChange={(event) =>
                  change({ ...filters, method: event.target.value })
                }
              >
                <option value="all">Todas as formas</option>
                {Object.entries(METHOD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </form>
          {invalidDraft && (
            <p className="mt-3 text-sm text-[#996027]">
              Selecione até 366 dias, com início anterior ao fim e sem datas
              futuras.
            </p>
          )}
        </section>
        {exportError && (
          <p role="alert" className="text-sm text-red-700">
            {exportError}
          </p>
        )}
        {loading ? (
          <section className={panel} aria-live="polite">
            <div className="flex items-center gap-3 text-sm text-[#7353a6]">
              <LoaderCircle className="animate-spin" size={20} />
              Calculando suas análises…
            </div>
            <div className="mt-5 grid animate-pulse gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-xl bg-[#f2edf7]" />
              ))}
            </div>
          </section>
        ) : error ? (
          <section className={panel}>
            <p role="alert" className="text-sm text-[#994821]">
              {error}
            </p>
            <Link href="/" className={`${button} mt-4`}>
              Voltar à agenda
            </Link>
          </section>
        ) : (
          report && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[#7a7084]">
                <p>
                  <strong className="text-[#51405f]">
                    {dateLabel(filters.start)} a {dateLabel(filters.end)} ·{' '}
                    {filters.end.slice(0, 4)}
                  </strong>
                  <span className="mx-2">/</span>
                  {report.days} {report.days === 1 ? 'dia' : 'dias'}
                </p>
                <p>
                  Comparação: {dateLabel(report.previousStart)} a{' '}
                  {dateLabel(report.previousEnd)} ·{' '}
                  {report.previousEnd.slice(0, 4)} ({report.days} dias)
                </p>
              </div>
              {report.incomplete > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {report.incomplete} lançamento(s) pago(s) sem registro
                  financeiro completo ficaram fora dos totais. Corrija o
                  pagamento na agenda para incluí-los.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Stat
                  label="Recebido bruto"
                  value={money(report.totals.gross)}
                  note={
                    report.change === null
                      ? 'Sem base de recebimentos no período anterior'
                      : `${report.change > 0 ? '+' : ''}${percent(report.change)} em relação ao período anterior (${money(report.previous.gross)})`
                  }
                  accent
                />
                <Stat
                  label="Após taxas do cartão"
                  value={money(report.totals.net)}
                  note={`Estimativa · taxas de ${money(report.totals.fees)}. Não representa lucro.`}
                />
                <Stat
                  label="Ticket médio"
                  value={money(report.totals.ticket)}
                  note="Valor bruto por lançamento pago: plano, avulso ou extra."
                />
                <Stat
                  label="Lançamentos pagos"
                  value={String(report.totals.count)}
                  note={`${report.activeDays} dias com recebimentos · ${money(report.days ? Math.round(report.totals.gross / report.days) : 0)} por dia corrido`}
                />
                <Stat
                  label="Clientes que pagaram"
                  value={String(report.totals.customers)}
                  note={`${report.newCustomers} com primeiro pagamento · ${report.returning} já tinham pago antes`}
                />
                <Stat
                  label="A receber agora"
                  value={money(report.pending.gross)}
                  note={`${report.pending.count} lançamentos pendentes em todas as datas${report.pending.unknown ? ` · ${report.pending.unknown} sem valor` : ''}`}
                />
              </div>
              {report.totals.count === 0 && (
                <div className="flex gap-3 rounded-2xl border border-[#e1d5ec] bg-[#f2edf7] p-5">
                  <Wallet className="shrink-0 text-[#7353a6]" />
                  <div>
                    <p className="font-semibold">
                      Nenhum recebimento neste período.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[#73677e]">
                      Ao confirmar um pagamento na agenda, informe o valor e a
                      data. Os gráficos começam a ser preenchidos
                      automaticamente. Você também pode escolher outro período.
                    </p>
                  </div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-3">
                {[
                  {
                    label: 'Dia de maior recebimento',
                    value: report.bestDay
                      ? dateLabel(report.bestDay.date)
                      : 'Sem dados',
                    detail: report.bestDay
                      ? `${money(report.bestDay.gross)} · ${report.bestDay.count} lançamentos no período`
                      : 'Aparece após o primeiro pagamento.',
                  },
                  {
                    label: 'Melhor mês do histórico',
                    value: report.bestMonth
                      ? monthLabel(report.bestMonth.month)
                      : 'Sem dados',
                    detail: report.bestMonth
                      ? `${money(report.bestMonth.gross)}${report.bestMonth.month === today.slice(0, 7) ? ' · mês em andamento' : ''} · respeita tipo e pagamento`
                      : 'Comparação de todos os meses registrados.',
                  },
                  {
                    label: 'Dia da semana mais forte',
                    value: report.bestWeekday
                      ? report.bestWeekday.label
                      : 'Sem dados',
                    detail: report.bestWeekday
                      ? `${money(report.bestWeekday.average)} em média por ocorrência desse dia`
                      : 'Média considera também os dias sem recebimentos.',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-[#e7e2ec] bg-white p-5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8d7f97]">
                      {item.label}
                    </p>
                    <p className="mt-3 text-xl font-bold capitalize">
                      {item.value}
                    </p>
                    <p className="mt-2 text-sm leading-5 text-[#7a7084]">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
              <Panel
                title="Evolução dos recebimentos"
                subtitle={
                  chartMode === 'monthly'
                    ? 'Todo o histórico, respeitando os filtros de tipo e pagamento. Meses em andamento têm apenas os valores registrados até hoje.'
                    : report.days > 62
                      ? 'Recebimentos agrupados por mês dentro do período selecionado.'
                      : 'Valores brutos por data do pagamento. Clique no calendário abaixo para explorar um dia.'
                }
                extra={
                  <div className="flex gap-2">
                    <button
                      className={button}
                      type="button"
                      aria-pressed={chartMode === 'daily'}
                      onClick={() => setChartMode('daily')}
                    >
                      Período
                    </button>
                    <button
                      className={button}
                      type="button"
                      aria-pressed={chartMode === 'monthly'}
                      onClick={() => setChartMode('monthly')}
                    >
                      Meses do histórico
                    </button>
                  </div>
                }
              >
                {chart.some((item) => item.value > 0) ? (
                  <div className="h-72 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chart}
                        margin={{ top: 12, right: 12, left: 0, bottom: 5 }}
                        accessibilityLayer
                      >
                        <defs>
                          <linearGradient
                            id="revenue-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#a58abf"
                              stopOpacity={0.4}
                            />
                            <stop
                              offset="100%"
                              stopColor="#a58abf"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="4 4"
                          vertical={false}
                          stroke="#ece7f1"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#81748a' }}
                          minTickGap={24}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tickFormatter={shortMoney}
                          tick={{ fontSize: 11, fill: '#81748a' }}
                          tickLine={false}
                          axisLine={false}
                          width={55}
                        />
                        <Tooltip
                          formatter={(value) => [
                            money(Number(value)),
                            'Recebido bruto',
                          ]}
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: '#e7e2ec',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#7353a6"
                          strokeWidth={2.5}
                          fill="url(#revenue-fill)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>Sem valores recebidos para desenhar o gráfico.</Empty>
                )}
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-[#7353a6]">
                    Ver os valores em tabela
                  </summary>
                  <div className="mt-3 max-h-64 overflow-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr>
                          <th className="p-2">Data / mês</th>
                          <th className="p-2 text-right">Recebido bruto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chart.map((item) => (
                          <tr
                            key={item.key}
                            className="border-t border-[#f0ecf5]"
                          >
                            <td className="p-2">{item.label}</td>
                            <td className="p-2 text-right tabular-nums">
                              {money(item.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Panel>
              <div className="grid gap-6 lg:grid-cols-2">
                <Panel
                  title="Calendário de recebimentos"
                  subtitle="Quanto mais escuro, maior o valor recebido. Cada data abre a análise daquele dia."
                  extra={
                    <input
                      aria-label="Mês do calendário"
                      type="month"
                      className={field}
                      min={filters.start.slice(0, 7)}
                      max={filters.end.slice(0, 7)}
                      value={calendarMonth}
                      onChange={(event) => {
                        if (
                          event.target.value >= filters.start.slice(0, 7) &&
                          event.target.value <= filters.end.slice(0, 7)
                        )
                          setCalendarMonth(event.target.value);
                      }}
                    />
                  }
                >
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                    {WEEKDAYS.map((day) => (
                      <span
                        key={day}
                        className="pb-2 text-center text-xs text-[#81748a]"
                      >
                        {day.slice(0, 3)}
                      </span>
                    ))}
                    {Array.from({ length: calendarOffset }, (_, i) => (
                      <span key={`empty-${i}`} />
                    ))}
                    {calendar.map((day) => {
                      const active = day.gross !== undefined;
                      const ratio = (day.gross ?? 0) / maxDay;
                      return (
                        <button
                          type="button"
                          key={day.date}
                          disabled={!active}
                          onClick={() => period(day.date, day.date)}
                          title={`${dateLabel(day.date)}: ${active ? money(day.gross ?? 0) : 'fora do período'}`}
                          aria-label={`${dateLabel(day.date)}, ${active ? money(day.gross ?? 0) : 'fora do período'}`}
                          className={`min-h-14 rounded-lg border p-1 text-center transition focus-visible:ring-2 focus-visible:ring-[#7353a6] sm:min-h-16 ${!active ? 'border-transparent bg-[#faf9fb] text-[#bbb3c2]' : ratio > 0.65 ? 'border-[#7353a6] bg-[#7353a6] text-white' : ratio > 0 ? 'border-[#d7c7e7] bg-[#e9dff2] text-[#68458d]' : 'border-[#ece7f1] bg-[#f7f4fa] text-[#81748a]'}`}
                        >
                          <span className="block text-sm font-semibold">
                            {Number(day.date.slice(8))}
                          </span>
                          {active && (
                            <span className="mt-1 block text-[11px] tabular-nums">
                              {day.gross ? shortMoney(day.gross) : '—'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-xs leading-5 text-[#81748a]">
                    Valores em R$. Traço indica nenhum valor recebido; cinza
                    claro fica fora do período.
                  </p>
                </Panel>
                <Panel
                  title="Padrão por dia da semana"
                  subtitle="Média bruta por ocorrência no período, incluindo dias sem recebimento. Isso evita favorecer meses com mais sextas-feiras, por exemplo."
                >
                  <div className="space-y-4">
                    {report.weekdays.map((day) => (
                      <div key={day.key}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-semibold">
                            {day.label}{' '}
                            <span className="text-xs font-normal text-[#81748a]">
                              ({day.days} dias)
                            </span>
                          </span>
                          <span className="tabular-nums">
                            {money(day.average)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-[#f0ecf5]">
                          <div
                            className="h-2 rounded-full bg-[#a58abf]"
                            style={{
                              width: `${(day.average / Math.max(1, ...report.weekdays.map((item) => item.average))) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 rounded-xl bg-[#f7f4fa] p-3 text-xs leading-5 text-[#7a7084]">
                    {report.totals.count < 10 || report.days < 28
                      ? 'Ainda há poucos dados para tratar isso como um padrão. Compare novamente após pelo menos quatro semanas e dez pagamentos.'
                      : 'Esse padrão descreve os recebimentos registrados; não é uma previsão de demanda ou de caixa.'}
                  </p>
                </Panel>
                <Panel
                  title="Como os clientes pagam"
                  subtitle="Participação no valor bruto recebido no período."
                >
                  <Distribution items={report.methods} />
                </Panel>
                <Panel
                  title="O que mais gera recebimentos"
                  subtitle="Planos e avulsos são contados uma vez. Serviços extras entram como cobranças independentes."
                >
                  <Distribution items={report.plans} />
                </Panel>
              </div>
              <Panel
                title="Leituras do período"
                subtitle="Observações calculadas com seus dados, sem projeções automáticas."
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl bg-[#f7f4fa] p-4">
                    <TrendingUp size={20} className="text-[#7353a6]" />
                    <p className="mt-3 text-sm leading-6">
                      {report.change === null
                        ? 'Ainda não há recebimentos no período anterior para calcular uma variação percentual.'
                        : `Os recebimentos ${report.change >= 0 ? 'cresceram' : 'caíram'} ${percent(Math.abs(report.change))} frente aos ${report.days} dias anteriores. O ticket médio anterior foi ${money(report.previous.ticket)}.`}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#f7f4fa] p-4">
                    <UsersIcon />
                    <p className="mt-3 text-sm leading-6">
                      {report.totals.customers
                        ? `${percent((report.returning / report.totals.customers) * 100)} dos clientes que pagaram já tinham pagamentos anteriores. Os três maiores clientes representam ${percent((report.customers.slice(0, 3).reduce((n, c) => n + c.gross, 0) / Math.max(1, report.totals.gross)) * 100)} do recebido.`
                        : 'Com novos pagamentos, você verá aqui a participação dos clientes recorrentes e a concentração da receita.'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#f7f4fa] p-4">
                    <CalendarDays size={20} className="text-[#7353a6]" />
                    <p className="mt-3 text-sm leading-6">
                      {report.activity.count
                        ? `${report.activity.completed} atendimentos concluídos e ${report.activity.absent} faltas. A taxa de falta foi ${percent(report.activity.absenceRate)} entre atendimentos finalizados.`
                        : 'Nenhum atendimento agendado no período escolhido.'}{' '}
                      {report.pending.withPastSession > 0
                        ? `${report.pending.withPastSession} lançamentos pendentes têm pelo menos uma sessão datada até hoje.`
                        : ''}
                    </p>
                  </div>
                </div>
              </Panel>
              <div className="grid gap-6 lg:grid-cols-2">
                <Panel
                  title="Clientes com mais recebimentos"
                  subtitle="Até dez tutores, somando todos os pets. Base: data do pagamento."
                >
                  {report.customers.length ? (
                    <ol className="divide-y divide-[#f0ecf5]">
                      {report.customers.map((customer, index) => (
                        <li
                          key={customer.id}
                          className="flex items-center justify-between gap-3 py-3 first:pt-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#f2edf7] text-xs font-bold text-[#8969a7]">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {customer.name || 'Tutor não informado'}
                              </p>
                              <p className="truncate text-xs text-[#81748a]">
                                {customer.pets.join(', ')} · {customer.count}{' '}
                                lançamentos
                              </p>
                            </div>
                          </div>
                          <strong className="shrink-0 text-sm tabular-nums">
                            {money(customer.gross)}
                          </strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty>
                      Os clientes aparecem após os primeiros pagamentos.
                    </Empty>
                  )}
                </Panel>
                <Panel
                  title="Movimento e serviços"
                  subtitle="Atendimentos pela data agendada, com o filtro de tipo. O filtro de pagamento não altera esta seção."
                >
                  <div className="mb-5 grid grid-cols-3 gap-2">
                    {[
                      ['Concluídos', report.activity.completed],
                      ['Em aberto', report.activity.open],
                      ['Faltas', report.activity.absent],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-[#f7f4fa] p-3">
                        <p className="text-2xl font-bold">{value}</p>
                        <p className="mt-1 text-xs text-[#81748a]">{label}</p>
                      </div>
                    ))}
                  </div>
                  <h3 className="mb-3 text-sm font-semibold">
                    Serviços mais realizados
                  </h3>
                  {report.services.length ? (
                    <div className="space-y-3">
                      {report.services.slice(0, 6).map((service) => (
                        <div
                          key={service.label}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <span>{service.label}</span>
                          <strong>{service.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>
                      Sem serviços de atendimentos concluídos neste período.
                    </Empty>
                  )}
                  <p className="mt-4 text-xs leading-5 text-[#81748a]">
                    Os serviços incluídos no plano não têm preço individual.
                    Esta lista mostra quantidades; o valor dos extras aparece
                    nos recebimentos.
                  </p>
                  {report.hours.length > 0 && (
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-semibold text-[#7353a6]">
                        Horários com mais agendamentos
                      </summary>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {[...report.hours]
                          .sort((a, b) => b.count - a.count)
                          .map((hour) => (
                            <div
                              key={hour.label}
                              className="rounded-lg bg-[#f7f4fa] p-2 text-center"
                            >
                              <strong>{hour.label}</strong>
                              <p className="mt-1 text-xs text-[#81748a]">
                                {hour.count} agendados
                              </p>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                </Panel>
              </div>
              <Panel
                title="Valores que ainda estão em aberto"
                subtitle={`Visão atual de todas as datas, respeitando o tipo de lançamento. Sem filtro de pagamento: ainda não houve recebimento. ${money(report.pending.startedInPeriod)} pertencem a lançamentos com data inicial ou sessão no período selecionado.`}
              >
                {report.pending.count ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="text-xs text-[#81748a]">
                          <tr>
                            {[
                              'Data inicial / sessão',
                              'Tutor / pet',
                              'Tipo',
                              'Valor previsto',
                            ].map((label) => (
                              <th
                                key={label}
                                className="pb-3 pr-4 font-semibold"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.pending.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-t border-[#f0ecf5]"
                            >
                              <td className="py-3 pr-4">
                                {dateLabel(item.start)} /{' '}
                                {item.start.slice(0, 4)}
                              </td>
                              <td className="py-3 pr-4">
                                <strong>{item.owner}</strong>
                                <p className="mt-0.5 text-xs text-[#81748a]">
                                  {item.pet}
                                </p>
                              </td>
                              <td className="py-3 pr-4">
                                {PLAN_LABELS[item.plan]}
                                {item.plan === 'extra' && (
                                  <span className="mt-1 block text-xs text-[#81748a]">
                                    {item.description}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 pr-4 tabular-nums">
                                {item.amount === null
                                  ? 'Valor não informado'
                                  : money(item.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {report.pending.count > 20 && (
                      <p className="mt-3 text-xs text-[#81748a]">
                        Mostrando os 20 primeiros de {report.pending.count}.
                        Veja todos na agenda com o filtro de pagamento pendente.
                      </p>
                    )}
                  </>
                ) : (
                  <Empty>
                    Nenhum pagamento pendente para este tipo de lançamento.
                  </Empty>
                )}
              </Panel>
              <Panel
                title="Recebimentos do período"
                subtitle="Uma linha por plano, avulso ou serviço extra. Pagamentos conjuntos são distribuídos entre os planos, sem repetir o total."
              >
                {report.receipts.length ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="text-xs text-[#81748a]">
                          <tr>
                            {[
                              'Recebido em',
                              'Tutor / pet',
                              'Tipo',
                              'Forma',
                              'Bruto',
                              'Taxa est.',
                              'Líquido est.',
                            ].map((label) => (
                              <th
                                key={label}
                                className="pb-3 pr-4 font-semibold"
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.receipts.map((item) => (
                            <tr
                              key={item.id}
                              className="border-t border-[#f0ecf5]"
                            >
                              <td className="py-3 pr-4">
                                {dateLabel(item.date)}
                              </td>
                              <td className="py-3 pr-4">
                                <strong>{item.owner}</strong>
                                <p className="mt-0.5 text-xs text-[#81748a]">
                                  {item.pet}
                                </p>
                              </td>
                              <td className="py-3 pr-4">
                                {PLAN_LABELS[item.plan]}
                                {item.plan === 'extra' && (
                                  <span className="mt-1 block text-xs text-[#81748a]">
                                    {item.description}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 pr-4">
                                {METHOD_LABELS[item.method]}
                                {item.batchId && (
                                  <span className="mt-1 block text-xs text-[#81748a]">
                                    Conjunto
                                  </span>
                                )}
                              </td>
                              <td className="py-3 pr-4 font-semibold tabular-nums">
                                {money(item.gross)}
                              </td>
                              <td className="py-3 pr-4 tabular-nums">
                                {money(item.fees)}
                              </td>
                              <td className="py-3 pr-4 tabular-nums">
                                {money(item.net)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#f0ecf5] pt-4">
                      <p className="text-xs text-[#81748a]">
                        {report.pagination.total} registros · página{' '}
                        {report.pagination.page} de{' '}
                        {report.pagination.totalPages}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={button}
                          disabled={report.pagination.page <= 1}
                          onClick={() => setPage(report.pagination.page - 1)}
                        >
                          <ChevronLeft size={16} />
                          Anterior
                        </button>
                        <button
                          type="button"
                          className={button}
                          disabled={
                            report.pagination.page >=
                            report.pagination.totalPages
                          }
                          onClick={() => setPage(report.pagination.page + 1)}
                        >
                          Próxima
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty>
                    Nenhum pagamento neste período com os filtros selecionados.
                  </Empty>
                )}
              </Panel>
              <footer className="rounded-2xl border border-[#e7e2ec] bg-white p-5 text-xs leading-6 text-[#81748a]">
                <p className="flex items-center gap-2 font-semibold text-[#51405f]">
                  <Info size={16} />
                  Como ler estes números
                </p>
                <p className="mt-2">
                  Recebimentos usam a data informada ao confirmar o pagamento,
                  no fuso de São Paulo. Cartão aparece na data do pagamento do
                  cliente, sem prever a data de repasse da operadora. Taxas são
                  estimadas com o percentual salvo naquele pagamento. Despesas,
                  impostos e antecipações não estão incluídos; o líquido
                  mostrado não é lucro.
                </p>
                <p className="mt-1">
                  Serviços extras têm recebimento próprio e não são repetidos na
                  renovação. Desmarcar um pagamento corrige o registro e o
                  retira das análises. Não representa um estorno bancário.
                  Comparações usam o mesmo número de dias corridos; o melhor mês
                  considera todo o histórico disponível. Atualizado em{' '}
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'America/Sao_Paulo',
                  }).format(new Date(report.updatedAt))}
                  .
                </p>
              </footer>
            </>
          )
        )}
      </div>
    </main>
  );
}
function UsersIcon() {
  return <ArrowUpRight size={20} className="text-[#7353a6]" />;
}
