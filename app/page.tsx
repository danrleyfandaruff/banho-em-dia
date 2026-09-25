'use client';

import { ComponentProps, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Calculator, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock3, CreditCard, Dog, GripVertical, History, IdCard, ListChecks, LoaderCircle, LogOut,
  MessageCircle, MoreHorizontal, PawPrint, Pencil, Plus, RefreshCw, Scissors, Search, Send, ShieldCheck,
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
import { registrationNameMessages, validateRegistrationNames } from '@/lib/registration-validation';
import type { Appointment, PetProfile, PlanType, Status, PaymentMethod } from '@/lib/agenda-types';
import { AgendaWorkspace } from '@/components/agenda-workspace';
import { PlanSessionDates } from '@/components/plan-session-dates';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PwaInstallButton } from '@/components/pwa-install-button';
import { calculatePayment, cardRateBps, defaultCardRates, type CardRates } from '@/lib/payment';

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

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const emptyForm = (scheduledDate = localDateString()) => ({
  clientId: null as string | null, petId: null as string | null,
  ownerName: '', dogName: '', whatsapp: '', cpf: '', paymentMethod: '' as PaymentMethod,
  planType: 'monthly' as PlanType, amount: '', paid: false,
  scheduledDate, scheduledTime: '09:00',
  sessionDates: sessionDatesFor('monthly', scheduledDate),
  sessionServices: Array.from({ length: 4 }, () => ['Banho']),
  sessionCompleted: Array.from({ length: 4 }, () => false),
});

export default function Home() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [savedPetProfiles, setSavedPetProfiles] = useState<PetProfile[]>([]);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authorized' | 'signed_out' | 'forbidden'>('loading');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [blockedEmail, setBlockedEmail] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginSaving, setLoginSaving] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [petSearch, setPetSearch] = useState('');
  const [petSearchFocused, setPetSearchFocused] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappTarget, setWhatsappTarget] = useState<Appointment | null>(null);
  const [whatsappTemplate, setWhatsappTemplate] = useState<'confirm' | 'ready' | 'payment' | 'renew' | 'return'>('confirm');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [petHistoryOpen, setPetHistoryOpen] = useState(false);
  const [petHistoryProfile, setPetHistoryProfile] = useState<PetProfile | null>(null);
  const [petNotesDraft, setPetNotesDraft] = useState('');
  const [petNotesSaving, setPetNotesSaving] = useState(false);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [inactiveDays, setInactiveDays] = useState<30 | 45 | 60>(30);
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
        const data = await response.json() as { appointments?: Appointment[]; petProfiles?: PetProfile[]; rates?: CardRates };
        setAppointments(data.appointments ?? []);
        setSavedPetProfiles(data.petProfiles ?? []);
        if (data.rates) setRates(data.rates);
      } catch {
        setNotice('Não foi possível carregar a agenda. Tente novamente.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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

  const petProfiles = useMemo(() => {
    const profiles = new Map(savedPetProfiles.map((profile) => [profile.key, { ...profile, notes: profile.notes ?? '', favoriteServices: [...profile.favoriteServices] }]));
    [...appointments].reverse().forEach((item) => {
      const fallbackKey = [normalizeSearch(item.dogName), normalizeSearch(item.ownerName), item.whatsapp.replace(/\D/g, ''), item.cpf.replace(/\D/g, '')].join('|');
      const key = item.petId || fallbackKey;
      if (!key) return;
      const existing = profiles.get(key);
      if (existing) {
        if (!existing.favoriteServices.length && item.services.length) existing.favoriteServices = item.services;
        return;
      }
      profiles.set(key, {
        key,
        clientId: item.clientId,
        petId: item.petId,
        ownerName: item.ownerName,
        dogName: item.dogName,
        whatsapp: item.whatsapp,
        cpf: item.cpf,
        favoriteServices: item.services,
        lastTime: item.scheduledTime || '09:00',
        lastAmountCents: item.paymentDetails?.baseCents ?? item.amountCents,
        notes: '',
      });
    });
    return [...profiles.values()]
      .map((profile) => ({ ...profile, favoriteServices: profile.favoriteServices.length ? profile.favoriteServices : ['Banho'] }))
      .sort((a, b) => (a.dogName || a.ownerName).localeCompare(b.dogName || b.ownerName, 'pt-BR'));
  }, [appointments, savedPetProfiles]);

  const matchingPets = useMemo(() => {
    const query = normalizeSearch(petSearch);
    if (!query) return petProfiles.slice(0, 8);
    const digits = petSearch.replace(/\D/g, '');
    return petProfiles.filter((pet) => {
      const text = normalizeSearch(`${pet.dogName} ${pet.ownerName} ${pet.whatsapp} ${pet.cpf}`);
      return text.includes(query) || Boolean(digits && `${pet.whatsapp}${pet.cpf}`.replace(/\D/g, '').includes(digits));
    }).slice(0, 8);
  }, [petProfiles, petSearch]);

  const duplicateAppointments = useMemo(() => {
    const dates = new Set(form.sessionDates.slice(0, totalSessionsFor(form.planType)));
    const dog = normalizeSearch(form.dogName);
    const owner = normalizeSearch(form.ownerName);
    const whatsapp = form.whatsapp.replace(/\D/g, '');
    return appointments.filter((item) => {
      if (!dates.has(item.scheduledDate)) return false;
      if (form.petId && item.petId) return form.petId === item.petId;
      if (!dog || normalizeSearch(item.dogName) !== dog) return false;
      return !owner || normalizeSearch(item.ownerName) === owner || Boolean(whatsapp && item.whatsapp.replace(/\D/g, '') === whatsapp);
    });
  }, [appointments, form]);

  const inactivePets = useMemo(() => petProfiles.flatMap((profile) => {
    const history = appointments.filter((item) => {
      if (profile.petId && item.petId) return profile.petId === item.petId;
      return normalizeSearch(profile.dogName) === normalizeSearch(item.dogName)
        && (!profile.ownerName || normalizeSearch(profile.ownerName) === normalizeSearch(item.ownerName));
    });
    if (history.some((item) => item.status === 'scheduled' && item.scheduledDate >= today)) return [];
    const previous = history
      .filter((item) => item.scheduledDate < today)
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));
    const last = previous.find((item) => item.status === 'completed') ?? previous[0];
    if (!last) return [];
    const elapsed = Math.floor((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${last.scheduledDate}T12:00:00Z`).getTime()) / 86_400_000);
    return elapsed >= inactiveDays ? [{ profile, days: elapsed, lastDate: last.scheduledDate }] : [];
  }).sort((a, b) => b.days - a.days), [appointments, inactiveDays, petProfiles, today]);

  const petHistoryAppointments = petHistoryProfile
    ? appointments.filter((item) => appointmentBelongsToProfile(item, petHistoryProfile)).sort((a, b) => `${b.scheduledDate}${b.scheduledTime}`.localeCompare(`${a.scheduledDate}${a.scheduledTime}`))
    : [];
  const selectedFormProfile = petProfiles.find((profile) => form.petId && profile.petId === form.petId)
    ?? petProfiles.find((profile) => petSearch && form.dogName && normalizeSearch(profile.dogName) === normalizeSearch(form.dogName)
      && (!form.ownerName || normalizeSearch(profile.ownerName) === normalizeSearch(form.ownerName)));

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
      const data = await response.json().catch(() => ({ error: 'unexpected_response' })) as { appointments?: Appointment[]; petProfiles?: PetProfile[]; rates?: CardRates; error?: string; blockers?: string[]; missing?: string[]; pendingCount?: number };
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
            : data.error === 'pet_profile_unavailable' ? 'Execute a migração de clientes e pets no Supabase antes de salvar observações.'
            : data.error === 'names_required' ? registrationNameMessages.names_required
            : data.error === 'owner_name_required' ? registrationNameMessages.owner_name_required
            : data.error === 'pet_name_required' ? registrationNameMessages.pet_name_required
            : data.error === 'invalid_amount' ? 'Informe um valor válido.'
            : 'Não foi possível salvar. Tente novamente.';
        setNotice(blockerMessage);
        window.setTimeout(() => setNotice(''), 4200);
        return false;
      }
      setAppointments(data.appointments ?? []);
      if (data.petProfiles) setSavedPetProfiles(data.petProfiles);
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

  const planSessions = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const item of appointments) {
      const group = groups.get(item.groupId) ?? [];
      group.push(item);
      groups.set(item.groupId, group);
    }
    for (const group of groups.values()) group.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.scheduledTime.localeCompare(b.scheduledTime));
    return groups;
  }, [appointments]);

  function scheduleProfile(profile: PetProfile) {
    const fresh = emptyForm(today);
    setForm({ ...fresh, clientId: profile.clientId, petId: profile.petId,
      ownerName: profile.ownerName, dogName: profile.dogName, whatsapp: profile.whatsapp, cpf: profile.cpf,
      scheduledTime: profile.lastTime || fresh.scheduledTime,
      amount: formatMoney(profile.lastAmountCents) ?? '',
      sessionServices: fresh.sessionServices.map(() => profile.favoriteServices.length ? [...profile.favoriteServices] : ['Banho']),
    });
    setPetSearch(`${profile.dogName || 'Pet sem nome'} · ${profile.ownerName}`);
    setActiveServiceSession(0);
    setNewOpen(true);
  }

  function renderCompactAppointment(item: Appointment, fromOverview = false) {
    const stats = groupStats.get(item.groupId);
    const renewable = item.planType !== 'single' && item.sessionNumber === item.totalSessions && item.status === 'completed' && stats?.scheduled === 0;
    const notes = profileForAppointment(item)?.notes;
    const showPlan = () => fromOverview ? openPlanFromToday(item) : openPlan(item);
    const showHistory = () => { if (fromOverview) setTodayOpen(false); openPetHistory(item); };
    return <div key={item.id} data-appointment-card className={`appointment-card appointment-record relative grid gap-3 px-4 py-3 sm:grid-cols-[64px_minmax(0,1fr)] sm:pl-10 xl:grid-cols-[64px_minmax(0,1fr)_auto] ${cardColors[item.status]} ${selectedIds.includes(item.id) && item.status === 'scheduled' ? 'appointment-selected' : ''} ${draggingId === item.id ? 'opacity-45' : ''}`}>
      <button type="button" draggable onDragStart={(event) => startDragging(event, item)} onDragEnd={() => { setDraggingId(null); setDropTarget(null); }} aria-label={`Arrastar ${item.dogName || 'agendamento'} para outro dia`} title="Arraste para outro dia" className="absolute top-1/2 left-1 hidden h-10 w-7 -translate-y-1/2 cursor-grab items-center justify-center rounded text-[#82758d] hover:bg-[#f0ecf5] sm:flex"><GripVertical size={18} /></button>
      <div className="flex items-center gap-3 text-sm font-bold text-[#51435d] sm:flex-col sm:items-start sm:gap-2">{selectionCheckbox(item)}<time dateTime={`${item.scheduledDate}T${item.scheduledTime}`}>{item.scheduledTime}</time></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><button type="button" onClick={showHistory} className="break-words text-left font-extrabold text-[#302638] hover:text-[#7353a6] hover:underline">{item.dogName || 'Pet sem nome'}</button><span className="break-words text-sm text-[#6c6374]">{item.ownerName || 'Tutor não informado'}</span></div>
        <p className="mt-1 break-words text-sm text-[#62586d]">{item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`appointment-status ${cardColors[item.status]}`}>{item.status === 'completed' ? <CheckCircle2 size={13} /> : item.status === 'absent' ? <X size={13} /> : <Clock3 size={13} />}{statusLabels[item.status]}</span>
          <Button variant="ghost" size="sm" onClick={() => updatePaid(item)} title={item.planType === 'single' ? 'Pagamento deste banho' : 'Pagamento único de todo o plano'} className={`h-8 px-1 text-xs ${item.paid ? 'text-[#347052]' : 'text-[#a0472e]'}`}><CircleDollarSign size={14} />{item.planType === 'single' ? (item.paid ? 'Pago' : 'Pendente') : (item.paid ? 'Plano pago' : 'Plano pendente')}</Button>
        </div>
        {item.planType !== 'single' && <PlanSessionDates sessions={planSessions.get(item.groupId) ?? []} currentId={item.id} onOpen={showPlan} />}
        {notes && <p className="mt-2 line-clamp-2 text-xs text-[#80591d]" title={notes}>Obs.: {notes}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 sm:col-start-2 xl:col-start-auto xl:self-center">
        {renewable ? <Button size="sm" onClick={() => openRenew(item)}><RefreshCw />Renovar</Button> : item.status === 'scheduled' ? <Button size="sm" onClick={() => mutate({ action: 'status', id: item.id, status: 'completed' }, 'Atendimento concluído')}><Check />Concluir</Button> : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<BaseButton variant="outline" size="sm" />} aria-label={`Mais ações para ${item.dogName || 'atendimento'}`}><MoreHorizontal /><span>Mais ações</span></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56 [&_[data-slot=dropdown-menu-item]]:min-h-10 [&_[data-slot=dropdown-menu-item]]:px-3">
            <DropdownMenuItem onClick={() => fromOverview ? editFromOverview(item) : openEdit(item)}><Pencil />Editar atendimento</DropdownMenuItem>
            <DropdownMenuItem onClick={showHistory}><History />Ficha e histórico</DropdownMenuItem>
            {item.planType !== 'single' && <DropdownMenuItem onClick={showPlan}><ListChecks />Ver plano</DropdownMenuItem>}
            {item.whatsapp && <DropdownMenuItem onClick={() => openWhatsapp(item)}><MessageCircle />WhatsApp</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => editPaymentMethod(item)}><CreditCard />Forma de pagamento</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, -1) }, 'Movido para o dia anterior')}><ChevronLeft />Mover para o dia anterior</DropdownMenuItem>
            <DropdownMenuItem onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, 1) }, 'Movido para o próximo dia')}><ChevronRight />Mover para o próximo dia</DropdownMenuItem>
            {item.status === 'scheduled' ? <DropdownMenuItem onClick={() => mutate({ action: 'status', id: item.id, status: 'absent' }, 'Falta registrada')}><X />Registrar falta</DropdownMenuItem> : <DropdownMenuItem onClick={() => mutate({ action: 'status', id: item.id, status: 'scheduled' }, 'Atendimento reaberto')}><RefreshCw />Reabrir atendimento</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => { if (fromOverview) setTodayOpen(false); openDelete(item); }}><Trash2 />{item.planType === 'single' ? 'Apagar banho' : 'Apagar plano'}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>;
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
    setPetSearch('');
    setActiveServiceSession(0);
    setNewOpen(true);
  }

  function selectPet(pet: PetProfile) {
    const favoriteServices = pet.favoriteServices.length ? pet.favoriteServices : ['Banho'];
    const count = totalSessionsFor(form.planType);
    setForm({
      ...form,
      clientId: pet.clientId,
      petId: pet.petId,
      ownerName: pet.ownerName,
      dogName: pet.dogName,
      whatsapp: pet.whatsapp,
      cpf: pet.cpf,
      scheduledTime: pet.lastTime || form.scheduledTime,
      amount: pet.lastAmountCents === null ? form.amount : formatMoney(pet.lastAmountCents) ?? '',
      sessionServices: Array.from({ length: count }, () => [...favoriteServices]),
    });
    setPetSearch(`${pet.dogName || 'Pet sem nome'}${pet.ownerName ? ` · ${pet.ownerName}` : ''}`);
    setActiveServiceSession(0);
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

  function validateNames(values: { ownerName: string; dogName: string }) {
    const names = validateRegistrationNames(values);
    if (!names.error) return true;
    setNotice(registrationNameMessages[names.error]);
    window.setTimeout(() => setNotice(''), 4200);
    return false;
  }

  async function persistNewAppointment() {
    if (savingForm || !validateNames(form)) return;
    setSavingForm('create');
    const ok = await mutate({
      action: 'create', ...form, ownerName: form.ownerName.trim(), dogName: form.dogName.trim(),
      amountCents: realToCents(form.amount),
      expectedRateBps: cardRateBps(form.paymentMethod, rates),
    }, 'Agendamento criado');
    setSavingForm('');
    if (ok) {
      setDuplicateOpen(false);
      setNewOpen(false);
    }
  }

  async function createAppointment(event: FormEvent) {
    event.preventDefault();
    if (!validateNames(form)) return;
    if (duplicateAppointments.length) {
      setDuplicateOpen(true);
      return;
    }
    await persistNewAppointment();
  }

  function whatsappText(item: Appointment, template: typeof whatsappTemplate) {
    const greeting = item.ownerName ? `Olá, ${item.ownerName}!` : 'Olá!';
    const pet = item.dogName || 'seu pet';
    if (template === 'ready') return `${greeting} O ${pet} já está pronto e pode ser buscado no HEIN PET SALON. 🐾`;
    if (template === 'payment') return `${greeting} O pagamento ${item.planType === 'single' ? 'do banho' : 'do plano'} do ${pet} está pendente. Se precisar, posso enviar os dados para pagamento.`;
    if (template === 'renew') return `${greeting} O plano de banhos do ${pet} terminou. Gostaria de renovar e já escolher as próximas datas? 🐶`;
    if (template === 'return') return `${greeting} Faz um tempinho que não vemos o ${pet} por aqui. Gostaria de agendar um novo banho no HEIN PET SALON? 🐾`;
    return `${greeting} Passando para confirmar o banho do ${pet} no dia ${prettyDate(item.scheduledDate)} às ${item.scheduledTime}. 🐾`;
  }

  function chooseWhatsappTemplate(template: typeof whatsappTemplate, item = whatsappTarget) {
    setWhatsappTemplate(template);
    if (item) setWhatsappMessage(whatsappText(item, template));
  }

  function openWhatsapp(item: Appointment, template: typeof whatsappTemplate = 'confirm') {
    setWhatsappTarget(item);
    setWhatsappTemplate(template);
    setWhatsappMessage(whatsappText(item, template));
    setWhatsappOpen(true);
  }

  function profileForAppointment(item: Appointment) {
    return petProfiles.find((profile) => profile.petId && item.petId && profile.petId === item.petId)
      ?? petProfiles.find((profile) => normalizeSearch(profile.dogName) === normalizeSearch(item.dogName)
        && (!profile.ownerName || normalizeSearch(profile.ownerName) === normalizeSearch(item.ownerName)));
  }

  function appointmentBelongsToProfile(item: Appointment, profile: PetProfile) {
    if (profile.petId && item.petId) return profile.petId === item.petId;
    if (normalizeSearch(profile.dogName) !== normalizeSearch(item.dogName)) return false;
    const sameOwner = !profile.ownerName || normalizeSearch(profile.ownerName) === normalizeSearch(item.ownerName);
    const profilePhone = profile.whatsapp.replace(/\D/g, '');
    return sameOwner || Boolean(profilePhone && profilePhone === item.whatsapp.replace(/\D/g, ''));
  }

  function openPetHistory(profileOrAppointment: PetProfile | Appointment) {
    const profile = 'favoriteServices' in profileOrAppointment
      ? profileOrAppointment
      : profileForAppointment(profileOrAppointment) ?? {
        key: profileOrAppointment.petId || profileOrAppointment.id,
        clientId: profileOrAppointment.clientId,
        petId: profileOrAppointment.petId,
        ownerName: profileOrAppointment.ownerName,
        dogName: profileOrAppointment.dogName,
        whatsapp: profileOrAppointment.whatsapp,
        cpf: profileOrAppointment.cpf,
        favoriteServices: profileOrAppointment.services,
        lastTime: profileOrAppointment.scheduledTime,
        lastAmountCents: profileOrAppointment.paymentDetails?.baseCents ?? profileOrAppointment.amountCents,
        notes: '',
      };
    setPetHistoryProfile(profile);
    setPetNotesDraft(profile.notes || '');
    setInactiveOpen(false);
    setPetHistoryOpen(true);
  }

  async function savePetNotes() {
    if (!petHistoryProfile || petNotesSaving) return;
    if (!validateNames(petHistoryProfile)) {
      setNotice('Complete o nome do pet e do tutor em Editar atendimento antes de salvar observações.');
      return;
    }
    setPetNotesSaving(true);
    const ok = await mutate({
      action: 'pet_notes',
      ...petHistoryProfile,
      notes: petNotesDraft,
    }, 'Observações do pet atualizadas');
    setPetNotesSaving(false);
    if (ok) setPetHistoryProfile({ ...petHistoryProfile, notes: petNotesDraft });
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
    if (!validateNames(item)) {
      setTodayOpen(false);
      setPlanOpen(false);
      openEdit(item);
      return;
    }
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
          : data.error === 'names_required' ? `${registrationNameMessages.names_required} Corrija o cadastro em Editar atendimento.`
          : data.error === 'owner_name_required' ? `${registrationNameMessages.owner_name_required} Corrija o cadastro em Editar atendimento.`
          : data.error === 'pet_name_required' ? `${registrationNameMessages.pet_name_required} Corrija o cadastro em Editar atendimento.`
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
    if (!renewTarget || savingForm || renewDates.some((date) => !date) || !validateNames(renewTarget)) return;
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
    if (!editing || savingForm || !validateNames(editing)) return;
    setSavingForm('edit');
    const dateChanged = editing.scheduledDate !== editingOriginalDate;
    const ok = await mutate({
      action: 'edit', id: editing.id, ownerName: editing.ownerName.trim(), dogName: editing.dogName.trim(),
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
    if (!editing || savingForm || !validateNames(editing)) return;
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
    setSavedPetProfiles([]);
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
    <main className="min-h-screen bg-[#f7f7f9] text-[#302638]">
      <header className="border-b border-[#e4dced] bg-[#fffbff]/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:min-h-20 sm:px-6 lg:px-9">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#7353a6] text-white shadow-sm sm:h-10 sm:w-10"><PawPrint size={20} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <p className="hidden text-xs font-bold uppercase tracking-[0.16em] text-[#85768f] sm:block">Pet shop</p>
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
              <p className="text-xs font-semibold text-[#8b7c95]">{currentUser?.role === 'admin' ? 'Administrador' : 'Equipe'}</p>
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
        <AgendaWorkspace appointments={appointments} profiles={petProfiles} loading={loading}
          renderAppointment={renderCompactAppointment} renderDayActions={dayActions}
          onNew={openNew} onOpenProfile={openPetHistory} onScheduleProfile={scheduleProfile}
          onViewChange={() => setSelectedIds([])} draggingId={draggingId} dropTarget={dropTarget}
          onDragOver={(event, date) => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(date); } }}
          onDrop={dropOnDay} />

        <aside className="space-y-4 lg:sticky lg:top-[108px] lg:self-start">
          <div className="rounded-2xl border border-[#e4dced] bg-white p-5 text-[#493852]">
            <button type="button" onClick={() => { changeDailyAgendaDate(today); setTodayOpen(true); }} className="text-sm font-bold text-[#694594] hover:underline">Resumo de hoje →</button>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div><strong className="font-heading text-3xl">{todayAppointments.length}</strong><span className="mt-1 block text-xs text-[#6c6374]">agendados</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'completed').length}</strong><span className="mt-1 block text-xs text-[#6c6374]">concluídos</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'absent').length}</strong><span className="mt-1 block text-xs text-[#6c6374]">faltas</span></div>
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

          <div className="rounded-2xl border border-[#e4dced] bg-[#fffbff] p-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8b7c95]">Clientes para chamar</p><h3 className="mt-1 font-heading font-extrabold">Sem voltar há {inactiveDays}+ dias</h3></div>
              <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[#eee6f7] px-2 text-sm font-extrabold text-[#7353a6]">{inactivePets.length}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#81748a]">Pets sem banho futuro agendado.</p>
            <Button variant="outline" onClick={() => setInactiveOpen(true)} className="mt-4 w-full border-[#cdbce0] font-bold text-[#7353a6]"><Dog /> Ver clientes</Button>
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
            <div className="rounded-xl bg-[#f1edf5] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#7353a6]">{dailyAppointments.filter((item) => item.status === 'scheduled').length}</strong><span className="block text-xs font-bold text-[#81748a]">em aberto</span></div>
            <div className="rounded-xl bg-[#e8f4eb] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#4f765c]">{dailyAppointments.filter((item) => item.status === 'completed').length}</strong><span className="block text-xs font-bold text-[#678471]">concluídos</span></div>
            <div className="rounded-xl bg-[#f7e7e2] p-3 text-center"><strong className="font-heading text-2xl font-extrabold text-[#ad533d]">{dailyAppointments.filter((item) => item.status === 'absent').length}</strong><span className="block text-xs font-bold text-[#956c61]">faltas</span></div>
          </div>
          {dayActions(dailyAgendaDate, dailyAppointments)}
          {dailyAppointments.length ? (
            <div className="space-y-3 rounded-2xl bg-[#efedf3] p-3 sm:space-y-4">
              {dailyAppointments.map((item) => renderCompactAppointment(item, true))}
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

      <Dialog open={inactiveOpen} onOpenChange={setInactiveOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-2xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><Dog className="text-[#7353a6]" /> Clientes que não voltaram</DialogTitle>
            <DialogDescription>Pets sem atendimento futuro. Use a ficha ou o WhatsApp para retomar o contato.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {([30, 45, 60] as const).map((daysAway) => <button key={daysAway} type="button" onClick={() => setInactiveDays(daysAway)} className={`h-10 rounded-xl border text-xs font-extrabold ${inactiveDays === daysAway ? 'border-[#7353a6] bg-[#eee6f7] text-[#7353a6]' : 'border-[#e4dced] bg-white text-[#6f6179]'}`}>{daysAway}+ dias</button>)}
          </div>
          <div className="space-y-2.5">
            {inactivePets.length === 0 ? (
              <p className="rounded-xl bg-[#f1ecf7] p-5 text-center text-sm font-semibold text-[#81748a]">Nenhum cliente nesta faixa.</p>
            ) : inactivePets.map(({ profile, days: daysAway, lastDate }) => {
              const recent = appointments.filter((item) => appointmentBelongsToProfile(item, profile)).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0];
              return <article key={profile.key} className="rounded-2xl border border-[#e4dced] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-heading font-extrabold">{profile.dogName || 'Pet sem nome'}</p><p className="text-xs text-[#81748a]">{profile.ownerName || 'Dono não informado'} · último atendimento em {prettyDate(lastDate)}</p></div>
                  <span className="rounded-full bg-[#f7eee9] px-2.5 py-1 text-xs font-extrabold text-[#99583f]">{daysAway} dias</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openPetHistory(profile)} className="text-[#7353a6]"><History /> Ver histórico</Button>
                  {recent?.whatsapp && <Button variant="outline" size="sm" onClick={() => { setInactiveOpen(false); openWhatsapp(recent, 'return'); }} className="text-[#1e8b4c]"><MessageCircle /> Chamar no WhatsApp</Button>}
                </div>
              </article>;
            })}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5"><Button variant="outline" onClick={() => setInactiveOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={petHistoryOpen} onOpenChange={setPetHistoryOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-3xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><History className="text-[#7353a6]" /> Histórico de {petHistoryProfile?.dogName || 'pet'}</DialogTitle>
            <DialogDescription>{petHistoryProfile?.ownerName || 'Dono não informado'}{petHistoryProfile?.whatsapp ? ` · ${petHistoryProfile.whatsapp}` : ''} · {petHistoryAppointments.length} {petHistoryAppointments.length === 1 ? 'atendimento' : 'atendimentos'}</DialogDescription>
          </DialogHeader>
          {petHistoryProfile?.cpf && <p className="text-sm text-[#6c6374]">CPF: {petHistoryProfile.cpf}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#f1edf5] p-3 text-center"><strong className="font-heading text-2xl text-[#7353a6]">{petHistoryAppointments.length}</strong><span className="block text-xs font-bold text-[#81748a]">total</span></div>
            <div className="rounded-xl bg-[#e8f4eb] p-3 text-center"><strong className="font-heading text-2xl text-[#4f765c]">{petHistoryAppointments.filter((item) => item.status === 'completed').length}</strong><span className="block text-xs font-bold text-[#678471]">concluídos</span></div>
            <div className="rounded-xl bg-[#f7e7e2] p-3 text-center"><strong className="font-heading text-2xl text-[#ad533d]">{petHistoryAppointments.filter((item) => item.status === 'absent').length}</strong><span className="block text-xs font-bold text-[#956c61]">faltas</span></div>
          </div>
          <div className="rounded-2xl border border-[#e5d9bd] bg-[#fff9eb] p-4">
            <label className="block"><span className="mb-1.5 block text-xs font-extrabold text-[#755624]">Observações permanentes do pet</span><textarea value={petNotesDraft} onChange={(event) => setPetNotesDraft(event.target.value)} rows={3} placeholder="Alergias, comportamento, shampoo específico, cuidados especiais..." className="w-full resize-y rounded-xl border border-[#e6d7b5] bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[#c69a45]/25" /></label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><small className="text-xs text-[#806b49]">Essas observações aparecem no cadastro e nos cards da agenda.</small><Button size="sm" disabled={petNotesSaving} onClick={savePetNotes}>{petNotesSaving ? <LoaderCircle className="animate-spin" /> : <Check />} Salvar observações</Button></div>
          </div>
          {petHistoryProfile?.favoriteServices.length ? <p className="rounded-xl bg-[#f1ecf7] px-3 py-2 text-xs font-semibold text-[#6f6179]"><Scissors className="mr-1 inline" size={13} /> Serviços favoritos: {petHistoryProfile.favoriteServices.join(' · ')}</p> : null}
          <div className="space-y-2.5">
            {petHistoryAppointments.length === 0 ? <p className="rounded-xl bg-[#f1ecf7] p-5 text-center text-sm font-semibold text-[#81748a]">Nenhum atendimento encontrado para este pet.</p> : petHistoryAppointments.map((item) => (
              <article key={`history-${item.id}`} className={`rounded-2xl border p-3.5 ${cardColors[item.status]}`}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-extrabold capitalize">{prettyDate(item.scheduledDate)} · {item.scheduledTime}</p><p className="mt-1 text-xs text-[#81748a]">{planLabels[item.planType]} · sessão {item.sessionNumber} de {item.totalSessions}</p></div><span className={`appointment-status ${cardColors[item.status]}`}>{statusLabels[item.status]}</span></div>
                {item.planType !== 'single' && <PlanSessionDates sessions={planSessions.get(item.groupId) ?? []} currentId={item.id} onOpen={() => { setPetHistoryOpen(false); openPlan(item); }} />}
                <p className="mt-2 text-xs text-[#6f6179]"><Scissors className="mr-1 inline" size={13} /> {item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
                <p className="mt-1 text-xs font-semibold text-[#81748a]">{item.paid ? `Pago${item.paymentMethod ? ` · ${paymentMethodLabel(item.paymentMethod)}` : ''}` : 'Pagamento pendente'}{formatMoney(item.amountCents) ? ` · ${formatMoney(item.amountCents)}` : ''}</p>
              </article>
            ))}
          </div>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5"><Button variant="outline" onClick={() => setPetHistoryOpen(false)}>Fechar</Button></DialogFooter>
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
                <div className="flex items-center gap-2 text-xs font-bold text-[#81748a]">
                  <span>{selectedPlanStats.completed} concluídos</span><span>·</span><span>{selectedPlanStats.absent} faltas</span><span>·</span><span>{selectedPlanStats.scheduled} abertos</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e5dced] pt-3 sm:flex sm:flex-wrap sm:items-center">
                {selectedPlanHead.whatsapp && <button type="button" onClick={() => openWhatsapp(selectedPlanHead)} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#e6f7eb] px-3 text-xs font-bold text-[#1e8b4c] sm:grid sm:h-9 sm:w-9 sm:p-0" aria-label="Abrir WhatsApp"><MessageCircle size={17} /><span className="sm:hidden">WhatsApp</span></button>}
                <Button variant="outline" onClick={() => { setPlanOpen(false); openPetHistory(selectedPlanHead); }} className="h-11 text-[#7353a6] sm:h-9"><History /> Histórico do pet</Button>
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
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${session.status === 'completed' ? 'bg-[#e8f4eb] text-[#4f765c]' : session.status === 'absent' ? 'bg-[#f7e7e2] text-[#ad533d]' : 'bg-[#f1edf5] text-[#776a80]'}`}>{statusLabels[session.status]}</span>
                </div>
                <div className="mt-3 grid gap-2 border-t border-[#eee8f3] pt-3 sm:grid-cols-[minmax(170px,1fr)_auto] sm:items-end">
                  <label>
                    <span className="mb-1 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#8b7c95]">Alterar data</span>
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

      <Dialog open={whatsappOpen} onOpenChange={setWhatsappOpen}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-lg sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><MessageCircle className="text-[#1e8b4c]" /> Mensagem no WhatsApp</DialogTitle>
            <DialogDescription>{whatsappTarget?.dogName || whatsappTarget?.ownerName || 'Cliente'} · escolha uma mensagem e ajuste se precisar.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['confirm', 'Confirmar banho'],
              ['ready', 'Pet pronto'],
              ['payment', 'Lembrar pagamento'],
              ['renew', 'Oferecer renovação'],
              ['return', 'Convidar para voltar'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => chooseWhatsappTemplate(value)} className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-extrabold transition ${whatsappTemplate === value ? 'border-[#1e8b4c] bg-[#e6f7eb] text-[#176d3c]' : 'border-[#e4dced] bg-white text-[#66576f] hover:bg-[#f7f3fb]'}`}>{label}</button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Mensagem</span>
            <textarea value={whatsappMessage} onChange={(event) => setWhatsappMessage(event.target.value)} rows={5} className="w-full resize-y rounded-xl border border-[#ddd2e7] bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[#7353a6]/25" />
          </label>
          <DialogFooter className="-mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button type="button" variant="outline" onClick={() => setWhatsappOpen(false)}>Cancelar</Button>
            {whatsappTarget && <a href={`${whatsappUrl(whatsappTarget.whatsapp)}?text=${encodeURIComponent(whatsappMessage)}`} target="_blank" rel="noreferrer" onClick={() => setWhatsappOpen(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1e8b4c] px-4 text-sm font-extrabold text-white transition hover:bg-[#176d3c]"><Send size={16} /> Abrir WhatsApp</a>}
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
            <div className="relative rounded-2xl border border-[#d9cbe6] bg-[#f7f3fb] p-3.5">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-[#654c78]"><Search size={14} /> Buscar cliente ou pet já cadastrado</span>
                <Input
                  autoFocus
                  type="search"
                  value={petSearch}
                  onFocus={() => setPetSearchFocused(true)}
                  onBlur={() => window.setTimeout(() => setPetSearchFocused(false), 120)}
                  onChange={(event) => setPetSearch(event.target.value)}
                  placeholder="Digite nome do pet, dono, WhatsApp ou CPF"
                  className="h-11 bg-white"
                />
              </label>
              {petSearchFocused && matchingPets.length > 0 && (
                <div className="absolute right-3.5 left-3.5 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[#d8cbe3] bg-white p-1.5 shadow-xl">
                  {matchingPets.map((pet) => (
                    <button key={pet.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { selectPet(pet); setPetSearchFocused(false); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f2ecf8]">
                      <span className="min-w-0"><strong className="block truncate text-sm text-[#493852]">{pet.dogName || 'Pet sem nome'}</strong><small className="block truncate text-xs text-[#84748e]">{pet.ownerName || 'Dono não informado'}{pet.whatsapp ? ` · ${pet.whatsapp}` : ''}</small></span>
                      <span className="shrink-0 text-xs font-extrabold text-[#7353a6]">USAR</span>
                    </button>
                  ))}
                </div>
              )}
              {(form.petId || form.clientId || (petSearch && form.dogName))
                ? <p className="mt-2 text-xs font-semibold text-[#7353a6]">Dados, horário, valor e serviços favoritos preenchidos automaticamente. Você pode alterar tudo abaixo.</p>
                : <p className="mt-2 text-xs text-[#897a93]">Não encontrou? Preencha abaixo e o cliente ficará disponível nos próximos agendamentos.</p>}
              {selectedFormProfile?.notes && <p className="mt-2 rounded-lg bg-[#fff4dc] px-3 py-2 text-xs font-semibold leading-5 text-[#80591d]"><strong>Observações do pet:</strong> {selectedFormProfile.notes}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><UserRound size={14} /> Nome do tutor (obrigatório)</span><Input required pattern={'.*\\S.*'} title="Informe o nome do tutor. O campo não pode conter apenas espaços." value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Ex.: Ana" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><Dog size={14} /> Nome do pet (obrigatório)</span><Input required pattern={'.*\\S.*'} title="Informe o nome do pet. O campo não pode conter apenas espaços." value={form.dogName} onChange={(event) => setForm({ ...form, dogName: event.target.value })} placeholder="Ex.: Bob" className="h-11 bg-white" /></label>
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
                    <strong className="block text-xs sm:text-sm">{planLabels[plan]}</strong><span className="mt-1 block text-xs leading-4 text-[#81748a] sm:text-xs">{planDescriptions[plan]}</span>
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
                    className="text-xs font-extrabold text-[#7353a6] hover:underline"
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
                      <span className="mt-0.5 block text-xs capitalize text-[#81748a]">{new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`))}</span>
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
              <p className="mb-2 text-xs font-semibold text-[#81748a]">Escolha o que foi ou será feito na sessão {activeServiceSession + 1}</p>
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

      <AlertDialog open={duplicateOpen} onOpenChange={(open) => { if (!savingForm) setDuplicateOpen(open); }}>
        <AlertDialogContent className="mobile-alert max-w-[calc(100%-1.5rem)] border-0 bg-[#fffbff]">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-[#f7e8d9] text-[#a05b31]"><CalendarDays /></AlertDialogMedia>
            <AlertDialogTitle className="font-heading font-extrabold">Possível agendamento duplicado</AlertDialogTitle>
            <AlertDialogDescription>
              {form.dogName || 'Este pet'} já aparece em {duplicateAppointments.length} {duplicateAppointments.length === 1 ? 'atendimento nas datas escolhidas' : 'atendimentos nas datas escolhidas'}. Confira antes de continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-xl bg-[#f7f3fb] p-3 text-sm">
            {duplicateAppointments.slice(0, 4).map((item) => <p key={item.id} className="font-semibold">{prettyDate(item.scheduledDate)} às {item.scheduledTime} · {item.dogName || item.ownerName || 'Sem nome'}</p>)}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(savingForm)}>Voltar e conferir</AlertDialogCancel>
            <Button disabled={Boolean(savingForm)} onClick={persistNewAppointment}>{savingForm === 'create' ? <LoaderCircle className="animate-spin" /> : <Plus />} Criar mesmo assim</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditDateChoiceOpen(false); }}>
        <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-4 sm:max-w-lg sm:p-5">
          <DialogHeader><DialogTitle className="font-heading text-xl font-extrabold">Editar atendimento</DialogTitle><DialogDescription>{editing?.planType === 'single' ? 'Altere os detalhes deste atendimento.' : 'Ao mudar a data, você escolhe se altera somente esta sessão ou também recalcula as próximas.'}</DialogDescription></DialogHeader>
          {editing && <form onSubmit={saveEdit} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do tutor (obrigatório)</span><Input required pattern={'.*\\S.*'} title="Informe o nome do tutor. O campo não pode conter apenas espaços." value={editing.ownerName} onChange={(event) => setEditing({ ...editing, ownerName: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do pet (obrigatório)</span><Input required pattern={'.*\\S.*'} title="Informe o nome do pet. O campo não pode conter apenas espaços." value={editing.dogName} onChange={(event) => setEditing({ ...editing, dogName: event.target.value })} className="h-11 bg-white" /></label>
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
                  <p className="truncate text-sm font-extrabold">{user.name || user.email} {user.id === currentUser?.id && <span className="ml-1 text-xs text-[#7353a6]">VOCÊ</span>}</p>
                  <p className="truncate text-xs text-[#81748a]">{user.email}</p>
                  <p className="mt-1 text-xs font-semibold text-[#9a8ca3]">{user.lastLoginAt ? `Último acesso: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(user.lastLoginAt))}` : 'Ainda não entrou'}</p>
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
