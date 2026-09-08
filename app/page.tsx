'use client';

import { DragEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock3, Dog, GripVertical, History, LoaderCircle, LogOut,
  MessageCircle, PawPrint, Pencil, Plus, RefreshCw, Scissors, ShieldCheck,
  Sparkles, Trash2, UserPlus, UserRound, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type PlanType = 'monthly' | 'fortnightly' | 'single';
type Status = 'scheduled' | 'completed' | 'absent';
type Appointment = {
  id: string;
  groupId: string;
  customerPetName: string;
  ownerName: string;
  dogName: string;
  whatsapp: string;
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
const planDescriptions: Record<PlanType, string> = {
  monthly: '4 banhos · toda semana', fortnightly: '2 banhos · a cada 15 dias', single: '1 atendimento',
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

function realToCents(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function whatsappUrl(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const internationalNumber = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${internationalNumber}`;
}

const emptyForm = () => ({
  ownerName: '', dogName: '', whatsapp: '', planType: 'monthly' as PlanType, amount: '', paid: false,
  scheduledDate: localDateString(), scheduledTime: '09:00',
  sessionServices: Array.from({ length: 4 }, () => ['Banho']),
});

export default function Home() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authorized' | 'signed_out' | 'forbidden'>('loading');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [blockedEmail, setBlockedEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [activeServiceSession, setActiveServiceSession] = useState(0);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => localDateString().slice(0, 7));
  const [notice, setNotice] = useState('');
  const [loaderMessage, setLoaderMessage] = useState('Salvando...');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'staff' as 'admin' | 'staff' });
  const today = localDateString();

  useEffect(() => {
    async function load() {
      try {
        const sessionResponse = await fetch('/api/session');
        const session = await sessionResponse.json();
        if (!sessionResponse.ok) {
          setAuthStatus(sessionResponse.status === 401 ? 'signed_out' : 'forbidden');
          setBlockedEmail(session.email ?? '');
          return;
        }
        setCurrentUser(session.user);
        setAuthStatus('authorized');
        const response = await fetch('/api/appointments');
        if (!response.ok) throw new Error('request failed');
        const data = await response.json();
        setAppointments(data.appointments ?? []);
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
    const stats = new Map<string, { completed: number; absent: number }>();
    appointments.forEach((item) => {
      const current = stats.get(item.groupId) ?? { completed: 0, absent: 0 };
      if (item.status === 'completed') current.completed += 1;
      if (item.status === 'absent') current.absent += 1;
      stats.set(item.groupId, current);
    });
    return stats;
  }, [appointments]);

  const todayAppointments = appointments.filter((item) => item.scheduledDate === today);
  const pendingGroups = Array.from(new Map(appointments.filter((item) => !item.paid).map((item) => [item.groupId, item])).values());
  const renewalItems = appointments.filter((item) => item.sessionNumber === item.totalSessions && item.status === 'completed');
  const editingPlan = editing ? appointments.filter((item) => item.groupId === editing.groupId) : [];
  const completedToDelete = editingPlan.filter((item) => item.status === 'completed').length;
  const deleteBlockers = [
    completedToDelete
      ? `${completedToDelete} ${completedToDelete === 1 ? 'banho já foi concluído' : 'banhos já foram concluídos'}`
      : '',
    editingPlan.some((item) => item.paid) ? 'o pagamento está marcado como pago' : '',
  ].filter(Boolean);

  async function mutate(payload: Record<string, unknown>, message?: string) {
    const loadingLabels: Record<string, string> = {
      create: 'Criando agendamento...',
      edit: 'Salvando alterações...',
      move: 'Movendo atendimento...',
      status: 'Atualizando atendimento...',
      paid: 'Atualizando pagamento...',
      renew: 'Renovando plano...',
      delete: 'Apagando agendamento...',
    };
    setLoaderMessage(loadingLabels[String(payload.action ?? '')] ?? 'Salvando...');
    setSaving(true);
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        const blockerMessage = Array.isArray(data.blockers)
          ? `Não é possível apagar: ${data.blockers.join(' e ')}.`
          : 'Não foi possível salvar. Tente novamente.';
        setNotice(blockerMessage);
        window.setTimeout(() => setNotice(''), 4200);
        return false;
      }
      setAppointments(data.appointments ?? []);
      if (message) {
        setNotice(message);
        window.setTimeout(() => setNotice(''), 2600);
      }
      return true;
    } catch {
      setNotice('Não foi possível salvar. Tente novamente.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openNew(date = today) {
    setForm({ ...emptyForm(), scheduledDate: date });
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
    const ok = await mutate({
      action: 'create', ...form,
      amountCents: realToCents(form.amount),
    }, 'Agendamento criado');
    if (ok) setNewOpen(false);
  }

  function openEdit(item: Appointment) {
    setEditing({ ...item });
    setEditOpen(true);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const ok = await mutate({
      action: 'edit', id: editing.id, ownerName: editing.ownerName, dogName: editing.dogName,
      whatsapp: editing.whatsapp,
      scheduledDate: editing.scheduledDate, scheduledTime: editing.scheduledTime,
      services: editing.services, amountCents: editing.amountCents,
    }, editing.planType === 'single' ? 'Atendimento atualizado' : 'Atendimento e próximas sessões atualizados');
    if (ok) setEditOpen(false);
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

  async function dropOnDay(event: DragEvent<HTMLElement>, scheduledDate: string) {
    event.preventDefault();
    const id = draggingId || event.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDropTarget(null);
    const item = appointments.find((appointment) => appointment.id === id);
    if (!item || item.scheduledDate === scheduledDate) return;

    const previous = appointments;
    setAppointments((current) => current.map((appointment) =>
      appointment.id === id ? { ...appointment, scheduledDate } : appointment,
    ));
    const ok = await mutate({ action: 'move', id, scheduledDate }, `Movido para ${prettyDate(scheduledDate)}`);
    if (!ok) setAppointments(previous);
  }

  async function openTeam() {
    setTeamOpen(true);
    setPanelLoading(true);
    try {
      const response = await fetch('/api/team');
      const data = await response.json();
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
    setPanelLoading(true);
    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error === 'email_exists' ? 'Este e-mail já possui acesso.' : 'Informe um e-mail válido.');
        return;
      }
      setTeamUsers(data.users ?? []);
      setNewUser({ name: '', email: '', role: 'staff' });
      setNotice('Novo acesso criado');
    } catch {
      setNotice('Não foi possível criar o acesso.');
    } finally {
      setPanelLoading(false);
    }
  }

  async function updateTeamUser(user: TeamUser, changes: Partial<Pick<TeamUser, 'active' | 'role'>>) {
    setPanelLoading(true);
    try {
      const response = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, active: changes.active ?? user.active, role: changes.role ?? user.role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error('request failed');
      setTeamUsers(data.users ?? []);
      setNotice(changes.active === false ? 'Acesso desativado' : 'Acesso atualizado');
    } catch {
      setNotice('Não foi possível atualizar o acesso.');
    } finally {
      setPanelLoading(false);
    }
  }

  async function openLogs() {
    setLogsOpen(true);
    setPanelLoading(true);
    try {
      const response = await fetch('/api/audit');
      const data = await response.json();
      if (!response.ok) throw new Error('request failed');
      setAuditLogs(data.logs ?? []);
    } catch {
      setNotice('Não foi possível carregar o histórico.');
    } finally {
      setPanelLoading(false);
    }
  }

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
          <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[#786b82]">Entre com a conta autorizada pela administração para acessar a agenda.</p>
          <a href="/signin-with-chatgpt?return_to=%2F" target="_top" className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7353a6] px-4 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(115,83,166,0.24)] transition hover:bg-[#5e3f90]">
            <ShieldCheck size={19} /> Entrar com ChatGPT
          </a>
        </section>
      </main>
    );
  }

  if (authStatus === 'forbidden') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f3fb] px-5 text-[#302638]">
        <section className="w-full max-w-md rounded-3xl border border-[#e4dced] bg-[#fffbff] p-8 text-center shadow-[0_18px_60px_rgba(91,67,116,0.13)]">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eee6f7] text-[#7353a6]"><Users size={27} /></span>
          <h1 className="mt-5 font-heading text-2xl font-extrabold">Acesso ainda não liberado</h1>
          <p className="mt-3 text-sm leading-6 text-[#786b82]">Peça ao administrador para cadastrar este e-mail na equipe:</p>
          {blockedEmail && <p className="mt-2 rounded-xl bg-[#f1ecf7] px-3 py-2 text-sm font-extrabold text-[#7353a6]">{blockedEmail}</p>}
          <a href="/signout-with-chatgpt?return_to=%2F" target="_top" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#7353a6] hover:underline"><LogOut size={16} /> Entrar com outra conta</a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3fb] text-[#302638]">
      <header className="sticky top-0 z-20 border-b border-[#e4dced] bg-[#fffbff]/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-9">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#7353a6] text-white shadow-sm"><PawPrint size={21} strokeWidth={2.2} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#85768f]">Pet shop</p>
              <h1 className="font-heading text-lg font-extrabold tracking-[-0.03em] sm:text-xl">HEIN PET SALON</h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {currentUser?.role === 'admin' && (
              <>
                <Button variant="ghost" size="icon" onClick={openLogs} aria-label="Abrir histórico" title="Histórico" className="text-[#685872]"><History /></Button>
                <Button variant="ghost" size="icon" onClick={openTeam} aria-label="Gerenciar equipe" title="Equipe" className="text-[#685872]"><Users /></Button>
              </>
            )}
            <div className="hidden text-right md:block">
              <p className="max-w-36 truncate text-xs font-extrabold">{currentUser?.name}</p>
              <p className="text-[10px] font-semibold text-[#8b7c95]">{currentUser?.role === 'admin' ? 'Administrador' : 'Equipe'}</p>
            </div>
            <a href="/signout-with-chatgpt?return_to=%2F" target="_top" aria-label="Sair" title="Sair" className="grid h-9 w-9 place-items-center rounded-lg text-[#7f7189] transition hover:bg-[#eee7f5]"><LogOut size={17} /></a>
            <Button onClick={() => openNew()} className="h-11 rounded-xl bg-[#9b6bc2] px-3.5 font-bold text-white shadow-[0_5px_16px_rgba(115,83,166,0.24)] hover:bg-[#8254a8] sm:px-4">
              <Plus /> <span className="hidden sm:inline">Novo agendamento</span><span className="sm:hidden">Novo</span>
            </Button>
          </div>
        </div>
      </header>

      {saving && (
        <div role="status" aria-live="polite" className="fixed right-4 top-24 z-[70] flex items-center gap-2 rounded-xl bg-[#7353a6] px-4 py-3 text-sm font-bold text-white shadow-xl">
          <LoaderCircle className="animate-spin" size={18} /> {loaderMessage}
        </div>
      )}

      {notice && !saving && (
        <div role="status" className="fixed right-4 top-24 z-50 flex items-center gap-2 rounded-xl bg-[#3c3047] px-4 py-3 text-sm font-bold text-white shadow-xl">
          <CheckCircle2 size={17} /> {notice}
        </div>
      )}

      <div className="mx-auto grid max-w-[1440px] gap-7 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-9">
        <section>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-1 text-sm font-semibold text-[#86778f]">Agenda mensal</p>
              <h2 className="font-heading text-[30px] font-extrabold capitalize tracking-[-0.045em] sm:text-[34px]">{prettyMonth(selectedMonth)}</h2>
              <p className="mt-1 hidden text-xs font-semibold text-[#92849c] sm:block">Arraste pelo ícone <GripVertical className="inline" size={14} /> para trocar o dia</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-[#e4dced] bg-white p-1 shadow-sm">
              <Button variant="ghost" size="icon-sm" onClick={() => setSelectedMonth((month) => addMonths(month, -1))} aria-label="Mês anterior" title="Mês anterior"><ChevronLeft /></Button>
              <button type="button" onClick={() => setSelectedMonth(today.slice(0, 7))} className="inline-flex h-8 min-w-28 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-extrabold capitalize text-[#62556c] transition hover:bg-[#f1ecf7] sm:min-w-36"><CalendarDays size={15} /> {selectedMonth === today.slice(0, 7) ? 'Este mês' : 'Voltar para hoje'}</button>
              <Button variant="ghost" size="icon-sm" onClick={() => setSelectedMonth((month) => addMonths(month, 1))} aria-label="Próximo mês" title="Próximo mês"><ChevronRight /></Button>
            </div>
          </div>

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
                    <div className="flex items-center justify-between border-b border-[#ede6f2] px-4 py-3.5 sm:px-5">
                      <div className="flex flex-wrap items-baseline gap-2.5">
                        <h3 className={`font-heading text-lg font-extrabold ${date === today ? 'text-[#7353a6]' : ''}`}>{date === today ? 'Hoje' : date === addDays(today, 1) ? 'Amanhã' : prettyDate(date).split(',')[0]}</h3>
                        <span className="text-sm font-medium capitalize text-[#81748a]">{prettyDate(date)}</span>
                      </div>
                      <span className="rounded-full bg-[#f1edf5] px-2.5 py-1 text-xs font-bold text-[#776a80]">{dayAppointments.length} {dayAppointments.length === 1 ? 'dog' : 'dogs'}</span>
                    </div>

                    {dayAppointments.length ? (
                      <div className="divide-y divide-[#eee8f3]">
                        {dayAppointments.map((item) => {
                          const stats = groupStats.get(item.groupId) ?? { completed: 0, absent: 0 };
                          const isRenewable = item.sessionNumber === item.totalSessions && item.status === 'completed';
                          return (
                            <div
                              key={item.id}
                              data-appointment-card
                              className={`relative grid gap-4 py-4 pr-4 pl-10 transition hover:bg-white sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center sm:pr-5 sm:pl-11 ${item.status !== 'scheduled' ? 'bg-[#faf7fc]' : ''} ${draggingId === item.id ? 'opacity-45' : ''}`}
                            >
                              <button
                                type="button"
                                draggable={!saving}
                                disabled={saving}
                                onDragStart={(event) => startDragging(event, item)}
                                onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                                aria-label={`Arrastar ${item.dogName || item.ownerName || 'agendamento'} para outro dia`}
                                title="Arraste para outro dia"
                                className="absolute left-1.5 top-1/2 grid h-10 w-7 -translate-y-1/2 cursor-grab place-items-center rounded-lg text-[#9b8ca5] transition hover:bg-[#eee7f5] hover:text-[#7353a6] active:cursor-grabbing"
                              >
                                <GripVertical size={18} />
                              </button>
                              <div className="flex items-center gap-2 font-heading text-sm font-extrabold text-[#6a5c74] sm:block">
                                <Clock3 className="sm:hidden" size={15} /> {item.scheduledTime}
                              </div>
                              <div>
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <div className="mr-1">
                                    <button onClick={() => openEdit(item)} className="group/name flex items-center gap-1.5 text-left">
                                      <h4 className="font-heading text-base font-extrabold tracking-[-0.02em]">{item.dogName || 'Cachorro sem nome'}</h4>
                                      <Pencil size={12} className="text-[#9b8ca5] opacity-0 transition group-hover/name:opacity-100" />
                                    </button>
                                    {item.ownerName && <p className="text-[11px] font-semibold text-[#92849c]">Dono: {item.ownerName}</p>}
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
                                  <button
                                    disabled={saving}
                                    title={item.planType === 'single' ? 'Pagamento deste banho' : 'Pagamento único para todo o plano'}
                                    onClick={() => mutate(
                                      { action: 'paid', id: item.id, paid: !item.paid },
                                      item.planType === 'single'
                                        ? item.paid ? 'Banho marcado como pendente' : 'Pagamento do banho confirmado'
                                        : item.paid ? 'Plano marcado como pendente' : 'Pagamento do plano confirmado',
                                    )}
                                    className={`inline-flex items-center gap-1 text-[11px] font-bold disabled:opacity-50 ${item.paid ? 'text-[#568066]' : 'text-[#c4563c]'}`}
                                  >
                                    <CircleDollarSign size={13} /> {item.planType === 'single' ? (item.paid ? 'Pago' : 'Pendente') : (item.paid ? 'Plano pago' : 'Plano pendente')}
                                  </button>
                                  {formatMoney(item.amountCents) && <span className="text-[11px] font-semibold text-[#81748a]">{formatMoney(item.amountCents)}</span>}
                                </div>
                                <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-[#7d7087]"><Scissors size={14} /> {item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
                                {item.planType !== 'single' && <p className="mt-1.5 text-[11px] font-semibold text-[#92849c]">{stats.completed} concluídas · {stats.absent} faltas</p>}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                                <Button disabled={saving} aria-label="Mover para o dia anterior" title="Mover para o dia anterior" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, -1) }, 'Movido para o dia anterior')}><ChevronLeft /></Button>
                                <Button disabled={saving} aria-label="Mover para o próximo dia" title="Mover para o próximo dia" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, 1) }, 'Movido para o próximo dia')}><ChevronRight /></Button>
                                {isRenewable ? (
                                  <Button disabled={saving} onClick={() => mutate({ action: 'renew', groupId: item.groupId }, 'Plano renovado mantendo o mesmo dia')} className="h-9 bg-[#9b6bc2] px-3 text-xs font-bold text-white hover:bg-[#8254a8]"><RefreshCw /> Renovar</Button>
                                ) : item.status === 'scheduled' ? (
                                  <>
                                    <Button disabled={saving} variant="outline" onClick={() => mutate({ action: 'status', id: item.id, status: 'absent' }, 'Falta registrada')} className="h-9 px-2.5 text-xs font-bold text-[#93503f]"><X /> Falta</Button>
                                    <Button disabled={saving} onClick={() => mutate({ action: 'status', id: item.id, status: 'completed' }, 'Atendimento concluído')} className="h-9 bg-[#7353a6] px-3 text-xs font-bold text-white hover:bg-[#5e3f90]"><Check /> Concluir</Button>
                                  </>
                                ) : (
                                  <Button disabled={saving} variant="ghost" onClick={() => mutate({ action: 'status', id: item.id, status: 'scheduled' }, 'Atendimento reaberto')} className="h-9 px-2.5 text-xs font-bold text-[#76687f]">{item.status === 'completed' ? 'Concluído' : 'Faltou'} · reabrir</Button>
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
                  <button disabled={saving} key={`pending-${item.groupId}`} onClick={() => mutate({ action: 'paid', id: item.id, paid: true }, item.planType === 'single' ? 'Pagamento do banho confirmado' : 'Pagamento do plano confirmado')} className="w-full rounded-xl bg-[#f7eee9] p-3 text-left transition hover:bg-[#f2e3da] disabled:opacity-50">
                    <p className="font-bold">{item.dogName || item.ownerName || 'Sem nome'} · {item.planType === 'single' ? 'banho pendente' : 'plano pendente'}</p><p className="mt-1 text-xs text-[#7e7771]">{item.planType === 'single' ? 'Toque para marcar o banho como pago' : 'Toque para marcar todas as sessões como pagas'}</p>
                  </button>
                ))}
                {renewalItems.slice(0, 3).map((item) => (
                  <button disabled={saving} key={`renew-${item.id}`} onClick={() => mutate({ action: 'renew', groupId: item.groupId }, 'Plano renovado mantendo o mesmo dia')} className="w-full rounded-xl bg-[#f1ecf7] p-3 text-left transition hover:bg-[#e9e0f3] disabled:opacity-50">
                    <p className="font-bold">{item.dogName || item.ownerName || 'Sem nome'} · última sessão</p><p className="mt-1 text-xs font-extrabold text-[#7353a6]">Renovar plano →</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-5 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-extrabold tracking-[-0.03em]">Novo agendamento</DialogTitle>
            <DialogDescription>Cadastre o plano e o primeiro banho. Os próximos entram sozinhos no mesmo dia da semana.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createAppointment} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><UserRound size={14} /> Nome do dono</span><Input autoFocus value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Ex.: Ana" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><Dog size={14} /> Nome do cachorro</span><Input value={form.dogName} onChange={(event) => setForm({ ...form, dogName: event.target.value })} placeholder="Ex.: Bob" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><MessageCircle size={14} /> WhatsApp</span><Input type="tel" inputMode="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} placeholder="(47) 99999-9999" className="h-11 bg-white" /></label>
            </div>
            <div>
              <span className="mb-2 block text-xs font-bold text-[#6f6179]">Tipo de plano</span>
              <div className="grid gap-2 sm:grid-cols-3">
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
                      });
                      setActiveServiceSession(0);
                    }}
                    className={`rounded-xl border p-3 text-left transition ${form.planType === plan ? 'border-[#7353a6] bg-[#eee6f7] ring-1 ring-[#7353a6]' : 'border-[#e4dced] bg-white hover:border-[#bbaacd]'}`}
                  >
                    <strong className="block text-sm">{planLabels[plan]}</strong><span className="mt-1 block text-[11px] text-[#81748a]">{planDescriptions[plan]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Primeiro banho</span><Input type="date" value={form.scheduledDate} onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Horário</span><Input type="time" value={form.scheduledTime} onChange={(event) => setForm({ ...form, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Valor (opcional)</span><Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: maskReal(event.target.value) })} placeholder="R$ 0,00" className="h-11 bg-white font-semibold tabular-nums" /></label>
            </div>
            <div className="rounded-2xl border border-[#e4dced] bg-white p-3.5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><Scissors size={14} /> Serviços por sessão</span>
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
                    Repetir em todas
                  </button>
                )}
              </div>
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {Array.from({ length: totalSessionsFor(form.planType) }, (_, index) => {
                  const date = addDays(form.scheduledDate, intervalDaysFor(form.planType) * index);
                  return (
                    <button
                      type="button"
                      key={index}
                      onClick={() => setActiveServiceSession(index)}
                      className={`min-w-[92px] rounded-xl border px-3 py-2 text-left transition ${activeServiceSession === index ? 'border-[#7353a6] bg-[#eee6f7] ring-1 ring-[#7353a6]' : 'border-[#ded7e7] bg-[#fbf9fd]'}`}
                    >
                      <strong className="block text-xs">Sessão {index + 1}</strong>
                      <span className="mt-0.5 block text-[10px] capitalize text-[#81748a]">{new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`))}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mb-2 text-[11px] font-semibold text-[#81748a]">Escolha o que fazer na sessão {activeServiceSession + 1}</p>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((service) => {
                  const selected = (form.sessionServices[activeServiceSession] ?? []).includes(service);
                  return <button type="button" key={service} onClick={() => toggleService(service)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? 'border-[#7353a6] bg-[#7353a6] text-white' : 'border-[#e4dced] bg-white text-[#6f6179]'}`}>{selected && <Check className="mr-1 inline" size={13} />}{service}</button>;
                })}
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#e4dced] bg-white p-3.5"><span><strong className="block text-sm">{form.planType === 'single' ? 'O banho já está pago?' : 'O plano já está pago?'}</strong><small className="text-xs text-[#85768f]">{form.planType === 'single' ? 'Você pode mudar isso depois' : `Pagamento único para todas as ${totalSessionsFor(form.planType)} sessões`}</small></span><Switch checked={form.paid} onCheckedChange={(checked) => setForm({ ...form, paid: checked })} /></label>
            <DialogFooter className="-mx-5 -mb-5 px-5">
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#9b6bc2] font-bold text-white hover:bg-[#8254a8]">{saving ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {saving ? 'Salvando...' : 'Criar agendamento'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-5 sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading text-xl font-extrabold">Editar atendimento</DialogTitle><DialogDescription>{editing?.planType === 'single' ? 'Altere os detalhes deste atendimento.' : 'Ao mudar a data, as próximas sessões do plano acompanham automaticamente.'}</DialogDescription></DialogHeader>
          {editing && <form onSubmit={saveEdit} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do dono</span><Input value={editing.ownerName} onChange={(event) => setEditing({ ...editing, ownerName: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome do cachorro</span><Input value={editing.dogName} onChange={(event) => setEditing({ ...editing, dogName: event.target.value })} className="h-11 bg-white" /></label>
            </div>
            <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#6f6179]"><MessageCircle size={14} /> WhatsApp</span><Input type="tel" inputMode="tel" value={editing.whatsapp} onChange={(event) => setEditing({ ...editing, whatsapp: event.target.value })} placeholder="(47) 99999-9999" className="h-11 bg-white" /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Data do banho</span><Input type="date" value={editing.scheduledDate} onChange={(event) => setEditing({ ...editing, scheduledDate: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Horário</span><Input type="time" value={editing.scheduledTime} onChange={(event) => setEditing({ ...editing, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Valor (opcional)</span><Input inputMode="numeric" value={formatMoney(editing.amountCents) ?? ''} onChange={(event) => setEditing({ ...editing, amountCents: realToCents(event.target.value) })} placeholder="R$ 0,00" className="h-11 bg-white font-semibold tabular-nums" /></label>
            </div>
            <div><span className="mb-2 block text-xs font-bold text-[#6f6179]">O que é para fazer</span><div className="flex flex-wrap gap-2">{serviceOptions.map((service) => <button type="button" key={service} onClick={() => toggleService(service, true)} className={`rounded-full border px-3 py-2 text-xs font-bold ${editing.services.includes(service) ? 'border-[#7353a6] bg-[#7353a6] text-white' : 'border-[#e4dced] bg-white text-[#6f6179]'}`}>{service}</button>)}</div></div>
            <DialogFooter className="-mx-5 -mb-5 px-5 sm:justify-between">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setDeleteOpen(true)} className="border-[#ead0cc] text-[#a94338] hover:bg-[#fbefed] hover:text-[#92382f]"><Trash2 /> {editing.planType === 'single' ? 'Apagar banho' : 'Apagar plano'}</Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving} className="bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90]">{saving && <LoaderCircle className="animate-spin" />} {saving ? 'Salvando...' : 'Salvar alterações'}</Button>
              </div>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-0 bg-[#fffbff]">
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
            <AlertDialogCancel disabled={saving}>{deleteBlockers.length ? 'Entendi' : 'Cancelar'}</AlertDialogCancel>
            {!deleteBlockers.length && <AlertDialogAction disabled={saving} onClick={deleteAppointment} className="bg-[#a94338] font-bold text-white hover:bg-[#92382f]">{saving ? <LoaderCircle className="animate-spin" /> : <Trash2 />} {saving ? 'Apagando...' : 'Apagar definitivamente'}</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-5 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading text-xl font-extrabold"><Users className="text-[#7353a6]" /> Equipe e acessos</DialogTitle>
            <DialogDescription>Cadastre o e-mail usado na conta do ChatGPT. A pessoa entra pelo mesmo endereço do sistema.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addTeamUser} className="rounded-2xl border border-[#dfd5e8] bg-[#f7f3fb] p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[#574761]"><UserPlus size={17} /> Criar novo acesso</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1.35fr_140px]">
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Nome</span><Input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Ex.: Maria" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">E-mail da conta</span><Input required type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="maria@email.com" className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#6f6179]">Permissão</span><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as 'admin' | 'staff' })} className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#7353a6]/30"><option value="staff">Equipe</option><option value="admin">Administrador</option></select></label>
            </div>
            <Button type="submit" disabled={panelLoading} className="mt-3 bg-[#7353a6] font-bold text-white hover:bg-[#5e3f90]"><Plus /> {panelLoading ? 'Salvando...' : 'Criar acesso'}</Button>
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
          <DialogFooter className="-mx-5 -mb-5 px-5"><Button variant="outline" onClick={() => setTeamOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fffbff] p-5 sm:max-w-2xl">
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
          <DialogFooter className="-mx-5 -mb-5 px-5"><Button variant="outline" onClick={() => setLogsOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
