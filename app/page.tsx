'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  Clock3, PawPrint, Pencil, Plus, RefreshCw, Scissors, Sparkles, UserRound, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

const serviceOptions = ['Banho', 'Tosa higiênica', 'Tosa completa', 'Cortar unhas', 'Limpar ouvidos', 'Escovação'];
const planLabels: Record<PlanType, string> = { monthly: 'Mensal', fortnightly: 'Quinzenal', single: 'Avulso' };
const planDescriptions: Record<PlanType, string> = {
  monthly: '4 banhos · toda semana', fortnightly: '2 banhos · a cada 15 dias', single: '1 atendimento',
};

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function addDays(dateString: string, amount: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateString(date);
}

function prettyDate(dateString: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${dateString}T12:00:00`)).replace('-feira', '');
}

function formatMoney(cents: number | null) {
  if (cents === null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

const emptyForm = () => ({
  customerPetName: '', planType: 'monthly' as PlanType, amount: '', paid: false,
  scheduledDate: localDateString(), scheduledTime: '09:00', services: ['Banho'],
});

export default function Home() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [daysShown, setDaysShown] = useState(14);
  const [notice, setNotice] = useState('');
  const today = localDateString();

  useEffect(() => {
    fetch('/api/appointments')
      .then((response) => response.json())
      .then((data) => setAppointments(data.appointments ?? []))
      .catch(() => setNotice('Não foi possível carregar a agenda. Tente novamente.'))
      .finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => Array.from({ length: daysShown }, (_, index) => addDays(today, index)), [daysShown, today]);
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

  async function mutate(payload: Record<string, unknown>, message?: string) {
    setSaving(true);
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('request failed');
      const data = await response.json();
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
    setNewOpen(true);
  }

  function toggleService(service: string, edit = false) {
    if (edit && editing) {
      setEditing({ ...editing, services: editing.services.includes(service) ? editing.services.filter((item) => item !== service) : [...editing.services, service] });
      return;
    }
    setForm((current) => ({ ...current, services: current.services.includes(service) ? current.services.filter((item) => item !== service) : [...current.services, service] }));
  }

  async function createAppointment(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({
      action: 'create', ...form,
      amountCents: form.amount ? Math.round(Number(form.amount.replace(',', '.')) * 100) : null,
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
      action: 'edit', id: editing.id, customerPetName: editing.customerPetName,
      scheduledTime: editing.scheduledTime, services: editing.services, amountCents: editing.amountCents,
    }, 'Atendimento atualizado');
    if (ok) setEditOpen(false);
  }

  return (
    <main className="min-h-screen bg-[#f5f3ee] text-[#202420]">
      <header className="sticky top-0 z-20 border-b border-[#dfe2dc] bg-[#fbfaf7]/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-9">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#275848] text-white shadow-sm"><PawPrint size={21} strokeWidth={2.2} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a847b]">Pet shop</p>
              <h1 className="font-heading text-lg font-extrabold tracking-[-0.03em] sm:text-xl">Banho em Dia</h1>
            </div>
          </div>
          <Button onClick={() => openNew()} className="h-11 rounded-xl bg-[#e56b4a] px-3.5 font-bold text-white shadow-[0_5px_16px_rgba(202,77,45,0.22)] hover:bg-[#cf5c3d] sm:px-4">
            <Plus /> <span className="hidden sm:inline">Novo agendamento</span><span className="sm:hidden">Novo</span>
          </Button>
        </div>
      </header>

      {notice && (
        <div role="status" className="fixed right-4 top-24 z-50 flex items-center gap-2 rounded-xl bg-[#202b24] px-4 py-3 text-sm font-bold text-white shadow-xl">
          <CheckCircle2 size={17} /> {notice}
        </div>
      )}

      <div className="mx-auto grid max-w-[1440px] gap-7 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-9">
        <section>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-1 text-sm font-semibold capitalize text-[#728078]">Agenda de {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date())}</p>
              <h2 className="font-heading text-[30px] font-extrabold tracking-[-0.045em] sm:text-[34px]">Próximos banhos</h2>
            </div>
            <Button variant="outline" onClick={() => setDaysShown((value) => value === 14 ? 30 : 14)} className="h-10 bg-white px-3.5 font-semibold text-[#4a554d] shadow-sm">
              <CalendarDays /> {daysShown === 14 ? 'Ver 30 dias' : 'Ver 14 dias'}
            </Button>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-[#dfe2dc] bg-[#fbfaf7] p-12 text-center text-sm font-semibold text-[#7b857e]">Carregando agenda...</div>
          ) : (
            <div className="space-y-4">
              {days.map((date, index) => {
                const dayAppointments = appointments.filter((item) => item.scheduledDate === date);
                return (
                  <article key={date} className="overflow-hidden rounded-2xl border border-[#dfe2dc] bg-[#fbfaf7] shadow-[0_2px_10px_rgba(40,55,46,0.04)]">
                    <div className="flex items-center justify-between border-b border-[#e5e6e1] px-4 py-3.5 sm:px-5">
                      <div className="flex flex-wrap items-baseline gap-2.5">
                        <h3 className={`font-heading text-lg font-extrabold ${index === 0 ? 'text-[#275848]' : ''}`}>{index === 0 ? 'Hoje' : index === 1 ? 'Amanhã' : prettyDate(date).split(',')[0]}</h3>
                        <span className="text-sm font-medium capitalize text-[#7b857e]">{prettyDate(date)}</span>
                      </div>
                      <span className="rounded-full bg-[#eceee9] px-2.5 py-1 text-xs font-bold text-[#677269]">{dayAppointments.length} {dayAppointments.length === 1 ? 'dog' : 'dogs'}</span>
                    </div>

                    {dayAppointments.length ? (
                      <div className="divide-y divide-[#e8e9e5]">
                        {dayAppointments.map((item) => {
                          const stats = groupStats.get(item.groupId) ?? { completed: 0, absent: 0 };
                          const isRenewable = item.sessionNumber === item.totalSessions && item.status === 'completed';
                          return (
                            <div key={item.id} className={`grid gap-4 px-4 py-4 transition hover:bg-white sm:grid-cols-[62px_minmax(0,1fr)_auto] sm:items-center sm:px-5 ${item.status !== 'scheduled' ? 'bg-[#f7f7f3]' : ''}`}>
                              <div className="flex items-center gap-2 font-heading text-sm font-extrabold text-[#566158] sm:block">
                                <Clock3 className="sm:hidden" size={15} /> {item.scheduledTime}
                              </div>
                              <div>
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <button onClick={() => openEdit(item)} className="group/name flex items-center gap-1.5 text-left">
                                    <h4 className="font-heading text-base font-extrabold tracking-[-0.02em]">{item.customerPetName || 'Sem nome'}</h4>
                                    <Pencil size={12} className="text-[#9ba29c] opacity-0 transition group-hover/name:opacity-100" />
                                  </button>
                                  <span className="rounded-full bg-[#e3eee8] px-2 py-0.5 text-[11px] font-bold text-[#275848]">{planLabels[item.planType]} · {item.sessionNumber} de {item.totalSessions}</span>
                                  <button onClick={() => mutate({ action: 'paid', id: item.id, paid: !item.paid }, item.paid ? 'Marcado como pendente' : 'Pagamento confirmado')} className={`inline-flex items-center gap-1 text-[11px] font-bold ${item.paid ? 'text-[#568066]' : 'text-[#c4563c]'}`}>
                                    <CircleDollarSign size={13} /> {item.paid ? 'Pago' : 'Pendente'}
                                  </button>
                                  {formatMoney(item.amountCents) && <span className="text-[11px] font-semibold text-[#7b857e]">{formatMoney(item.amountCents)}</span>}
                                </div>
                                <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-[#727c74]"><Scissors size={14} /> {item.services.length ? item.services.join(' · ') : 'Sem serviços definidos'}</p>
                                {item.planType !== 'single' && <p className="mt-1.5 text-[11px] font-semibold text-[#879088]">{stats.completed} concluídas · {stats.absent} faltas</p>}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                                <Button aria-label="Mover para o dia anterior" title="Mover para o dia anterior" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, -1) }, 'Movido para o dia anterior')}><ChevronLeft /></Button>
                                <Button aria-label="Mover para o próximo dia" title="Mover para o próximo dia" variant="ghost" size="icon-sm" onClick={() => mutate({ action: 'move', id: item.id, scheduledDate: addDays(item.scheduledDate, 1) }, 'Movido para o próximo dia')}><ChevronRight /></Button>
                                {isRenewable ? (
                                  <Button disabled={saving} onClick={() => mutate({ action: 'renew', groupId: item.groupId }, 'Plano renovado mantendo o mesmo dia')} className="h-9 bg-[#e56b4a] px-3 text-xs font-bold text-white hover:bg-[#cf5c3d]"><RefreshCw /> Renovar</Button>
                                ) : item.status === 'scheduled' ? (
                                  <>
                                    <Button disabled={saving} variant="outline" onClick={() => mutate({ action: 'status', id: item.id, status: 'absent' }, 'Falta registrada')} className="h-9 px-2.5 text-xs font-bold text-[#93503f]"><X /> Falta</Button>
                                    <Button disabled={saving} onClick={() => mutate({ action: 'status', id: item.id, status: 'completed' }, 'Atendimento concluído')} className="h-9 bg-[#275848] px-3 text-xs font-bold text-white hover:bg-[#1e4639]"><Check /> Concluir</Button>
                                  </>
                                ) : (
                                  <Button variant="ghost" onClick={() => mutate({ action: 'status', id: item.id, status: 'scheduled' }, 'Atendimento reaberto')} className="h-9 px-2.5 text-xs font-bold text-[#667168]">{item.status === 'completed' ? 'Concluído' : 'Faltou'} · reabrir</Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <button onClick={() => openNew(date)} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm font-semibold text-[#7c867f] transition hover:bg-white">
                        <span className="grid h-8 w-8 place-items-center rounded-lg border border-dashed border-[#b9c1ba]"><Plus size={16} /></span>Adicionar dog neste dia
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-[108px] lg:self-start">
          <div className="rounded-2xl bg-[#275848] p-5 text-white shadow-[0_10px_30px_rgba(39,88,72,0.18)]">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#bcd3ca]">Resumo de hoje</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div><strong className="font-heading text-3xl">{todayAppointments.length}</strong><span className="mt-1 block text-[11px] text-[#cce0d8]">agendados</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'completed').length}</strong><span className="mt-1 block text-[11px] text-[#cce0d8]">concluídos</span></div>
              <div><strong className="font-heading text-3xl">{todayAppointments.filter((item) => item.status === 'absent').length}</strong><span className="mt-1 block text-[11px] text-[#cce0d8]">faltas</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dfe2dc] bg-[#fbfaf7] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading font-extrabold">Atenção</h3>
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#f3ded7] px-1.5 text-xs font-extrabold text-[#b84f34]">{pendingGroups.length + renewalItems.length}</span>
            </div>
            {pendingGroups.length + renewalItems.length === 0 ? (
              <p className="rounded-xl bg-[#eef1ec] p-3 text-sm font-semibold text-[#768078]">Tudo em dia por aqui.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {pendingGroups.slice(0, 3).map((item) => (
                  <button key={`pending-${item.groupId}`} onClick={() => mutate({ action: 'paid', id: item.id, paid: true }, 'Pagamento confirmado')} className="w-full rounded-xl bg-[#f7eee9] p-3 text-left transition hover:bg-[#f2e3da]">
                    <p className="font-bold">{item.customerPetName || 'Sem nome'} · pendente</p><p className="mt-1 text-xs text-[#7e7771]">Toque para marcar como pago</p>
                  </button>
                ))}
                {renewalItems.slice(0, 3).map((item) => (
                  <button key={`renew-${item.id}`} onClick={() => mutate({ action: 'renew', groupId: item.groupId }, 'Plano renovado mantendo o mesmo dia')} className="w-full rounded-xl bg-[#eef1ec] p-3 text-left transition hover:bg-[#e5ebe5]">
                    <p className="font-bold">{item.customerPetName || 'Sem nome'} · última sessão</p><p className="mt-1 text-xs font-extrabold text-[#275848]">Renovar plano →</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fbfaf7] p-5 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-extrabold tracking-[-0.03em]">Novo agendamento</DialogTitle>
            <DialogDescription>Cadastre o plano e o primeiro banho. Os próximos entram sozinhos no mesmo dia da semana.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createAppointment} className="space-y-5">
            <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#5f6a62]"><UserRound size={14} /> Cliente + cachorro</span><Input autoFocus value={form.customerPetName} onChange={(event) => setForm({ ...form, customerPetName: event.target.value })} placeholder="Ex.: Ana + Bob" className="h-11 bg-white" /></label>
            <div>
              <span className="mb-2 block text-xs font-bold text-[#5f6a62]">Tipo de plano</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(planLabels) as PlanType[]).map((plan) => (
                  <button type="button" key={plan} onClick={() => setForm({ ...form, planType: plan })} className={`rounded-xl border p-3 text-left transition ${form.planType === plan ? 'border-[#275848] bg-[#e5eee9] ring-1 ring-[#275848]' : 'border-[#dfe2dc] bg-white hover:border-[#aab5ad]'}`}>
                    <strong className="block text-sm">{planLabels[plan]}</strong><span className="mt-1 block text-[11px] text-[#758078]">{planDescriptions[plan]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Primeiro banho</span><Input type="date" value={form.scheduledDate} onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Horário</span><Input type="time" value={form.scheduledTime} onChange={(event) => setForm({ ...form, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Valor (opcional)</span><Input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="R$ 0,00" className="h-11 bg-white" /></label>
            </div>
            <div>
              <span className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#5f6a62]"><Scissors size={14} /> O que é para fazer</span>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((service) => <button type="button" key={service} onClick={() => toggleService(service)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${form.services.includes(service) ? 'border-[#275848] bg-[#275848] text-white' : 'border-[#d8ddd6] bg-white text-[#5f6a62]'}`}>{form.services.includes(service) && <Check className="mr-1 inline" size={13} />}{service}</button>)}
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#dfe2dc] bg-white p-3.5"><span><strong className="block text-sm">Já está pago?</strong><small className="text-xs text-[#7a847b]">Você pode mudar isso depois</small></span><Switch checked={form.paid} onCheckedChange={(checked) => setForm({ ...form, paid: checked })} /></label>
            <DialogFooter className="-mx-5 -mb-5 px-5">
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#e56b4a] font-bold text-white hover:bg-[#cf5c3d]"><Sparkles /> {saving ? 'Salvando...' : 'Criar agendamento'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-0 bg-[#fbfaf7] p-5 sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading text-xl font-extrabold">Editar atendimento</DialogTitle><DialogDescription>Altere os detalhes somente desta sessão.</DialogDescription></DialogHeader>
          {editing && <form onSubmit={saveEdit} className="space-y-5">
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Cliente + cachorro</span><Input value={editing.customerPetName} onChange={(event) => setEditing({ ...editing, customerPetName: event.target.value })} className="h-11 bg-white" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Horário</span><Input type="time" value={editing.scheduledTime} onChange={(event) => setEditing({ ...editing, scheduledTime: event.target.value })} className="h-11 bg-white" /></label>
              <label><span className="mb-1.5 block text-xs font-bold text-[#5f6a62]">Valor (opcional)</span><Input inputMode="decimal" value={editing.amountCents === null ? '' : String(editing.amountCents / 100).replace('.', ',')} onChange={(event) => setEditing({ ...editing, amountCents: event.target.value ? Math.round(Number(event.target.value.replace(',', '.')) * 100) : null })} className="h-11 bg-white" /></label>
            </div>
            <div><span className="mb-2 block text-xs font-bold text-[#5f6a62]">O que é para fazer</span><div className="flex flex-wrap gap-2">{serviceOptions.map((service) => <button type="button" key={service} onClick={() => toggleService(service, true)} className={`rounded-full border px-3 py-2 text-xs font-bold ${editing.services.includes(service) ? 'border-[#275848] bg-[#275848] text-white' : 'border-[#d8ddd6] bg-white text-[#5f6a62]'}`}>{service}</button>)}</div></div>
            <DialogFooter className="-mx-5 -mb-5 px-5"><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving} className="bg-[#275848] font-bold text-white hover:bg-[#1e4639]">Salvar alterações</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
