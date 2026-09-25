'use client';

import { ComponentProps, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Calculator, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock3, CreditCard, Dog, GripVertical, History, IdCard, ListChecks, LoaderCircle, LogOut,
  MessageCircle, PawPrint, Pencil, Plus, RefreshCw, Scissors, ShieldCheck,
  Sparkles, Trash2, UserPlus, UserRound, Users, X,
} from 'lucide-react';
import { Button as BaseButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PwaInstallButton } from '@/components/pwa-install-button';
import { calculatePayment, cardRateBps, defaultCardRates, type CardRates, type PaymentBreakdown } from '@/lib/payment';

type PlanType = 'monthly' | 'fortnightly' | 'single';
type Status = 'scheduled' | 'completed' | 'absent';
type PaymentMethod = '' | 'pix' | 'cash' | 'debit' | 'credit';

// Keep feedback on the button that started the action, including queued saves.
function Button({ onClick, children, disabled, className, ...props }: ComponentProps<typeof BaseButton>) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  return <BaseButton {...props} className={`${className ?? ''} ${busy ? '[&>svg:not(.animate-spin)]:hidden' : ''}`} disabled={disabled || busy} aria-busy={busy || undefined}
    onClick={async (event) => {
      if (busyRef.current) return;
      const result = onClick?.(event) as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        busyRef.current = true;
        setBusy(true);
        try { await result; } finally { busyRef.current = false; setBusy(false); }
      }
    }}>
    {busy && <LoaderCircle className="animate-spin" aria-label="Salvando" />}{children}
  </BaseButton>;
}

const cardColors: Record<Status, string> = {
  scheduled: 'appointment-open', completed: 'appointment-completed', absent: 'appointment-absent',
};
type Appointment = {
  id: string;
  groupId: string;
  customerPetName: string;
  ownerName: string;
  dogName: string;
  whatsapp: string;
  cpf: string;
  paymentMethod: PaymentMethod;
  paymentDetails: PaymentBreakdown | null;
  planType: PlanType;
  amountCents: number | null;
  paid: boolean;
  scheduledDate: string;
  scheduledTime: string;
  status: Status;
  services: string[];
  sessionNumber: number;
  totalSessions: number;
};
type CurrentUser = { id: string; name: string; email: string; role: 'admin' | 'staff' };
type TeamUser = CurrentUser & { active: boolean; createdAt: string; lastLoginAt: string | null };
type AuditLog = {
  id: string;
  actorEmail: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  createdAt: string;
};

const serviceOptions = [
  'Banho',
  'Banho medicamentoso',
  'Tosa higiênica',
  'Tosa completa',
  'Tosa bebê',
  'Tosa na tesoura',
  'Tosa de raça',
  'Aparar pelos',
  'Cortar unhas',
  'Limpar ouvidos',
  'Higiene bucal',
  'Limpeza dos olhos',
  'Hidratação',
  'Escovação',
  'Desembolo',
  'Remoção de subpelo',
];
const planLabels: Record<PlanType, string> = { monthly: 'Mensal', fortnightly: 'Quinzenal', single: 'Avulso' };
const paymentMethodLabels: Record<Exclude<PaymentMethod, ''>, string> = {
  pix: 'Pix', cash: 'Dinheiro', debit: 'Cartão de débito', credit: 'Cartão de crédito',
};
const paymentMethods = Object.keys(paymentMethodLabels) as Exclude<PaymentMethod, ''>[];
const planDescriptions: Record<PlanType, string> = {
  monthly: '4 banhos · toda semana', fortnightly: '2 banhos · a cada 15 dias', single: '1 atendimento',
};
const statusLabels: Record<Status, string> = {
  scheduled: 'Em aberto', completed: 'Concluído', absent: 'Faltou',
};

function totalSessionsFor(planType: PlanType) {
  return planType === 'monthly' ? 4 : planType === 'fortnightly' ? 2 : 1;
}

function intervalDaysFor(planType: PlanType) {
  return planType === 'monthly' ? 7 : planType === 'fortnightly' ? 14 : 0;
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function addDays(dateString: string, amount: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

function sessionDatesFor(planType: PlanType, startDate: string) {
  return Array.from(
    { length: totalSessionsFor(planType) },
    (_, index) => addDays(startDate, intervalDaysFor(planType) * index),
  );
}

function addMonths(monthString: string, amount: number) {
  const [year, month] = monthString.split('-').map(Number);
  const date = new Date(year, month - 1 + amount, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(monthString: string) {
  const [year, month] = monthString.split('-').map(Number);
  const total = new Date(year, month, 0).getDate();
  return Array.from({ length: total }, (_, index) => `${monthString}-${String(index + 1).padStart(2, '0')}`);
}

function prettyMonth(monthString: string) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(`${monthString}-01T12:00:00`));
}

function prettyDate(dateString: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${dateString}T12:00:00`)).replace('-feira', '');
}

function formatMoney(cents: number | null) {
  if (cents === null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function maskReal(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return formatMoney(Number(digits)) ?? '';
}

function paymentPreview(amount: string, method: PaymentMethod, rates: CardRates) {
  try { return calculatePayment(realToCents(amount), method, rates); }
  catch { return null; }
}

function PaymentSummary({ amount, method, rates, baseLabel = 'Valor do banho/plano' }: { amount: string; method: PaymentMethod; rates: CardRates; baseLabel?: string }) {
  const details = paymentPreview(amount, method, rates);
  if (!method) return null;
  return <div className="rounded-xl border border-[#d9c5eb] bg-[#f3eafa] p-4 text-sm" aria-live="polite">
    {details ? <>
      <div className="flex justify-between gap-3"><span>{baseLabel}</span><strong>{formatMoney(details.baseCents)}</strong></div>
      <div className="mt-2 flex justify-between gap-3"><span>{cardRateBps(method, rates) ? `Acréscimo · Stone ${(details.rateBps / 100).toLocaleString('pt-BR')}%` : 'Sem acréscimo'}</span><strong>{formatMoney(details.surchargeCents)}</strong></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#d9c5eb] pt-3"><strong>Total para cobrar</strong><strong className="text-2xl text-[#653b88]">{formatMoney(details.totalCents)}</strong></div>
      {cardRateBps(method, rates) > 0 && <p className="mt-2 text-xs leading-5 text-[#6f6179]">{method === 'credit' ? 'Crédito à vista. ' : ''}Acréscimo calculado para receber o valor original após a taxa, arredondado para centavos.</p>}
    </> : <p>Informe um valor válido para calcular o total{cardRateBps(method, rates) ? ' com a taxa do cartão' : ''}.</p>}
  </div>;
}

function PaidTotal({ item }: { item: Appointment }) {
  if (!item.paid || !item.paymentDetails || !cardRateBps(item.paymentMethod)) return null;
  return <p className="mt-1 text-xs font-bold text-[#4f765c]">Cobrado no cartão: {formatMoney(item.paymentDetails.totalCents)} · acréscimo {formatMoney(item.paymentDetails.surchargeCents)}</p>;
}

function realToCents(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function maskCpf(value: string) {
  return value
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function paymentMethodLabel(value: PaymentMethod) {
  return value ? paymentMethodLabels[value] : '';
}

function whatsappUrl(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const internationalNumber = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${internationalNumber}`;
}

const emptyForm = (scheduledDate = localDateString()) => ({
  ownerName: '', dogName: '', whatsapp: '', cpf: '', paymentMethod: '' as PaymentMethod,
  planType: 'monthly' as PlanType, amount: '', paid: false,
  scheduledDate, scheduledTime: '09:00',
  sessionDates: sessionDatesFor('monthly', scheduledDate),
  sessionServices: Array.from({ length: 4 }, () => ['Banho']),
  sessionCompleted: Array.from({ length: 4 }, () => false),
});

export default function Home() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authorized' | 'signed_out' | 'forbidden'>('loading');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [blockedEmail, setBlockedEmail] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginSaving, setLoginSaving] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingForm, setSavingForm] = useState('');
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [dailyAgendaDate, setDailyAgendaDate] = useState(() => localDateString());
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<Appointment | null>(null);
  const [batchPaymentTargets, setBatchPaymentTargets] = useState<Appointment[]>([]);
  const [paymentChoice, setPaymentChoice] = useState<PaymentMethod>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const paymentLock = useRef(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [rates, setRates] = useState<CardRates>(defaultCardRates);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ratesDraft, setRatesDraft] = useState({ credit: '', debit: '' });
  const [ratesError, setRatesError] = useState('');
  const [ratesSaving, setRatesSaving] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorAmount, setCalculatorAmount] = useState('');
  const [calculatorMethod, setCalculatorMethod] = useState<PaymentMethod>('credit');
  const [planReturnToToday, setPlanReturnToToday] = useState(false);
  const [selectedPlanGroupId, setSelectedPlanGroupId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [activeServiceSession, setActiveServiceSession] = useState(0);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [editingOriginalDate, setEditingOriginalDate] = useState('');
  const [editDateChoiceOpen, setEditDateChoiceOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ item: Appointment; scheduledDate: string } | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<Appointment | null>(null);
  const [renewDates, setRenewDates] = useState<string[]>([]);
  const [renewedWarning, setRenewedWarning] = useState<{ name: string; renewedAt: string | null } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => localDateString().slice(0, 7));
  const [notice, setNotice] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'staff' as 'admin' | 'staff' });
  const today = localDateString();

  useEffect(() => {
    async function load() {
      try {
        const sessionResponse = await fetch('/api/session');
        const session = await sessionResponse.json() as { user: CurrentUser; email?: string };
        if (!sessionResponse.ok) {
          setAuthStatus(sessionResponse.status === 403 ? 'forbidden' : 'signed_out');
          setBlockedEmail(session.email ?? '');
          if (sessionResponse.status === 503) setLoginError('O Supabase ainda não foi configurado neste ambiente.');
          return;
        }
        setCurrentUser(session.user);
        setAuthStatus('authorized');
        const response = await fetch('/api/appointments');
        if (!response.ok) throw new Error('request failed');
        const data = await response.json() as { appointments?: Appointment[]; rates?: CardRates };
        setAppointments(data.appointments ?? []);
        if (data.rates) setRates(data.rates);
      } catch {
        setNotice('Não foi possível carregar a agenda. Tente novamente.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const days = useMemo(() => daysInMonth(selectedMonth), [selectedMonth]);
  const groupStats = useMemo(() => {
    const stats = new Map<string, { completed: number; absent: number; scheduled: number }>();
    appointments.forEach((item) => {
      const current = stats.get(item.groupId) ?? { completed: 0, absent: 0, scheduled: 0 };
      if (item.status === 'completed') current.completed += 1;
      if (item.status === 'absent') current.absent += 1;
      if (item.status === 'scheduled') current.scheduled += 1;
      stats.set(item.groupId, current);
    });
    return stats;
  }, [appointments]);

  const todayAppointments = appointments.filter((item) => item.scheduledDate === today);
  const dailyAppointments = appointments.filter((item) => item.scheduledDate === dailyAgendaDate);
  const pendingGroups = Array.from(new Map(appointments.filter((item) => !item.paid).map((item) => [item.groupId, item])).values());
  const renewalItems = appointments.filter((item) =>
    item.planType !== 'single'
    && item.sessionNumber === item.totalSessions
    && item.status === 'completed'
    && (groupStats.get(item.groupId)?.scheduled ?? 0) === 0,
  );
  const editingPlan = editing ? appointments.filter((item) => item.groupId === editing.groupId) : [];
  const selectedPlan = selectedPlanGroupId
    ? appointments.filter((item) => item.groupId === selectedPlanGroupId).sort((a, b) => a.sessionNumber - b.sessionNumber)
    : [];
  const selectedPlanHead = selectedPlan[0];
  const selectedPlanLast = selectedPlan[selectedPlan.length - 1];
  const selectedPlanStats = selectedPlanHead
    ? groupStats.get(selectedPlanHead.groupId) ?? { completed: 0, absent: 0, scheduled: 0 }
    : { completed: 0, absent: 0, scheduled: 0 };
  const selectedPlanIsRenewable = Boolean(
    selectedPlanLast?.status === 'completed' && selectedPlanStats.scheduled === 0,
  );
  const completedToDelete = editingPlan.filter((item) => item.status === 'completed').length;
  const deleteBlockers = [
    completedToDelete
      ? `${completedToDelete} ${completedToDelete === 1 ? 'banho já foi concluído' : 'banhos já foram concluídos'}`
      : '',
    editingPlan.some((item) => item.paid) ? 'o pagamento está marcado como pago' : '',
  ].filter(Boolean);

  function mutate(payload: Record<string, unknown>, message?: string): Promise<boolean> {
    // Responses contain the whole agenda; serialize writes so older snapshots cannot overwrite newer ones.
    const task = mutationQueue.current.then(() => performMutation(payload, message));
    mutationQueue.current = task.catch(() => undefined);
    return task;
  }

  async function performMutation(payload: Record<string, unknown>, message?: string) {
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({ error: 'unexpected_response' })) as { appointments?: Appointment[]; rates?: CardRates; error?: string; blockers?: string[]; missing?: string[]; pendingCount?: number };
      if (!response.ok) {
        if (data.rates) setRates(data.rates);
        const blockerMessage = response.status === 401
          ? 'Seu acesso expirou. Atualize a página e tente salvar novamente.'
          : response.status === 403
            ? 'Este usuário não tem permissão para salvar. Entre novamente ou fale com o administrador.'
          : response.status >= 500
            ? 'O sistema ficou indisponível por alguns instantes. Seus dados continuam na tela; tente salvar novamente.'
          : Array.isArray(data.blockers)
          ? `Não é possível apagar: ${data.blockers.join(' e ')}.`
          : data.error === 'plan_incomplete'
            ? `Ainda ${data.pendingCount === 1 ? 'existe 1 banho em aberto' : `existem ${data.pendingCount} banhos em aberto`}. Finalize todas as sessões antes de renovar.`
            : data.error === 'plan_already_renewed' ? 'Este plano já foi renovado. A renovação existente foi mantida.'
            : data.error === 'rates_changed' ? 'As taxas foram atualizadas. Confira o novo total e confirme novamente.'
            : data.error === 'card_amount_required' ? 'Informe o valor do banho ou plano para calcular a taxa do cartão.'
            : data.error === 'batch_amount_required' ? `Cadastre o valor antes de receber junto: ${(data.missing ?? []).join(', ')}.`
            : data.error === 'batch_already_paid' ? 'Um dos planos selecionados já foi pago. Atualize a agenda e tente novamente.'
            : data.error === 'invalid_batch_selection' ? 'Selecione pelo menos dois planos ainda não pagos.'
            : data.error === 'invalid_amount' ? 'Informe um valor válido.'
            : 'Não foi possível salvar. Tente novamente.';
        setNotice(blockerMessage);
        window.setTimeout(() => setNotice(''), 4200);
        return false;
      }
      setAppointments(data.appointments ?? []);
      setSelectedIds((ids) => ids.filter((id) => (data.appointments ?? []).some((item) => item.id === id && item.status === 'scheduled')));
      if (message) {
        setNotice(message);
        window.setTimeout(() => setNotice(''), 2600);
      }
      return true;
    } catch {
      setNotice(navigator.onLine
        ? 'A conexão com o sistema falhou. Seus dados continuam na tela; tente salvar novamente.'
        : 'Sem internet. Seus dados continuam na tela; conecte-se e tente salvar novamente.');
      window.setTimeout(() => setNotice(''), 5200);
      return false;
    }
  }

  function selectionCheckbox(item: Appointment) {
    if (item.status !== 'scheduled') return null;
    return <Checkbox className="size-5" aria-label={`Selecionar ${item.dogName || 'banho'} de ${prettyDate(item.scheduledDate)} às ${item.scheduledTime}`}
      checked={selectedIds.includes(item.id)}
      onCheckedChange={(checked) => setSelectedIds((ids) => checked ? [...new Set([...ids, item.id])] : ids.filter((id) => id !== item.id))} />;
  }

  function dayActions(date: string, items: Appointment[]) {
    const open = items.filter((item) => item.status === 'scheduled');
    if (!open.length) return null;
    const selected = open.filter((item) => selectedIds.includes(item.id));
    const selectedPlans = Array.from(new Map(
      selected.filter((item) => item.planType !== 'single' && !item.paid).map((item) => [item.groupId, item]),
    ).values());
    const complete = (ids: string[]) => mutate({ action: 'complete_day', scheduledDate: date, ids }, `${ids.length} ${ids.length === 1 ? 'banho concluído' : 'banhos concluídos'}`);
    return <div className="flex flex-wrap items-center gap-3 border-b border-[#e4dced] bg-[#f3edf9] px-3.5 py-3 sm:px-5">
      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-[#624782]">
        <Checkbox className="size-5" checked={selected.length === open.length} indeterminate={selected.length > 0 && selected.length < open.length}
          onCheckedChange={(checked) => setSelectedIds((ids) => checked ? [...new Set([...ids, ...open.map((item) => item.id)])] : ids.filter((id) => !open.some((item) => item.id === id)))} />
        {selected.length ? `${selected.length} selecionado(s)` : `Selecionar os ${open.length} em aberto`}
      </label>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        {selectedPlans.length >= 2 && <Button key="payment" variant="outline" className="h-auto min-h-10 whitespace-normal border-[#7353a6] text-[#653b88]" onClick={() => openBatchPayment(selectedPlans)}><CircleDollarSign /> Receber {selectedPlans.length} planos</Button>}
        {selected.length > 0 && <Button key="selected" className="h-auto min-h-10 whitespace-normal" onClick={() => complete(selected.map((item) => item.id))}><Check /> Concluir selecionados ({selected.length})</Button>}
        <Button key="all" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => complete(open.map((item) => item.id))}><CheckCircle2 /> Concluir todos ({open.length})</Button>
      </div>
    </div>;
  }

  function openNew(date = today) {
    setForm(emptyForm(date));
    setActiveServiceSession(0);
    setNewOpen(true);
  }

  function toggleService(service: string, edit = false) {
    if (edit && editing) {
      setEditing({ ...editing, services: editing.services.includes(service) ? editing.services.filter((item) => item !== service) : [...editing.services, service] });
      return;
    }
    setForm((current) => {
      const sessionServices = current.sessionServices.map((items) => [...items]);
      const currentServices = sessionServices[activeServiceSession] ?? [];
      sessionServices[activeServiceSession] = currentServices.includes(service)
        ? currentServices.filter((item) => item !== service)
        : [...currentServices, service];
      return { ...current, sessionServices };
    });
  }

  async function createAppointment(event: FormEvent) {
    event.preventDefault();
    if (savingForm) return;
    setSavingForm('create');
    const ok = await mutate({
      action: 'create', ...form,
      amountCents: realToCents(form.amount),
      expectedRateBps: cardRateBps(form.paymentMethod, rates),
    }, 'Agendamento criado');
    setSavingForm('');
    if (ok) setNewOpen(false);
  }

  function openEdit(item: Appointment) {
    setEditing({ ...item });
    setEditingOriginalDate(item.scheduledDate);
    setEditOpen(true);
  }

  function openDelete(item: Appointment) {
    setEditing({ ...item });
    setDeleteOpen(true);
  }

  function openPlan(item: Appointment, returnToToday = false) {
    setSelectedPlanGroupId(item.groupId);
    setPlanReturnToToday(returnToToday);
    setPlanOpen(true);
  }

  function closePlan() {
    setPlanOpen(false);
    setSelectedPlanGroupId(null);
    if (planReturnToToday) setTodayOpen(true);
    setPlanReturnToToday(false);
  }

  function editFromOverview(item: Appointment) {
    setTodayOpen(false);
    setPlanOpen(false);
    setPlanReturnToToday(false);
    setSelectedPlanGroupId(null);
    openEdit(item);
  }

  function deleteFromPlan() {
    if (!selectedPlanHead) return;
    setTodayOpen(false);
    setPlanOpen(false);
    setPlanReturnToToday(false);
    setSelectedPlanGroupId(null);
    openDelete(selectedPlanHead);
  }

  function openPlanFromToday(item: Appointment) {
    setTodayOpen(false);
    openPlan(item, true);
  }

  function changeDailyAgendaDate(date: string) {
    setDailyAgendaDate(date);
    setSelectedIds([]);
  }

  async function openRenew(item: Appointment) {
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renew_info', groupId: item.groupId }),
      });
      const data = await response.json() as {
        alreadyRenewed?: boolean;
        renewedAt?: string | null;
        dogName?: string;
        sessionDates?: string[];
        error?: string;
        pendingCount?: number;
      };
      if (!response.ok) {
        const message = data.error === 'plan_incomplete'
          ? `Ainda ${data.pendingCount === 1 ? 'existe 1 banho em aberto' : `existem ${data.pendingCount} banhos em aberto`}. Finalize todas as sessões antes de renovar.`
          : 'Não foi possível conferir a renovação. Tente novamente.';
        setNotice(message);
        window.setTimeout(() => setNotice(''), 4200);
        return;
      }
      if (data.alreadyRenewed) {
        setRenewedWarning({ name: data.dogName || item.dogName || item.ownerName || 'este cliente', renewedAt: data.renewedAt ?? null });
        return;
      }
      setRenewTarget(item);
      setRenewDates(data.sessionDates ?? sessionDatesFor(item.planType, addDays(item.scheduledDate, intervalDaysFor(item.planType))));
      setPlanOpen(false);
      setPlanReturnToToday(false);
      setSelectedPlanGroupId(null);
      setRenewOpen(true);
    } catch {
      setNotice('A conexão falhou ao conferir a renovação. Tente novamente.');
      window.setTimeout(() => setNotice(''), 4200);
    }
  }

  async function confirmRenew() {
    if (!renewTarget || savingForm || renewDates.some((date) => !date)) return;
    setSavingForm('renew');
    const ok = await mutate(
      { action: 'renew', groupId: renewTarget.groupId, sessionDates: renewDates },
      'Plano renovado com as datas escolhidas',
    );
    setSavingForm('');
    if (ok) {
      setRenewOpen(false);
      setRenewTarget(null);
      setRenewDates([]);
    }
  }

  function updatePaid(item: Appointment) {
    if (item.paid) {
      return mutate(
        { action: 'paid', id: item.id, paid: false },
        item.planType === 'single' ? 'Banho marcado como pendente' : 'Plano marcado como pendente',
      );
    }
    setBatchPaymentTargets([]);
    setPaymentTarget(item);
    setPaymentChoice('');
    const registeredAmount = item.amountCents
      ?? appointments.find((appointment) => appointment.groupId === item.groupId && appointment.amountCents !== null)?.amountCents
      ?? null;
    setPaymentAmount(formatMoney(registeredAmount) ?? '');
    setPaymentOpen(true);
  }

  function openBatchPayment(items: Appointment[]) {
    const plans = Array.from(new Map(items.map((item) => [item.groupId, item])).values());
    const missing = plans.filter((item) => item.amountCents === null);
    if (missing.length) {
      setNotice(`Cadastre o valor antes de receber junto: ${missing.map((item) => item.dogName || item.ownerName || 'plano sem nome').join(', ')}.`);
      window.setTimeout(() => setNotice(''), 5200);
      return;
    }
    setBatchPaymentTargets(plans);
    setPaymentTarget(plans[0] ?? null);
    setPaymentChoice('');
    setPaymentAmount(formatMoney(plans.reduce((sum, item) => sum + Number(item.amountCents), 0)) ?? '');
    setPaymentOpen(true);
  }

  function editPaymentMethod(item: Appointment) {
    setBatchPaymentTargets([]);
    setPaymentTarget(item);
    setPaymentChoice(item.paymentMethod);
    setPaymentAmount(formatMoney(item.paymentDetails?.baseCents ?? item.amountCents) ?? '');
    setPaymentOpen(true);
  }

  async function confirmPayment(paymentMethod: Exclude<PaymentMethod, ''>) {
    if (!paymentTarget || paymentLock.current) return;
    if (['credit', 'debit'].includes(paymentMethod) && !paymentPreview(paymentAmount, paymentMethod, rates)) return;
    paymentLock.current = true;
    setPaymentSaving(true);
    const isBatchPayment = batchPaymentTargets.length >= 2;
    const wasPaid = paymentTarget.paid;
    const ok = await mutate(
      isBatchPayment
        ? {
          action: 'paid_multiple',
          ids: batchPaymentTargets.map((item) => item.id),
          paymentMethod,
          expectedRateBps: cardRateBps(paymentMethod, rates),
        }
        : wasPaid
        ? { action: 'payment_method', id: paymentTarget.id, paymentMethod, amountCents: realToCents(paymentAmount), expectedRateBps: cardRateBps(paymentMethod, rates) }
        : { action: 'paid', id: paymentTarget.id, paid: true, paymentMethod, amountCents: realToCents(paymentAmount), expectedRateBps: cardRateBps(paymentMethod, rates) },
      isBatchPayment
        ? `Pagamento de ${batchPaymentTargets.length} planos confirmado`
        : wasPaid
        ? 'Forma de pagamento atualizada'
        : paymentTarget.planType === 'single' ? 'Pagamento do banho confirmado' : 'Pagamento do plano confirmado',
    );
    paymentLock.current = false;
    setPaymentSaving(false);
    if (ok) {
      setPaymentOpen(false);
      setPaymentTarget(null);
      if (isBatchPayment) setSelectedIds([]);
      setBatchPaymentTargets([]);
    }
  }

  async function openCalculator() {
    try {
      const response = await fetch('/api/payment-rates', { cache: 'no-store' });
      if (!response.ok) throw new Error('load_failed');
      const data = await response.json() as { rates: CardRates };
      setRates(data.rates);
      setCalculatorAmount('');
      setCalculatorMethod('credit');
      setCalculatorOpen(true);
    } catch {
      setNotice('Não foi possível carregar as taxas para calcular. Tente novamente.');
      window.setTimeout(() => setNotice(''), 4200);
    }
  }

  async function openRates() {
    try {
      const response = await fetch('/api/payment-rates');
      if (!response.ok) throw new Error('load_failed');
      const data = await response.json() as { rates: CardRates };
      setRates(data.rates);
      setRatesDraft({ credit: (data.rates.credit / 100).toFixed(2).replace('.', ','), debit: (data.rates.debit / 100).toFixed(2).replace('.', ',') });
      setRatesError('');
      setRatesOpen(true);
    } catch {
      setNotice('Não foi possível carregar as taxas. Tente novamente.');
      window.setTimeout(() => setNotice(''), 4200);
    }
  }

  async function saveRates() {
    if (ratesSaving) return;
    const parse = (value: string) => /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value.trim().replace(',', '.')) * 100) : NaN;
    const next = { credit: parse(ratesDraft.credit), debit: parse(ratesDraft.debit) };
    if (Object.values(next).some((value) => !Number.isInteger(value) || value < 0 || value >= 10_000)) {
      setRatesError('Informe taxas entre 0% e 99,99%, com até duas casas decimais.');
      return;
    }
    setRatesSaving(true);
    setRatesError('');
    try {
      const response = await fetch('/api/payment-rates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error('save_failed');
      const data = await response.json() as { rates: CardRates };
      setRates(data.rates);
      setRatesOpen(false);
      setNotice('Taxas salvas para os próximos pagamentos.');
      window.setTimeout(() => setNotice(''), 3500);
    } catch {
      setRatesError('Não foi possível salvar as taxas. Tente novamente.');
    } finally {
      setRatesSaving(false);
    }
  }

  async function persistEdit(recalculateFutureDates: boolean) {
    if (!editing || savingForm) return;
    setSavingForm('edit');
    const dateChanged = editing.scheduledDate !== editingOriginalDate;
    const ok = await mutate({
      action: 'edit', id: editing.id, ownerName: editing.ownerName, dogName: editing.dogName,
      whatsapp: editing.whatsapp, cpf: editing.cpf, paymentMethod: editing.paymentMethod,
      scheduledDate: editing.scheduledDate, scheduledTime: editing.scheduledTime,
      services: editing.services, amountCents: editing.amountCents, recalculateFutureDates,
    }, dateChanged && recalculateFutureDates
      ? 'Atendimento e próximas sessões atualizados'
      : 'Atendimento atualizado');
    setSavingForm('');
    if (ok) {
      setEditDateChoiceOpen(false);
      setEditOpen(false);
    }
    return ok;
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || savingForm) return;
    const hasFutureSessions = editing.planType !== 'single' && editing.sessionNumber < editing.totalSessions;
    if (hasFutureSessions && editing.scheduledDate !== editingOriginalDate) {
      setEditDateChoiceOpen(true);
      return;
    }
    await persistEdit(false);
  }

  async function deleteAppointment() {
    if (!editing || deleteBlockers.length) return;
    const ok = await mutate(
      { action: 'delete', id: editing.id },
      editing.planType === 'single' ? 'Banho avulso apagado' : 'Plano e todos os banhos apagados',
    );
    if (ok) {
      setDeleteOpen(false);
      setEditOpen(false);
      setEditing(null);
    }
  }

  function startDragging(event: DragEvent<HTMLButtonElement>, item: Appointment) {
    setDraggingId(item.id);
    setDropTarget(item.scheduledDate);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
    const card = event.currentTarget.closest('[data-appointment-card]');
    if (card instanceof HTMLElement) event.dataTransfer.setDragImage(card, 22, 22);
  }

  async function moveAppointment(item: Appointment, scheduledDate: string, recalculateFutureDates: boolean) {
    const ok = await mutate(
      { action: 'move', id: item.id, scheduledDate, recalculateFutureDates },
      recalculateFutureDates
        ? `Movido para ${prettyDate(scheduledDate)} e próximas sessões recalculadas`
        : `Movido para ${prettyDate(scheduledDate)}`,
    );
    if (ok) setPendingMove(null);
  }

  async function dropOnDay(event: DragEvent<HTMLElement>, scheduledDate: string) {
    event.preventDefault();
    const id = draggingId || event.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDropTarget(null);
    const item = appointments.find((appointment) => appointment.id === id);
    if (!item || item.scheduledDate === scheduledDate) return;
    if (item.planType !== 'single' && item.sessionNumber < item.totalSessions) {
      setPendingMove({ item, scheduledDate });
      return;
    }
    await moveAppointment(item, scheduledDate, false);
  }

  async function openTeam() {
    setTeamOpen(true);
    setPanelLoading(true);
    try {
      const response = await fetch('/api/team');
      const data = await response.json() as { appointments?: Appointment[]; users?: TeamUser[]; logs?: AuditLog[]; error?: string; blockers?: string[]; pendingCount?: number };
      if (!response.ok) throw new Error('request failed');
      setTeamUsers(data.users ?? []);
    } catch {
      setNotice('Não foi possível carregar a equipe.');
    } finally {
      setPanelLoading(false);
    }
  }

  async function addTeamUser(event: FormEvent) {
    event.preventDefault();
    if (teamSaving) return;
    setTeamSaving(true);
    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const data = await response.json() as { appointments?: Appointment[]; users?: TeamUser[]; logs?: AuditLog[]; error?: string; blockers?: string[]; pendingCount?: number };
      if (!response.ok) {
        setNotice(data.error === 'email_exists'
          ? 'Este e-mail já possui acesso.'
          : data.error === 'password_too_short'
            ? 'A senha precisa ter pelo menos 6 caracteres.'
            : 'Confira os dados informados.');
        return;
      }
      setTeamUsers(data.users ?? []);
      setNewUser({ name: '', email: '', password: '', role: 'staff' });
      setNotice('Novo acesso criado');
    } catch {
      setNotice('Não foi possível criar o acesso.');
    } finally {
      setTeamSaving(false);
    }
  }

  async function updateTeamUser(user: TeamUser, changes: Partial<Pick<TeamUser, 'active' | 'role'>>) {
    try {
      const response = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, active: changes.active ?? user.active, role: changes.role ?? user.role }),
      });
      const data = await response.json() as { appointments?: Appointment[]; users?: TeamUser[]; logs?: AuditLog[]; error?: string; blockers?: string[]; pendingCount?: number };
      if (!response.ok) throw new Error('request failed');
      setTeamUsers(data.users ?? []);
      setNotice(changes.active === false ? 'Acesso desativado' : 'Acesso atualizado');
    } catch {
      setNotice('Não foi possível atualizar o acesso.');
    }
  }

  async function openLogs() {
    setLogsOpen(true);
    setPanelLoading(true);
    try {
      const response = await fetch('/api/audit');
      const data = await response.json() as { appointments?: Appointment[]; users?: TeamUser[]; logs?: AuditLog[]; error?: string; blockers?: string[]; pendingCount?: number };
      if (!response.ok) throw new Error('request failed');
      setAuditLogs(data.logs ?? []);
    } catch {
      setNotice('Não foi possível carregar o histórico.');
    } finally {
      setPanelLoading(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (loginSaving) return;
    setLoginSaving(true);
    setLoginError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await response.json() as { error?: string; email?: string };
      if (!response.ok) {
        if (response.status === 403) {
          setBlockedEmail(data.email ?? loginForm.email);
          setAuthStatus('forbidden');
          return;
        }
        setLoginError(data.error === 'supabase_not_configured'
          ? 'O Supabase ainda não foi configurado neste ambiente.'
          : 'E-mail ou senha incorretos.');
        return;
      }
      window.location.reload();
    } catch {
      setLoginError('Não foi possível entrar. Tente novamente.');
    } finally {
      setLoginSaving(false);
    }
  }

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    setCurrentUser(null);
    setAppointments([]);
    setLoginForm({ email: '', password: '' });
    setLoginError('');
    setAuthStatus('signed_out');
  }

  const loginFields = (
    <form onSubmit={login} className="mt-6 space-y-3 text-left">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-[#6f6179]">E-mail</span>
        <Input required type="email" autoComplete="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="voce@email.com" className="h-12 bg-white" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Senha</span>
        <Input required type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Sua senha" className="h-12 bg-white" />
      </label>
      {loginError && <p role="alert" className="rounded-xl bg-[#f8e7e5] px-3 py-2.5 text-sm font-semibold text-[#973d34]">{loginError}</p>}
      <Button type="submit" disabled={loginSaving} className="h-12 w-full rounded-xl bg-[#7353a6] text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(115,83,166,0.24)] hover:bg-[#5e3f90]">
        {loginSaving ? <LoaderCircle className="animate-spin" /> : <ShieldCheck size={19} />} {loginSaving ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );

  if (authStatus === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f3fb] px-5 text-[#302638]">
        <div className="text-center"><span className="relative mx-auto mb-3 block h-11 w-11"><PawPrint className="absolute inset-0 m-auto text-[#7353a6]" size={27} /><LoaderCircle className="absolute inset-0 animate-spin text-[#b9a5ca]" size={44} /></span><p className="font-heading font-extrabold">Abrindo o HEIN PET SALON...</p></div>
      </main>
    );
  }

  if (authStatus === 'signed_out') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f3fb] px-5 text-[#302638]">
        <section className="w-full max-w-md rounded-3xl border border-[#e4dced] bg-[#fffbff] p-8 text-center shadow-[0_18px_60px_rgba(91,67,116,0.13)]">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#7353a6] text-white"><PawPrint size={28} /></span>
          <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-[#8b7c95]">Pet shop</p>
          <h1 className="mt-1 font-heading text-3xl font-extrabold tracking-[-0.04em]">HEIN PET SALON</h1>
          <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[#786b82]">Entre com o e-mail e a senha cadastrados pela administração.</p>
          {loginFields}
        </section>
      </main>
    );
  }

  if (authStatus === 'forbidden') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f3fb] px-5 text-[#302638]">
        <section className="w-full max-w-md rounded-3xl border border-[#e4dced] bg-[#fffbff] p-8 text-center shadow-[0_18px_60px_rgba(91,67,116,0.13)]">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eee6f7] text-[#7353a6]"><Users size={27} /></span>
          <h1 className="mt-5 font-heading text-2xl font-extrabold">Acesso bloqueado</h1>
          <p className="mt-3 text-sm leading-6 text-[#786b82]">O login existe, mas a flag de acesso ainda não está liberada para:</p>
          {blockedEmail && <p className="mt-2 rounded-xl bg-[#f1ecf7] px-3 py-2 text-sm font-extrabold text-[#7353a6]">{blockedEmail}</p>}
          <button type="button" onClick={() => { setAuthStatus('signed_out'); setBlockedEmail(''); setLoginForm({ email: '', password: '' }); }} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#7353a6] hover:underline"><LogOut size={16} /> Entrar com outra conta</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3fb] text-[#302638]">
      <header className="sticky top-0 z-20 border-b border-[#e4dced] bg-[#fffbff]/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:min-h-20 sm:px-6 lg:px-9">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#7353a6] text-white shadow-sm sm:h-10 sm:w-10"><PawPrint size={20} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.16em] text-[#85768f] sm:block">Pet shop</p>
              <h1 className="truncate font-heading text-base font-extrabold tracking-[-0.03em] sm:text-xl"><span className="sm:hidden">HEIN PET</span><span className="hidden sm:inline">HEIN PET SALON</span></h1>
            </div>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-0.5 sm:gap-2">
            <PwaInstallButton />
            <Button variant="ghost" onClick={openCalculator} title="Calcular valor sem agendamento" className="px-2 text-[#7353a6]"><Calculator /> Calcular</Button>
            {currentUser?.role === 'admin' && (
              <>
                <Button variant="ghost" onClick={openRates} title="Alterar taxas da Stone" className="px-2 text-[#7353a6]"><CreditCard /> Taxas</Button>
                <Button variant="ghost" size="icon-sm" onClick={openLogs} aria-label="Abrir histórico" title="Histórico" className="text-[#685872] sm:h-9 sm:w-9"><History /></Button>
                <Button variant="ghost" size="icon-sm" onClick={openTeam} aria-label="Gerenciar equipe" title="Equipe" className="text-[#685872] sm:h-9 sm:w-9"><Users /></Button>
              </>
            )}
            <div className="hidden text-right md:block">
              <p className="max-w-36 truncate text-xs font-extrabold">{currentUser?.name}</p>
              <p className="text-[10px] font-semibold text-[#8b7c95]">{currentUser?.role === 'admin' ? 'Administrador' : 'Equipe'}</p>
            </div>
            <button type="button" onClick={logout} aria-label="Sair" title="Sair" className="grid h-8 w-8 place-items-center rounded-lg text-[#7f7189] transition hover:bg-[#eee7f5] sm:h-9 sm:w-9"><LogOut size={17} /></button>
            <Button onClick={() => openNew()} className="h-10 rounded-xl bg-[#9b6bc2] px-2.5 font-bold text-white shadow-[0_5px_16px_rgba(115,83,166,0.24)] hover:bg-[#8254a8] sm:h-11 sm:px-4">
              <Plus /> <span className="hidden sm:inline">Novo agendamento</span><span className="sm:hidden">Novo</span>
            </Button>
          </div>
        </div>
      </header>

      {notice && (
        <div role="status" className="pointer-events-none fixed right-3 left-3 bottom-4 z-[70] flex items-center justify-center gap-2 rounded-xl bg-[#3c3047] px-4 py-3 text-sm font-bold text-white shadow-xl sm:right-4 sm:left-auto sm:justify-start">
          <CheckCircle2 size={17} /> {notice}
        </div>
      )}

      <div className="mx-auto grid max-w-[1440px] gap-5 px-3 py-5 sm:gap-7 sm:px-6 sm:py-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-9">
        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
            <div>
              <p className="mb-1 text-sm font-semibold text-[#86778f]">Agenda mensal</p>
              <h2 className="font-heading text-[30px] font-extrabold capitalize tracking-[-0.045em] sm:text-[34px]">{prettyMonth(selectedMonth)}</h2>
              <p className="mt-1 hidden text-xs font-semibold text-[#92849c] sm:block">Arraste pelo ícone <GripVertical className="inline" size={14} /> para trocar o dia</p>
            </div>
            <div className="flex w-full items-center justify-between gap-1.5 rounded-xl border border-[#e4dced] bg-white p-1 shadow-sm sm:w-auto">
              <Button variant="ghost" size="icon-sm" onClick={() => setSelectedMonth((month) => addMonths(month, -1))} aria-label="Mês anterior" title="Mês anterior"><ChevronLeft /></Button>
              <button type="button" onClick={() => setSelectedMonth(today.slice(0, 7))} className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-extrabold capitalize text-[#62556c] transition hover:bg-[#f1ecf7] sm:min-w-36 sm:flex-none"><CalendarDays size={15} /> {selectedMonth === today.slice(0, 7) ? 'Este mês' : 'Voltar para hoje'}</button>
              <Button variant="ghost" size="icon-sm" onClick={() => setSelectedMonth((month) => addMonths(month, 1))} aria-label="Próximo mês" title="Próximo mês"><ChevronRight /></Button>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => { changeDailyAgendaDate(today); setTodayOpen(true); }}
            className="mb-5 h-auto w-full justify-between gap-2 rounded-2xl border border-[#cdbce0] bg-[#7353a6] p-3 text-left text-white shadow-[0_10px_28px_rgba(115,83,166,0.22)] hover:bg-[#684999] sm:mb-6 sm:gap-4 sm:p-5"
          >
            <span className="flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15 font-heading text-xl font-extrabold sm:h-16 sm:w-16 sm:rounded-2xl sm:text-3xl">{Number(today.slice(-2))}</span>
              <span className="min-w-0">
                <span className="block text-xs font-extrabold uppercase tracking-[0.14em] text-[#e8dcf3]">Agenda de hoje</span>
                <span className="mt-1 block truncate font-heading text-lg font-extrabold capitalize sm:text-xl">{prettyDate(today)}</span>
                <span className="mt-1 hidden text-xs font-semibold text-[#eadff4] sm:block">Toque para ver e atualizar os atendimentos</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 sm:gap-4">
              <span className="text-center"><strong className="block font-heading text-2xl font-extrabold">{todayAppointments.length}</strong><small className="text-[10px] font-bold text-[#e8dcf3]">total</small></span>
              <span className="hidden text-center sm:block"><strong className="block font-heading text-2xl font-extrabold">{todayAppointments.filter((item) => item.status === 'scheduled').length}</strong><small className="text-[10px] font-bold text-[#e8dcf3]">em aberto</small></span>
              <span className="hidden text-center sm:block"><strong className="block font-heading text-2xl font-extrabold">{todayAppointments.filter((item) => item.status === 'completed').length}</strong><small className="text-[10px] font-bold text-[#e8dcf3]">concluídos</small></span>
              <ChevronRight className="ml-0 sm:ml-1" size={20} />
            </span>
          </Button>

          {loading ? (
            <div className="rounded-2xl border border-[#e4dced] bg-[#fffbff] p-12 text-center text-sm font-semibold text-[#81748a]"><LoaderCircle className="mx-auto mb-2 animate-spin text-[#7353a6]" /> Carregando agenda...</div>
          ) : (
            <div className="space-y-4">
              {days.map((date) => {
                const dayAppointments = appointments.filter((item) => item.scheduledDate === date);
                return (
                  <article
                    key={date}
                    onDragOver={(event) => {
                      if (!draggingId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropTarget(date);
                    }}
                    onDrop={(event) => dropOnDay(event, date)}
                    className={`overflow-hidden rounded-2xl border bg-[#fffbff] shadow-[0_2px_10px_rgba(91,67,116,0.06)] transition-all ${
                      draggingId && dropTarget === date
                        ? 'border-[#8c6fba] bg-[#f2ecfa] ring-2 ring-[#8c6fba]/25'
                        : 'border-[#e4dced]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-[#ede6f2] px-3.5 py-3 sm:items-center sm:px-5 sm:py-3.5">
                      <div className="min-w-0 sm:flex sm:flex-wrap sm:items-baseline sm:gap-2.5">
                        <h3 className={`font-heading text-lg font-extrabold ${date === today ? 'text-[#7353a6]' : ''}`}>{date === today ? 'Hoje' : date === addDays(today, 1) ? 'Amanhã' : prettyDate(date).split(',')[0]}</h3>
                        <span className="block truncate text-xs font-medium capitalize text-[#81748a] sm:inline sm:text-sm">{prettyDate(date)}</span>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#f1edf5] px-2.5 py-1 text-xs font-bold text-[#776a80]">{dayAppointments.length} {dayAppointments.length === 1 ? 'dog' : 'dogs'}</span>
                    </div>

                    {dayActions(date, dayAppointments)}
                    {dayAppointments.length ? (
                      <div className="divide-y divide-[#eee8f3]">
                        {dayAppointments.map((item) => {
                          const stats = groupStats.get(item.groupId) ?? { completed: 0, absent: 0, scheduled: 0 };
                          const isRenewable = item.planType !== 'single'
                            && item.sessionNumber === item.totalSessions
                            && item.status === 'completed'
                            && stats.scheduled === 0;
                          return (
                            <div
                              key={item.id}
                              data-appointment-card
                              className={`appointment-card relative grid gap-3 px-3.5 py-4 transition sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:pr-5 sm:pl-11 ${cardColors[item.status]} ${selectedIds.includes(item.id) && item.status === 'scheduled' ? 'appointment-selected' : ''} ${draggingId === item.id ? 'opacity-45' : ''}`}
                            >
                              <button
                                type="button"
                                draggable

                                onDragStart={(event) => startDragging(event, item)}
                                onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                                aria-label={`Arrastar ${item.dogName || item.ownerName || 'agendamento'} para outro dia`}
                                title="Arraste para outro dia"
                                className="absolute left-1.5 top-1/2 hidden h-10 w-7 -translate-y-1/2 cursor-grab place-items-center rounded-lg text-[#9b8ca5] transition hover:bg-[#eee7f5] hover:text-[#7353a6] active:cursor-grabbing sm:grid"
                              >
                                <GripVertical size={18} />
                              </button>
                              <div className="flex items-center gap-3 font-heading text-sm font-extrabold text-[#6a5c74] sm:flex-col sm:items-start">
                                {selectionCheckbox(item)}
                                <Clock3 className="sm:hidden" size={15} /> {item.scheduledTime}
                              </div>
                              <div>
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <div className="mr-1">
                                    <button onClick={() => openEdit(item)} className="group/name flex items-center gap-1.5 text-left">
                                      <h4 className="font-heading text-base font-extrabold tracking-[-0.02em]">{item.dogName || 'Cachorro sem nome'}</h4>
                                      <Pencil size={13} className="text-[#9b8ca5] sm:opacity-0 sm:transition sm:group-hover/name:opacity-100" />
                                    </button>
                                    {item.ownerName && <p className="text-[11px] font-semibold text-[#92849c]">Dono: {item.ownerName}</p>}
                                    {item.cpf && <p className="text-[10px] font-semibold text-[#9b8ca5]">CPF: {item.cpf}</p>}
                                  </div>
                                  {item.whatsapp && (
                                    <a
                                      href={whatsappUrl(item.whatsapp)}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={`Abrir WhatsApp de ${item.ownerName || item.dogName || 'cliente'}`}
                                      title={`WhatsApp: ${item.whatsapp}`}
                                      className="grid h-8 w-8 place-items-center rounded-full bg-[#e6f7eb] text-[#1e8b4c] transition hover:bg-[#d5f0de]"
                                    >
                                      <MessageCircle size={17} />
                                    </a>
                                  )}
                                  <span className="rounded-full bg-[#eee6f7] px-2 py-0.5 text-[11px] font-bold text-[#7353a6]">{planLabels[item.planType]} · {item.sessionNumber} de {item.totalSessions}</span>
                                  <span className={`appointment-status ${cardColors[item.status]}`}>{item.status === 'completed' ? <CheckCircle2 size={14} /> : item.status === 'absent' ? <X size={14} /> : <Clock3 size={14} />}{statusLabels[item.status]}</span>
                                  <Button variant="ghost"

                                    title={item.planType === 'single' ? 'Pagamento deste banho' : 'Pagamento único para todo o plano'}
                                    onClick={() => updatePaid(item)}
                                    className={`inline-flex items-center gap-1 text-[11px] font-bold disabled:opacity-50 ${item.paid ? 'text-[#568066]' : 'text-[#c4563c]'}`}
                                  >
                                    <CircleDollarSign size={13} /> {item.planType === 'single' ? (item.paid ? 'Pago' : 'Pendente') : (item.paid ? 'Plano pago' : 'Plano pendente')}
                                  </Button>
                                  {formatMoney(item.amountCents) && <span className="text-[11px] font-semibold text-[#81748a]">{formatMoney(item.amountCents)}</span>}
                                  {item.paymentMethod && <button type="button" onClick={() => editPaymentMethod(item)} title="Alterar forma de pagamento" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7353a6] hover:underline disabled:opacity-50"><CreditCard size={12} /> {paymentMethodLabel(item.paymentMethod)}</button>}
                                </div>
                                <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-[#7d7087]"><Scissors size={14} /> {item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
                                {item.planType !== 'single' && <p className="mt-1.5 text-[11px] font-semibold text-[#92849c]">{stats.completed} concluídas · {stats.absent} faltas</p>}
                                <PaidTotal item={item} />
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1.5">
                                <div className="col-span-2 flex items-center gap-1 sm:contents">
                                  <Button aria-label="Mover para o dia anterior" title="Mover para o dia anterior" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, -1) }, 'Movido para o dia anterior')} className="h-10 w-10 border border-[#ebe4f0] sm:h-8 sm:w-8 sm:border-0"><ChevronLeft /></Button>
                                  <Button aria-label="Mover para o próximo dia" title="Mover para o próximo dia" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, 1) }, 'Movido para o próximo dia')} className="h-10 w-10 border border-[#ebe4f0] sm:h-8 sm:w-8 sm:border-0"><ChevronRight /></Button>
                                  <span className="ml-1 text-xs font-semibold text-[#92849c] sm:hidden">Mover dia</span>
                                </div>
                                {item.planType !== 'single' && <Button variant="outline" onClick={() => openPlan(item)} className="h-11 w-full px-2.5 text-xs font-bold text-[#7353a6] sm:h-9 sm:w-auto"><ListChecks /> Ver plano</Button>}
                                <Button variant="outline" onClick={() => openDelete(item)} className="h-11 w-full border-[#ead0cc] px-2.5 text-xs font-bold text-[#a94338] hover:bg-[#fbefed] hover:text-[#92382f] sm:h-9 sm:w-auto"><Trash2 /> {item.planType === 'single' ? 'Apagar banho' : 'Apagar plano'}</Button>
                                {isRenewable ? (
                                  <Button onClick={() => openRenew(item)} className="h-11 w-full bg-[#9b6bc2] px-3 text-xs font-bold text-white hover:bg-[#8254a8] sm:h-9 sm:w-auto"><RefreshCw /> Renovar</Button>
                                ) : item.status === 'scheduled' ? (
                                  <>
                                    <Button variant="outline" onClick={() => mutate({ action: 'status', id: item.id, status: 'absent' }, 'Falta registrada')} className="h-11 w-full px-2.5 text-xs font-bold text-[#93503f] sm:h-9 sm:w-auto"><X /> Falta</Button>
                                    <Button onClick={() => mutate({ action: 'status', id: item.id, status: 'completed' }, 'Atendimento concluído')} className="h-11 w-full bg-[#7353a6] px-3 text-xs font-bold text-white hover:bg-[#5e3f90] sm:h-9 sm:w-auto"><Check /> Concluir</Button>
                                  </>
                                ) : (
                                  <Button variant="ghost" onClick={() => mutate({ action: 'status', id: item.id, status: 'scheduled' }, 'Atendimento reaberto')} className="col-span-2 h-11 w-full px-2.5 text-xs font-bold text-[#76687f] sm:h-9 sm:w-auto">{item.status === 'completed' ? 'Concluído' : 'Faltou'} · reabrir</Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <button onClick={() => openNew(date)} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold text-[#81748a] transition hover:bg-white">
                        <span className="grid h-8 w-8 place-items-center rounded-lg border border-dashed border-[#c5b7d3]">{draggingId && dropTarget === date ? <Check size={16} /> : <Plus size={16} />}</span>{draggingId && dropTarget === date ? 'Solte aqui para mudar o dia' : 'Adicionar dog neste dia'}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-[108px] lg:self-start">
          <div className="rounded-2xl bg-[#7353a6] p-5 text-white shadow-[0_10px_30px_rgba(115,83,166,0.22)]">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#e4d8f1]">Resumo de hoje</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div><strong className="font-heading text-3xl">{todayAppointments.length}</strong><span className="mt-1 block text-[11px] text-[#eee5f7]">agendados</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'completed').length}</strong><span className="mt-1 block text-[11px] text-[#eee5f7]">concluídos</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'absent').length}</strong><span className="mt-1 block text-[11px] text-[#eee5f7]">faltas</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e4dced] bg-[#fffbff] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading font-extrabold">Atenção</h3>
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#f3ded7] px-1.5 text-xs font-extrabold text-[#b84f34]">{pendingGroups.length + renewalItems.length}</span>
            </div>
            {pendingGroups.length + renewalItems.length === 0 ? (
              <p className="rounded-xl bg-[#f1ecf7] p-3 text-sm font-semibold text-[#81748a]">Tudo em dia por aqui.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {pendingGroups.slice(0, 3).map((item) => (
                  <Button variant="ghost" key={`pending-${item.groupId}`} onClick={() => updatePaid(item)} className="h-auto w-full flex-wrap justify-start whitespace-normal rounded-xl bg-[#f7eee9] p-3 text-left transition hover:bg-[#f2e3da] disabled:opacity-50">
                    <p className="font-bold">{item.dogName || item.ownerName || 'Sem nome'} · {item.planType === 'single' ? 'banho pendente' : 'plano pendente'}</p><p className="mt-1 text-xs text-[#7e7771]">{item.planType === 'single' ? 'Toque para marcar o banho como pago' : 'Toque para marcar todas as sessões como pagas'}</p>
                  </Button>
                ))}
                {renewalItems.slice(0, 3).map((item) => (
                  <Button variant="ghost" key={`renew-${item.id}`} onClick={() => openRenew(item)} className="h-auto w-full flex-wrap justify-start whitespace-normal rounded-xl bg-[#f1ecf7] p-3 text-left transition hover:bg-[#e9e0f3] disabled:opacity-50">
                    <p className="font-bold">{item.dogName || item.ownerName || 'Sem nome'} · última sessão</p><p className="mt-1 text-xs font-extrabold text-[#7353a6]">Renovar plano →</p>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={todayOpen} onOpenChange={setTodayOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-2xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><CalendarDays className="text-[#7353a6]" /> {dailyAgendaDate === today ? 'Atendimentos de hoje' : 'Agenda do dia'}</DialogTitle>
            <DialogDescription className="capitalize">{prettyDate(dailyAgendaDate)} · {dailyAppointments.length} {dailyAppointments.length === 1 ? 'atendimento' : 'atendimentos'}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 rounded-2xl border border-[#e4dced] bg-[#f7f3fb] p-3">
            <Button type="button" variant="outline" size="icon" onClick={() => changeDailyAgendaDate(addDays(dailyAgendaDate, -1))} aria-label="Dia anterior" title="Dia anterior"><ChevronLeft /></Button>
            <label className="min-w-0">
              <span className="mb-1 block text-xs font-bold text-[#6f6179]">Escolher data</span>
              <Input type="date" value={dailyAgendaDate} onChange={(event) => { if (event.target.value) changeDailyAgendaDate(event.target.value); }} className="h-10 min-w-0 bg-white" />
            </label>
            <Button type="button" variant="outline" size="icon" onClick={() => changeDailyAgendaDate(addDays(dailyAgendaDate, 1))} aria-label="Próximo dia" title="Próximo dia"><ChevronRight /></Button>
            {dailyAgendaDate !== today && <Button type="button" variant="ghost" onClick={() => changeDailyAgendaDate(today)} className="col-span-3 h-9 text-xs font-bold text-[#7353a6]"><CalendarDays /> Voltar para hoje</Button>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#f1edf5] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#7353a6]">{dailyAppointments.filter((item) => item.status === 'scheduled').length}</strong><span className="block text-[10px] font-bold text-[#81748a]">em aberto</span></div>
            <div className="rounded-xl bg-[#e8f4eb] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#4f765c]">{dailyAppointments.filter((item) => item.status === 'completed').length}</strong><span className="block text-[10px] font-bold text-[#678471]">concluídos</span></div>
            <div className="rounded-xl bg-[#f7e7e2] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#ad533d]">{dailyAppointments.filter((item) => item.status === 'absent').length}</strong><span className="block text-[10px] font-bold text-[#956c61]">faltas</span></div>
          </div>
          {dayActions(dailyAgendaDate, dailyAppointments)}
          {dailyAppointments.length ? (
            <div className="space-y-2.5">
              {dailyAppointments.map((item) => (
                <article key={`today-${item.id}`} className={`appointment-card rounded-2xl border p-4 ${cardColors[item.status]} ${selectedIds.includes(item.id) && item.status === 'scheduled' ? 'appointment-selected' : ''}`}>
                  {item.status === 'scheduled' && <label className="mb-3 flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold">{selectionCheckbox(item)} Selecionar banho</label>}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-10 min-w-14 shrink-0 place-items-center rounded-xl bg-[#eee6f7] px-2 font-heading text-sm font-extrabold text-[#7353a6]">{item.scheduledTime}</span>
                      <div>
                        <p className="font-heading text-base font-extrabold">{item.dogName || 'Cachorro sem nome'}</p>
                        {item.ownerName && <p className="text-[11px] font-semibold text-[#92849c]">Dono: {item.ownerName}</p>}
                        {item.cpf && <p className="text-[10px] font-semibold text-[#9b8ca5]">CPF: {item.cpf}</p>}
                        <p className="mt-1 text-xs text-[#81748a]">{planLabels[item.planType]} · sessão {item.sessionNumber} de {item.totalSessions}</p>
                        {item.paymentMethod && <button type="button" onClick={() => editPaymentMethod(item)} className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[#7353a6] hover:underline disabled:opacity-50"><CreditCard size={12} /> {paymentMethodLabel(item.paymentMethod)}</button>}
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.status === 'completed' ? 'bg-[#e8f4eb] text-[#4f765c]' : item.status === 'absent' ? 'bg-[#f7e7e2] text-[#ad533d]' : 'bg-[#f1edf5] text-[#776a80]'}`}>{statusLabels[item.status]}</span>
                  </div>
                  <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-[#7d7087]"><Scissors size={13} /> {item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
                  <PaidTotal item={item} />
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#eee8f3] pt-3 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
                    {item.whatsapp && <a href={whatsappUrl(item.whatsapp)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#e6f7eb] px-3 text-xs font-bold text-[#1e8b4c] sm:grid sm:h-8 sm:w-8 sm:p-0" aria-label="Abrir WhatsApp"><MessageCircle size={16} /><span className="sm:hidden">WhatsApp</span></a>}
                    <Button variant="outline" size="sm" onClick={() => editFromOverview(item)} className="h-11 w-full sm:h-8 sm:w-auto"><Pencil /> Editar</Button>
                    {item.planType !== 'single' && <Button variant="outline" size="sm" onClick={() => openPlanFromToday(item)} className="h-11 w-full text-[#7353a6] sm:h-8 sm:w-auto"><ListChecks /> Ver plano</Button>}
                    {item.status === 'scheduled' ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => mutate({ action: 'status', id: item.id, status: 'absent' }, 'Falta registrada')} className="h-11 w-full text-[#93503f] sm:h-8 sm:w-auto"><X /> Falta</Button>
                        <Button size="sm" onClick={() => mutate({ action: 'status', id: item.id, status: 'completed' }, 'Atendimento concluído')} className="h-11 w-full bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90] sm:h-8 sm:w-auto"><Check /> Concluir</Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => mutate({ action: 'status', id: item.id, status: 'scheduled' }, 'Atendimento reaberto')} className="h-11 w-full font-bold text-[#76687f] sm:h-8 sm:w-auto">Reabrir</Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#cdbce0] bg-[#f7f3fb] p-7 text-center">
              <Dog className="mx-auto text-[#9b6bc2]" size={28} />
              <p className="mt-2 font-heading font-extrabold">Nenhum atendimento nesta data</p>
              <p className="mt-1 text-xs text-[#81748a]">Você pode cadastrar um banho para esta data.</p>
              <Button onClick={() => { setTodayOpen(false); openNew(dailyAgendaDate); }} className="mt-4 bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90]"><Plus /> Novo atendimento</Button>
            </div>
          )}
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button variant="outline" onClick={() => setTodayOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={(open) => { if (open) setPlanOpen(true); else closePlan(); }}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-2xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><ListChecks className="text-[#7353a6]" /> Atendimentos do plano</DialogTitle>
            <DialogDescription>
              {selectedPlanHead
                ? `${selectedPlanHead.dogName || 'Cachorro sem nome'}${selectedPlanHead.ownerName ? ` · dono: ${selectedPlanHead.ownerName}` : ''}${selectedPlanHead.cpf ? ` · CPF: ${selectedPlanHead.cpf}` : ''}`
                : 'Todas as sessões deste plano.'}
            </DialogDescription>
          </DialogHeader>
          {selectedPlanHead && (
            <div className="rounded-2xl border border-[#dcd0e8] bg-[#f7f3fb] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#eee6f7] px-2.5 py-1 text-xs font-extrabold text-[#7353a6]">Plano {planLabels[selectedPlanHead.planType]}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${selectedPlanHead.paid ? 'bg-[#e8f4eb] text-[#4f765c]' : 'bg-[#f7e7e2] text-[#ad533d]'}`}>{selectedPlanHead.paid ? 'Plano pago' : 'Plano pendente'}</span>
                  {formatMoney(selectedPlanHead.amountCents) && <span className="text-xs font-bold text-[#6f6179]">{formatMoney(selectedPlanHead.amountCents)}</span>}
                  {selectedPlanHead.paymentMethod && <button type="button" onClick={() => editPaymentMethod(selectedPlanHead)} title="Alterar forma de pagamento" className="inline-flex items-center gap-1 text-xs font-bold text-[#7353a6] hover:underline disabled:opacity-50"><CreditCard size={13} /> {paymentMethodLabel(selectedPlanHead.paymentMethod)}</button>}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-bold text-[#81748a]">
                  <span>{selectedPlanStats.completed} concluídos</span><span>·</span><span>{selectedPlanStats.absent} faltas</span><span>·</span><span>{selectedPlanStats.scheduled} abertos</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e5dced] pt-3 sm:flex sm:flex-wrap sm:items-center">
                {selectedPlanHead.whatsapp && <a href={whatsappUrl(selectedPlanHead.whatsapp)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#e6f7eb] px-3 text-xs font-bold text-[#1e8b4c] sm:grid sm:h-9 sm:w-9 sm:p-0" aria-label="Abrir WhatsApp"><MessageCircle size={17} /><span className="sm:hidden">WhatsApp</span></a>}
                <Button

                  variant="outline"
                  onClick={() => updatePaid(selectedPlanHead)}
                  className={`h-11 w-full sm:h-9 sm:w-auto ${selectedPlanHead.paid ? 'font-bold text-[#568066]' : 'font-bold text-[#c4563c]'}`}
                >
                  <CircleDollarSign /> {selectedPlanHead.paid ? 'Marcar pendente' : 'Marcar plano pago'}
                </Button>
                <Button variant="outline" onClick={deleteFromPlan} className="h-11 w-full border-[#ead0cc] font-bold text-[#a94338] hover:bg-[#fbefed] hover:text-[#92382f] sm:h-9 sm:w-auto"><Trash2 /> Apagar plano</Button>
              </div>
              <PaidTotal item={selectedPlanHead} />
            </div>
          )}
          <div className="space-y-2.5">
            {selectedPlan.map((session) => (
              <article key={session.id} className={`appointment-card rounded-2xl border p-4 ${cardColors[session.status]}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eee6f7] font-heading text-sm font-extrabold text-[#7353a6]">{session.sessionNumber}</span>
                    <div>
                      <p className="font-heading text-sm font-extrabold">Sessão {session.sessionNumber} de {session.totalSessions} · {session.scheduledTime}</p>
                      <p className="mt-0.5 text-xs font-semibold capitalize text-[#81748a]">{prettyDate(session.scheduledDate)}</p>
                      <p className="mt-1 text-xs text-[#81748a]">{session.services.length ? session.services.join(' · ') : 'Sem serviços definidos'}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${session.status === 'completed' ? 'bg-[#e8f4eb] text-[#4f765c]' : session.status === 'absent' ? 'bg-[#f7e7e2] text-[#ad533d]' : 'bg-[#f1edf5] text-[#776a80]'}`}>{statusLabels[session.status]}</span>
                </div>
                <div className="mt-3 grid gap-2 border-t border-[#eee8f3] pt-3 sm:grid-cols-[minmax(170px,1fr)_auto] sm:items-end">
                  <label>
                    <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8b7c95]">Alterar data</span>
                    <Input
                      type="date"

                      value={session.scheduledDate}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        mutate(
                          { action: 'move', id: session.id, scheduledDate: event.target.value },
                          session.sessionNumber === session.totalSessions ? 'Data do banho atualizada' : 'Data e próximas sessões atualizadas',
                        );
                      }}
                      className="h-9 bg-white"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1.5">
                    <div className="col-span-2 flex items-center gap-1 sm:contents">
                      <Button variant="ghost" size="icon-sm" aria-label="Mover para o dia anterior" title="Mover para o dia anterior" onClick={() => mutate({ action: 'move', id: session.id, scheduledDate: addDays(session.scheduledDate, -1) }, 'Movido para o dia anterior')} className="h-10 w-10 border border-[#ebe4f0] sm:h-8 sm:w-8 sm:border-0"><ChevronLeft /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Mover para o próximo dia" title="Mover para o próximo dia" onClick={() => mutate({ action: 'move', id: session.id, scheduledDate: addDays(session.scheduledDate, 1) }, 'Movido para o próximo dia')} className="h-10 w-10 border border-[#ebe4f0] sm:h-8 sm:w-8 sm:border-0"><ChevronRight /></Button>
                      <span className="ml-1 text-xs font-semibold text-[#92849c] sm:hidden">Mover dia</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => editFromOverview(session)} className="h-11 w-full sm:h-8 sm:w-auto"><Pencil /> Editar sessão</Button>
                    {session.status === 'scheduled' ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => mutate({ action: 'status', id: session.id, status: 'absent' }, 'Falta registrada')} className="h-11 w-full text-[#93503f] sm:h-8 sm:w-auto"><X /> Falta</Button>
                        <Button size="sm" onClick={() => mutate({ action: 'status', id: session.id, status: 'completed' }, 'Atendimento concluído')} className="h-11 w-full bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90] sm:h-8 sm:w-auto"><Check /> Concluir</Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => mutate({ action: 'status', id: session.id, status: 'scheduled' }, 'Atendimento reaberto')} className="h-11 w-full font-bold text-[#76687f] sm:h-8 sm:w-auto">Reabrir</Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button variant="outline" onClick={closePlan}>{planReturnToToday ? 'Voltar para atendimentos de hoje' : 'Fechar'}</Button>
            {selectedPlanIsRenewable && selectedPlanHead && (
              <Button
                onClick={() => openRenew(selectedPlanHead)}
                className="bg-[#9b6bc2] font-bold text-white hover:bg-[#8254a8]"
              >
                <RefreshCw /> Renovar plano
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renewOpen} onOpenChange={(open) => {
        if (savingForm === 'renew') return;
        setRenewOpen(open);
        if (!open) {
          setRenewTarget(null);
          setRenewDates([]);
        }
      }}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-lg sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><RefreshCw className="text-[#7353a6]" /> Renovar plano</DialogTitle>
            <DialogDescription>
              {renewTarget
                ? `${renewTarget.dogName || renewTarget.ownerName || 'Cliente sem nome'} · novo plano ${planLabels[renewTarget.planType].toLowerCase()}`
                : 'Escolha as datas do novo plano.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-[#d9c5eb] bg-[#f3eafa] p-3 text-sm leading-6 text-[#6f6179]">
            Confira as datas antes de renovar. A primeira mantém o intervalo do plano anterior, mas você pode ajustar cada sessão.
          </div>
          <div className="space-y-3">
            {renewDates.map((date, index) => (
              <label key={index} className="block rounded-xl border border-[#e4dced] bg-white p-3">
                <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-bold text-[#6f6179]">
                  <span>Sessão {index + 1}</span>
                  <span className="font-semibold capitalize text-[#92849c]">{date ? prettyDate(date).split(',')[0] : ''}</span>
                </span>
                <Input
                  type="date"
                  value={date}
                  disabled={savingForm === 'renew'}
                  onChange={(event) => {
                    if (!event.target.value || !renewTarget) return;
                    if (index === 0) {
                      setRenewDates(sessionDatesFor(renewTarget.planType, event.target.value));
                      return;
                    }
                    const dates = [...renewDates];
                    dates[index] = event.target.value;
                    setRenewDates(dates);
                  }}
                  className="h-11 bg-[#fffbff]"
                />
              </label>
            ))}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button type="button" variant="outline" disabled={savingForm === 'renew'} onClick={() => {
              setRenewOpen(false);
              setRenewTarget(null);
              setRenewDates([]);
            }}>Cancelar</Button>
            <Button type="button" disabled={savingForm === 'renew' || renewDates.some((date) => !date)} onClick={confirmRenew}><RefreshCw /> Confirmar renovação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(renewedWarning)} onOpenChange={(open) => { if (!open) setRenewedWarning(null); }}>
        <AlertDialogContent className="mobile-alert max-w-[calc(100%-1.5rem)] border-0 bg-[#fffbff]">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-[#f3eafa] text-[#7353a6]"><RefreshCw /></AlertDialogMedia>
            <AlertDialogTitle className="font-heading font-extrabold">Este plano já foi renovado</AlertDialogTitle>
            <AlertDialogDescription>
              O plano de {renewedWarning?.name} já possui uma renovação{renewedWarning?.renewedAt ? ` registrada em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(renewedWarning.renewedAt))}` : ''}. Nenhum novo plano foi criado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Entendi</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={calculatorOpen} onOpenChange={setCalculatorOpen}>
        <DialogContent className="mobile-sheet border-0 bg-[#fffbff] p-4 sm:max-w-md sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><Calculator className="text-[#7353a6]" /> Calcular valor a cobrar</DialogTitle>
            <DialogDescription>Simule com as taxas salvas, sem cadastrar banho nem registrar pagamento.</DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-semibold">Valor que deseja receber, sem taxa
            <Input autoFocus inputMode="numeric" value={calculatorAmount} onChange={(event) => setCalculatorAmount(maskReal(event.target.value))} placeholder="R$ 0,00" className="mt-2 h-11 bg-white" />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Forma de pagamento</legend>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.filter((method) => method === 'credit' || method === 'debit').map((method) => (
                <Button key={method} type="button" variant="outline" onClick={() => setCalculatorMethod(method)} aria-pressed={calculatorMethod === method}
                  className={`h-auto min-h-12 flex-wrap justify-start whitespace-normal font-bold ${calculatorMethod === method ? 'border-[#7353a6] bg-[#eee6f7] text-[#7353a6]' : 'border-[#dfd5e8] bg-white'}`}>
                  <CreditCard /> {paymentMethodLabels[method]}
                  <span className="text-xs">{['credit', 'debit'].includes(method) ? `${(cardRateBps(method, rates) / 100).toLocaleString('pt-BR')}%${method === 'credit' ? ' · à vista' : ''}` : 'Sem taxa'}</span>
                </Button>
              ))}
            </div>
          </fieldset>
          <PaymentSummary amount={calculatorAmount} method={calculatorMethod} rates={rates} baseLabel="Valor a receber" />
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button variant="outline" onClick={() => setCalculatorAmount('')}>Limpar valor</Button>
            <Button onClick={() => setCalculatorOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ratesOpen} onOpenChange={(open) => { if (!ratesSaving) setRatesOpen(open); }}>
        <DialogContent className="mobile-sheet border-0 bg-[#fffbff] p-4 sm:max-w-md sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><CreditCard className="text-[#7353a6]" /> Taxas da Stone</DialogTitle>
            <DialogDescription>Defina os percentuais usados para calcular o valor a cobrar no cartão.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Crédito à vista (%)
              <Input autoFocus disabled={ratesSaving} inputMode="decimal" value={ratesDraft.credit} onChange={(event) => setRatesDraft({ ...ratesDraft, credit: event.target.value })} placeholder="3,08" className="mt-2 h-11 bg-white" />
            </label>
            <label className="text-sm font-semibold">Débito (%)
              <Input disabled={ratesSaving} inputMode="decimal" value={ratesDraft.debit} onChange={(event) => setRatesDraft({ ...ratesDraft, debit: event.target.value })} placeholder="0,87" className="mt-2 h-11 bg-white" />
            </label>
          </div>
          <p className="rounded-xl bg-[#f1ecf7] p-3 text-sm leading-6 text-[#6f6179]">As alterações valem para os próximos pagamentos. Pagamentos já registrados mantêm a taxa original. Pix e dinheiro continuam sem acréscimo.</p>
          {ratesError && <p role="alert" className="text-sm font-semibold text-red-700">{ratesError}</p>}
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button variant="outline" disabled={ratesSaving} onClick={() => setRatesOpen(false)}>Cancelar</Button>
            <Button disabled={ratesSaving} onClick={saveRates}><Check /> {ratesSaving ? 'Salvando...' : 'Salvar taxas'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={(open) => {
        if (paymentLock.current) return;
        setPaymentOpen(open);
        if (!open) {
          setPaymentTarget(null);
          setBatchPaymentTargets([]);
        }
      }}>
        <DialogContent className="mobile-sheet border-0 bg-[#fffbff] p-4 sm:max-w-md sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><CircleDollarSign className="text-[#7353a6]" /> {batchPaymentTargets.length >= 2 ? 'Receber planos juntos' : paymentTarget?.paid ? 'Alterar forma de pagamento' : 'Confirmar pagamento'}</DialogTitle>
            <DialogDescription>
              {batchPaymentTargets.length >= 2
                ? `${batchPaymentTargets.length} planos selecionados. Escolha a forma de pagamento para calcular o valor total.`
                : paymentTarget?.planType === 'single' ? 'Como este banho foi pago?' : `Como o plano de ${paymentTarget?.dogName || paymentTarget?.ownerName || 'cliente sem nome'} foi pago?`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {paymentMethods.map((method) => (
              <Button
                key={method}
                type="button"
                variant="outline"

                disabled={paymentSaving}
                onClick={() => setPaymentChoice(method)}
                aria-pressed={paymentChoice === method}
                className={`h-auto min-h-12 flex-wrap justify-start whitespace-normal font-bold ${paymentChoice === method ? 'border-[#7353a6] bg-[#eee6f7] text-[#7353a6]' : 'border-[#dfd5e8] bg-white'}`}
              >
                <CreditCard /> {paymentMethodLabels[method]}{['credit', 'debit'].includes(method) && <span className="text-xs">{(cardRateBps(method, rates) / 100).toLocaleString('pt-BR')}%{method === 'credit' ? ' · à vista' : ''}</span>}
              </Button>
            ))}
          </div>
          <label className="block text-sm font-semibold">{batchPaymentTargets.length >= 2 ? 'Valor somado dos planos, sem taxa' : 'Valor cadastrado do banho/plano, sem taxa'}
            <Input disabled={paymentSaving} readOnly={batchPaymentTargets.length >= 2} inputMode="numeric" value={paymentAmount} onChange={(event) => setPaymentAmount(maskReal(event.target.value))} placeholder="R$ 0,00" className="mt-2 h-11 bg-white read-only:bg-[#f3eef7]" />
          </label>
          <PaymentSummary amount={paymentAmount} method={paymentChoice} rates={rates} baseLabel={batchPaymentTargets.length >= 2 ? 'Total dos planos' : 'Valor do banho/plano'} />
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button type="button" variant="outline" disabled={paymentSaving} onClick={() => {
              setPaymentOpen(false);
              setPaymentTarget(null);
              setBatchPaymentTargets([]);
            }}>Cancelar</Button>
            <Button type="button" disabled={!paymentChoice || (['credit', 'debit'].includes(paymentChoice) && !paymentPreview(paymentAmount, paymentChoice, rates))} onClick={() => paymentChoice ? confirmPayment(paymentChoice) : undefined}><Check /> {batchPaymentTargets.length >= 2 ? `Confirmar ${batchPaymentTargets.length} planos` : 'Confirmar recebimento'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-extrabold tracking-[-0.03em]">Novo agendamento</DialogTitle>
            <DialogDescription>Defina o primeiro banho e, se precisar, escolha uma data diferente para cada sessão.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createAppointment} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><UserRound size={14} /> Nome do dono</span><Input autoFocus value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Ex.: Ana" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><Dog size={14} /> Nome do cachorro</span><Input value={form.dogName} onChange={(event) => setForm({ ...form, dogName: event.target.value })} placeholder="Ex.: Bob" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><MessageCircle size={14} /> WhatsApp</span><Input type="tel" inputMode="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} placeholder="(47) 99999-9999" className="h-11 bg-white" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><IdCard size={14} /> CPF (opcional)</span><Input inputMode="numeric" value={form.cpf} onChange={(event) => setForm({ ...form, cpf: maskCpf(event.target.value) })} placeholder="000.000.000-00" className="h-11 bg-white" /></label>
            </div>
            <div>
              <span className="mb-2 block text-xs font-bold text-[#6f6179]">Tipo de plano</span>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(planLabels) as PlanType[]).map((plan) => (
                  <button
                    type="button"
                    key={plan}
                    onClick={() => {
                      const count = totalSessionsFor(plan);
                      setForm({
                        ...form,
                        planType: plan,
                        sessionServices: Array.from(
                          { length: count },
                          (_, index) => form.sessionServices[index] ?? ['Banho'],
                        ),
                        sessionCompleted: Array.from(
                          { length: count },
                          (_, index) => form.sessionCompleted[index] ?? false,
                        ),
                        sessionDates: sessionDatesFor(plan, form.scheduledDate),
                      });
                      setActiveServiceSession(0);
                    }}
                    className={`rounded-xl border p-2.5 text-left transition sm:p-3 ${form.planType === plan ? 'border-[#7353a6] bg-[#eee6f7] ring-1 ring-[#7353a6]' : 'border-[#e4dced] bg-white hover:border-[#bbaacd]'}`}
                  >
                    <strong className="block text-xs sm:text-sm">{planLabels[plan]}</strong><span className="mt-1 block text-[10px] leading-4 text-[#81748a] sm:text-[11px]">{planDescriptions[plan]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Primeiro banho</span><Input type="date" value={form.scheduledDate} onChange={(event) => {
                const scheduledDate = event.target.value;
                setForm({ ...form, scheduledDate, sessionDates: sessionDatesFor(form.planType, scheduledDate) });
              }} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Horário</span><Input type="time" value={form.scheduledTime} onChange={(event) => setForm({ ...form, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Valor (opcional)</span><Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: maskReal(event.target.value) })} placeholder="R$ 0,00" className="h-11 bg-white font-semibold tabular-nums" /></label>
            </div>
            <div className="min-w-0 rounded-2xl border border-[#e4dced] bg-white p-3.5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><Scissors size={14} /> Datas e serviços por sessão</span>
                {totalSessionsFor(form.planType) > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const selected = form.sessionServices[activeServiceSession] ?? [];
                      setForm({
                        ...form,
                        sessionServices: Array.from({ length: totalSessionsFor(form.planType) }, () => [...selected]),
                      });
                    }}
                    className="text-[11px] font-extrabold text-[#7353a6] hover:underline"
                  >
                    Repetir serviços em todas
                  </button>
                )}
              </div>
              <div className="mb-3 flex max-w-full gap-2 overflow-x-auto pb-1">
                {Array.from({ length: totalSessionsFor(form.planType) }, (_, index) => {
                  const date = form.sessionDates[index] ?? addDays(form.scheduledDate, intervalDaysFor(form.planType) * index);
                  return (
                    <button
                      type="button"
                      key={index}
                      onClick={() => setActiveServiceSession(index)}
                      className={`min-w-[92px] rounded-xl border px-3 py-2 text-left transition ${activeServiceSession === index ? 'border-[#7353a6] bg-[#eee6f7] ring-1 ring-[#7353a6]' : 'border-[#ded7e7] bg-[#fbf9fd]'}`}
                    >
                      <strong className="flex items-center gap-1 text-xs">Sessão {index + 1}{form.sessionCompleted[index] && <CheckCircle2 size={13} className="text-[#4f765c]" />}</strong>
                      <span className="mt-0.5 block text-[10px] capitalize text-[#81748a]">{new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`))}</span>
                    </button>
                  );
                })}
              </div>
              <label className="mb-3 block rounded-xl border border-[#e4dced] bg-[#faf7fc] p-3">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><CalendarDays size={14} /> Data da sessão {activeServiceSession + 1}</span>
                <Input type="date" value={form.sessionDates[activeServiceSession] ?? form.scheduledDate} onChange={(event) => {
                  if (activeServiceSession === 0) {
                    const scheduledDate = event.target.value;
                    setForm({
                      ...form,
                      scheduledDate,
                      sessionDates: sessionDatesFor(form.planType, scheduledDate),
                    });
                    return;
                  }
                  const sessionDates = [...form.sessionDates];
                  sessionDates[activeServiceSession] = event.target.value;
                  setForm({ ...form, sessionDates });
                }} className="h-11 bg-white" />
                <small className="mt-1.5 block text-xs text-[#85768f]">
                  {activeServiceSession === 0
                    ? 'Ao mudar a primeira sessão, as próximas são recalculadas no mesmo dia da semana.'
                    : 'Você pode escolher um dia diferente somente para este banho.'}
                </small>
              </label>
              <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-xl border border-[#e4dced] bg-[#faf7fc] p-3">
                <Checkbox
                  checked={form.sessionCompleted[activeServiceSession] ?? false}
                  onCheckedChange={(checked) => {
                    const sessionCompleted = [...form.sessionCompleted];
                    sessionCompleted[activeServiceSession] = checked === true;
                    setForm({ ...form, sessionCompleted });
                  }}
                  className="mt-0.5 size-5"
                />
                <span>
                  <strong className="block text-sm text-[#4f4358]">Esta sessão já foi realizada</strong>
                  <small className="mt-0.5 block text-xs text-[#85768f]">Será cadastrada como concluída</small>
                </span>
              </label>
              <p className="mb-2 text-[11px] font-semibold text-[#81748a]">Escolha o que foi ou será feito na sessão {activeServiceSession + 1}</p>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((service) => {
                  const selected = (form.sessionServices[activeServiceSession] ?? []).includes(service);
                  return <button type="button" key={service} onClick={() => toggleService(service)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? 'border-[#7353a6] bg-[#7353a6] text-white' : 'border-[#e4dced] bg-white text-[#6f6179]'}`}>{selected && <Check className="mr-1 inline" size={13} />}{service}</button>;
                })}
              </div>
            </div>
            <div className="rounded-xl border border-[#e4dced] bg-white p-3.5">
              <label className="flex cursor-pointer items-center justify-between"><span><strong className="block text-sm">{form.planType === 'single' ? 'O banho já está pago?' : 'O plano já está pago?'}</strong><small className="text-xs text-[#85768f]">{form.planType === 'single' ? 'Você pode mudar isso depois' : `Pagamento único para todas as ${totalSessionsFor(form.planType)} sessões`}</small></span><Switch checked={form.paid} onCheckedChange={(checked) => setForm({ ...form, paid: checked, paymentMethod: checked ? form.paymentMethod : '' })} /></label>
              {form.paid && (
                <label className="mt-3 block border-t border-[#eee8f3] pt-3"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><CreditCard size={14} /> Como foi pago?</span><select required value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as PaymentMethod })} className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#7353a6]/30"><option value="">Escolha a forma de pagamento</option><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="debit">Cartão de débito</option><option value="credit">Cartão de crédito</option></select></label>
              )}
            </div>
            {form.paid && <PaymentSummary amount={form.amount} method={form.paymentMethod} rates={rates} />}
            <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={Boolean(savingForm) || (form.paid && ['credit', 'debit'].includes(form.paymentMethod) && !paymentPreview(form.amount, form.paymentMethod, rates))} className="bg-[#9b6bc2] font-bold text-white hover:bg-[#8254a8]">{savingForm === 'create' ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {savingForm === 'create' ? 'Salvando...' : 'Criar agendamento'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditDateChoiceOpen(false); }}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-lg sm:p-5">
          <DialogHeader><DialogTitle className="font-heading text-xl font-extrabold">Editar atendimento</DialogTitle><DialogDescription>{editing?.planType === 'single' ? 'Altere os detalhes deste atendimento.' : 'Ao mudar a data, você escolhe se altera somente esta sessão ou também recalcula as próximas.'}</DialogDescription></DialogHeader>
          {editing && <form onSubmit={saveEdit} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do dono</span><Input value={editing.ownerName} onChange={(event) => setEditing({ ...editing, ownerName: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do cachorro</span><Input value={editing.dogName} onChange={(event) => setEditing({ ...editing, dogName: event.target.value })} className="h-11 bg-white" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><MessageCircle size={14} /> WhatsApp</span><Input type="tel" inputMode="tel" value={editing.whatsapp} onChange={(event) => setEditing({ ...editing, whatsapp: event.target.value })} placeholder="(47) 99999-9999" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><IdCard size={14} /> CPF (opcional)</span><Input inputMode="numeric" value={editing.cpf} onChange={(event) => setEditing({ ...editing, cpf: maskCpf(event.target.value) })} placeholder="000.000.000-00" className="h-11 bg-white" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Data do banho</span><Input type="date" value={editing.scheduledDate} onChange={(event) => setEditing({ ...editing, scheduledDate: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Horário</span><Input type="time" value={editing.scheduledTime} onChange={(event) => setEditing({ ...editing, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Valor (opcional)</span><Input inputMode="numeric" value={formatMoney(editing.amountCents) ?? ''} onChange={(event) => setEditing({ ...editing, amountCents: realToCents(event.target.value) })} placeholder="R$ 0,00" className="h-11 bg-white font-semibold tabular-nums" /></label>
            </div>
            <div><span className="mb-2 block text-xs font-bold text-[#6f6179]">O que é para fazer</span><div className="flex flex-wrap gap-2">{serviceOptions.map((service) => <button type="button" key={service} onClick={() => toggleService(service, true)} className={`rounded-full border px-3 py-2 text-xs font-bold ${editing.services.includes(service) ? 'border-[#7353a6] bg-[#7353a6] text-white' : 'border-[#e4dced] bg-white text-[#6f6179]'}`}>{service}</button>)}</div></div>
            <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:justify-between sm:px-5">
              <Button type="button" variant="outline"  onClick={() => setDeleteOpen(true)} className="border-[#ead0cc] text-[#a94338] hover:bg-[#fbefed] hover:text-[#92382f]"><Trash2 /> {editing.planType === 'single' ? 'Apagar banho' : 'Apagar plano'}</Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline"  onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={Boolean(savingForm)} className="bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90]">{savingForm === 'edit' && <LoaderCircle className="animate-spin" />} {savingForm === 'edit' ? 'Salvando...' : 'Salvar alterações'}</Button>
              </div>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={editDateChoiceOpen} onOpenChange={(open) => { if (!savingForm) setEditDateChoiceOpen(open); }}>
        <AlertDialogContent className="mobile-alert max-w-[calc(100%-1.5rem)] border-0 bg-[#fffbff]">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-[#eee6f7] text-[#7353a6]"><CalendarDays /></AlertDialogMedia>
            <AlertDialogTitle className="font-heading font-extrabold">Recalcular as próximas sessões?</AlertDialogTitle>
            <AlertDialogDescription>
              A sessão {editing?.sessionNumber} foi alterada para {editing ? prettyDate(editing.scheduledDate) : ''}. Você pode mudar somente este banho ou reorganizar os seguintes a cada {editing?.planType === 'monthly' ? '7' : '14'} dias.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(savingForm)}>Voltar</AlertDialogCancel>
            <Button variant="outline" disabled={Boolean(savingForm)} onClick={() => persistEdit(false)}>Somente esta sessão</Button>
            <Button disabled={Boolean(savingForm)} onClick={() => persistEdit(true)}><RefreshCw /> Recalcular próximas</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingMove)} onOpenChange={(open) => { if (!open) setPendingMove(null); }}>
        <AlertDialogContent className="mobile-alert max-w-[calc(100%-1.5rem)] border-0 bg-[#fffbff]">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-[#eee6f7] text-[#7353a6]"><CalendarDays /></AlertDialogMedia>
            <AlertDialogTitle className="font-heading font-extrabold">Recalcular as próximas sessões?</AlertDialogTitle>
            <AlertDialogDescription>
              Você moveu a sessão {pendingMove?.item.sessionNumber} para {pendingMove ? prettyDate(pendingMove.scheduledDate) : ''}. Escolha se deseja mover somente ela ou recalcular os banhos seguintes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="outline" onClick={() => pendingMove ? moveAppointment(pendingMove.item, pendingMove.scheduledDate, false) : undefined}>Somente esta sessão</Button>
            <Button onClick={() => pendingMove ? moveAppointment(pendingMove.item, pendingMove.scheduledDate, true) : undefined}><RefreshCw /> Recalcular próximas</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="mobile-alert max-w-[calc(100%-1.5rem)] border-0 bg-[#fffbff]">
          <AlertDialogHeader>
            <AlertDialogMedia className={deleteBlockers.length ? 'bg-[#f7e8d9] text-[#a05b31]' : 'bg-[#f8e3e0] text-[#a94338]'}><Trash2 /></AlertDialogMedia>
            <AlertDialogTitle className="font-heading font-extrabold">{deleteBlockers.length ? 'Não é possível apagar' : editing?.planType === 'single' ? 'Apagar banho avulso?' : 'Apagar o plano inteiro?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlockers.length
                ? `Existe impedimento: ${deleteBlockers.join(' e ')}. Reabra os banhos concluídos e desmarque o pagamento antes de apagar.`
                : editing?.planType === 'single'
                  ? `O banho de ${editing.dogName || editing.ownerName || 'cliente sem nome'} será apagado. Esta ação não pode ser desfeita.`
                  : `Todos os ${editingPlan.length} banhos do plano de ${editing?.dogName || editing?.ownerName || 'cliente sem nome'} serão apagados. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel >{deleteBlockers.length ? 'Entendi' : 'Cancelar'}</AlertDialogCancel>
            {!deleteBlockers.length && <Button onClick={deleteAppointment} className="bg-[#a94338] font-bold text-white hover:bg-[#92382f]"><Trash2 /> Apagar definitivamente</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-2xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><Users className="text-[#7353a6]" /> Equipe e acessos</DialogTitle>
            <DialogDescription>Crie o e-mail e a senha de cada funcionário. A flag de acesso pode ser ligada ou desligada aqui.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addTeamUser} className="rounded-2xl border border-[#dfd5e8] bg-[#f7f3fb] p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[#574761]"><UserPlus size={17} /> Criar novo acesso</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome</span><Input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Ex.: Maria" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">E-mail</span><Input required type="email" autoComplete="off" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="maria@email.com" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Senha inicial</span><Input required minLength={6} type="password" autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Mínimo de 6 caracteres" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Permissão</span><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as 'admin' | 'staff' })} className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#7353a6]/30"><option value="staff">Equipe</option><option value="admin">Administrador</option></select></label>
            </div>
            <Button type="submit" disabled={teamSaving} className="mt-3 bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90]">{teamSaving ? <LoaderCircle className="animate-spin" /> : <Plus />} {teamSaving ? 'Salvando...' : 'Criar acesso'}</Button>
          </form>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><p className="text-sm font-extrabold">Pessoas cadastradas</p><span className="text-xs font-semibold text-[#8b7c95]">{teamUsers.filter((user) => user.active).length} ativos</span></div>
            {panelLoading && teamUsers.length === 0 ? (
              <p className="rounded-xl bg-[#f1ecf7] p-4 text-sm font-semibold text-[#81748a]">Carregando equipe...</p>
            ) : teamUsers.map((user) => (
              <div key={user.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${user.active ? 'border-[#e4dced] bg-white' : 'border-[#eadfdf] bg-[#faf6f6] opacity-70'}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{user.name || user.email} {user.id === currentUser?.id && <span className="ml-1 text-[10px] text-[#7353a6]">VOCÊ</span>}</p>
                  <p className="truncate text-xs text-[#81748a]">{user.email}</p>
                  <p className="mt-1 text-[10px] font-semibold text-[#9a8ca3]">{user.lastLoginAt ? `Último acesso: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(user.lastLoginAt))}` : 'Ainda não entrou'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select disabled={user.id === currentUser?.id || panelLoading} value={user.role} onChange={(event) => updateTeamUser(user, { role: event.target.value as 'admin' | 'staff' })} aria-label={`Permissão de ${user.name || user.email}`} className="h-9 rounded-lg border border-input bg-white px-2 text-xs font-bold"><option value="staff">Equipe</option><option value="admin">Admin</option></select>
                  {user.id !== currentUser?.id && <Button disabled={panelLoading} variant="outline" size="sm" onClick={() => updateTeamUser(user, { active: !user.active })} className={user.active ? 'text-[#a04c42]' : 'text-[#4b765c]'}>{user.active ? 'Desativar' : 'Ativar'}</Button>}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5"><Button variant="outline" onClick={() => setTeamOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-2xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><Activity className="text-[#7353a6]" /> Histórico de atividades</DialogTitle>
            <DialogDescription>Últimas alterações feitas pela equipe na agenda e nos acessos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {panelLoading && auditLogs.length === 0 ? (
              <p className="rounded-xl bg-[#f1ecf7] p-5 text-center text-sm font-semibold text-[#81748a]">Carregando histórico...</p>
            ) : auditLogs.length === 0 ? (
              <p className="rounded-xl bg-[#f1ecf7] p-5 text-center text-sm font-semibold text-[#81748a]">Nenhuma atividade registrada ainda.</p>
            ) : auditLogs.map((log) => (
              <div key={log.id} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-xl border border-[#e4dced] bg-white p-3.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#eee6f7] text-[#7353a6]"><Activity size={15} /></span>
                <div>
                  <p className="text-sm font-bold leading-5">{log.description}</p>
                  <p className="mt-1 text-xs text-[#81748a]"><strong>{log.actorName || log.actorEmail}</strong> · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(log.createdAt))}</p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5"><Button variant="outline" onClick={() => setLogsOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
