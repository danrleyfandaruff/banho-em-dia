'use client';

import { useRef, useState } from 'react';
import {
  Check,
  CircleDollarSign,
  LoaderCircle,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Appointment } from '@/lib/agenda-types';
import { extraTotal, type ExtraService } from '@/lib/appointment-services';
import { businessDate, validDate } from '@/lib/finance-date';
import {
  calculatePayment,
  cardRateBps,
  type CardRates,
  type PaymentBreakdown,
} from '@/lib/payment';

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value / 100,
  );
const cents = (value: string) =>
  value.replace(/\D/g, '') ? Number(value.replace(/\D/g, '')) : null;
const methods = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
};
const empty = () => ({
  name: '',
  amount: '',
  paid: false,
  method: '' as ExtraService['paymentMethod'],
  date: businessDate(),
});
export function ExtraSummary({
  extras,
  onOpen,
}: {
  extras: ExtraService[];
  onOpen: () => void;
}) {
  if (!extras.length) return null;
  const pending = extras.filter((extra) => !extra.paid);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 block max-w-full rounded-lg border border-[#e6dcec] bg-white px-3 py-2 text-left text-xs leading-5 text-[#6c527f]"
    >
      <span className="font-semibold">
        <Scissors size={13} className="mr-1 inline" />
        Extras: {extras.map((extra) => extra.name).join(' · ')}
      </span>
      <span className="block">
        {pending.length
          ? `${money(pending.reduce((sum, extra) => sum + extra.amountCents, 0))} pendente${pending.length > 1 ? 's' : ''}`
          : 'Extras pagos'}{' '}
        · Ver detalhes
      </span>
    </button>
  );
}
export function SessionExtras({
  appointment,
  rates,
  options,
  error,
  onSave,
  onClose,
}: {
  appointment: Appointment;
  rates: CardRates;
  options: string[];
  error: string;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [confirm, setConfirm] = useState<{
    id: string;
    action: 'extra_remove' | 'extra_unpay';
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const createId = useRef<string | null>(null);
  const extras = appointment.extras ?? [];
  const selected = extras.find((extra) => extra.id === editingId);
  const effectiveRates =
    selected?.paid &&
    selected.paymentDetails &&
    selected.paymentMethod === draft.method
      ? { ...rates, [draft.method]: selected.paymentDetails.rateBps }
      : rates;
  let payment: PaymentBreakdown | null = null;
  try {
    payment = calculatePayment(
      cents(draft.amount),
      draft.method,
      effectiveRates,
    );
  } catch {
    /* Display validation instead of an invalid preview. */
  }
  const available = options.filter(
    (name) =>
      !appointment.services.includes(name) &&
      !extras.some((extra) => extra.id !== editingId && extra.name === name),
  );
  const reset = () => {
    setDraft(empty());
    setEditingId(null);
    createId.current = null;
    setLocalError('');
    setConfirm(null);
  };
  const edit = (extra: ExtraService, receive = false) => {
    setEditingId(extra.id);
    setDraft({
      name: extra.name,
      amount: money(extra.amountCents),
      paid: receive || extra.paid,
      method: extra.paymentMethod,
      date: extra.paymentDetails?.receipt?.date ?? businessDate(),
    });
    setLocalError('');
    setConfirm(null);
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  };
  async function save(payload: Record<string, unknown>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setLocalError('');
    try {
      return await onSave({
        ...payload,
        id: appointment.id,
        revision: appointment.servicesRevision,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = cents(draft.amount);
    if (
      !draft.name.trim() ||
      amount === null ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 100_000_000
    ) {
      setLocalError('Informe o serviço e um valor válido.');
      return;
    }
    if (
      draft.paid &&
      (!draft.method ||
        !payment ||
        !validDate(draft.date) ||
        draft.date > businessDate())
    ) {
      setLocalError('Confira a forma e a data do pagamento.');
      return;
    }
    createId.current ??= crypto.randomUUID();
    const ok = await save({
      action: editingId ? 'extra_edit' : 'extra_create',
      extraId: editingId ?? createId.current,
      name: draft.name.trim(),
      amountCents: amount,
      paid: draft.paid,
      paymentMethod: draft.method,
      paymentDate: draft.date,
      expectedRateBps: cardRateBps(draft.method, effectiveRates),
    });
    if (ok) reset();
  }
  async function confirmAction() {
    if (!confirm) return;
    const ok = await save({ action: confirm.action, extraId: confirm.id });
    if (ok) reset();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent className="mobile-sheet max-h-[92vh] overflow-y-auto bg-[#fffbff] p-4 sm:max-w-xl sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-extrabold">
            <Scissors className="text-[#7353a6]" />
            Serviços extras
          </DialogTitle>
          <DialogDescription>
            {appointment.dogName} ·{' '}
            {appointment.scheduledDate.split('-').reverse().join('/')} ·{' '}
            {appointment.planType === 'single'
              ? 'Atendimento avulso'
              : `Sessão ${appointment.sessionNumber} de ${appointment.totalSessions}`}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-[#f2edf7] p-3 text-sm leading-6 text-[#6c527f]">
          {appointment.planType === 'single' ? 'Atendimento' : 'Plano'}{' '}
          {appointment.paid ? 'pago' : 'pendente'}. Os extras têm pagamento
          próprio e valem somente para esta sessão.
        </p>
        {extras.length > 0 && (
          <div className="space-y-3" aria-label="Extras desta sessão">
            {extras.map((extra) => (
              <article
                key={extra.id}
                className="rounded-xl border border-[#e4dced] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{extra.name}</p>
                    <p
                      className={`mt-1 text-sm ${extra.paid ? 'text-[#347052]' : 'text-[#a0472e]'}`}
                    >
                      {money(extraTotal(extra))} ·{' '}
                      {extra.paid ? 'Pago' : 'Pendente'}
                      {extra.paid && extra.paymentDetails?.receipt
                        ? ` · ${extra.paymentDetails.receipt.date.split('-').reverse().join('/')}`
                        : ''}
                    </p>
                    {extra.paid && (
                      <p className="mt-1 text-xs text-[#81748a]">
                        {methods[extra.paymentMethod as keyof typeof methods]}
                        {extra.paymentDetails?.surchargeCents
                          ? ` · acréscimo ${money(extra.paymentDetails.surchargeCents)}`
                          : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {!extra.paid && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => edit(extra, true)}
                      >
                        <CircleDollarSign />
                        Receber
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => edit(extra)}
                    >
                      <Pencil />
                      Editar
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirm({
                        id: extra.id,
                        action: extra.paid ? 'extra_unpay' : 'extra_remove',
                      });
                      setLocalError('');
                    }}
                  >
                    {extra.paid ? (
                      <>
                        <Undo2 />
                        Corrigir para pendente
                      </>
                    ) : (
                      <>
                        <Trash2 />
                        Remover extra
                      </>
                    )}
                  </Button>
                </div>
                {confirm?.id === extra.id && (
                  <div className="mt-2 rounded-lg bg-[#fff4e7] p-3 text-sm">
                    <p>
                      {confirm.action === 'extra_unpay'
                        ? 'Corrigir o registro para pendente? Ele sairá dos recebimentos nas análises. Isso não faz estorno bancário.'
                        : 'Remover este extra pendente da sessão?'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void confirmAction()}
                      >
                        Confirmar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm(null)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <form
          ref={formRef}
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-[#e4dced] bg-white p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">
              {selected ? `Editar ${selected.name}` : 'Adicionar serviço extra'}
            </h3>
            {editingId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={reset}
              >
                <Plus />
                Novo extra
              </Button>
            )}
          </div>
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <label htmlFor="extra-name" className="block text-sm font-semibold">
              Serviço
              <Input
                id="extra-name"
                list="extra-options"
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Ex.: Tosa bebê, Tosa completa"
                className="mt-1.5 h-11"
              />
              <datalist id="extra-options">
                {available.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </datalist>
            </label>
            <label
              htmlFor="extra-amount"
              className="block text-sm font-semibold"
            >
              Valor do extra, sem taxa
              <Input
                id="extra-amount"
                required
                inputMode="numeric"
                value={draft.amount}
                onChange={(event) => {
                  const value = cents(event.target.value);
                  setDraft({
                    ...draft,
                    amount: value === null ? '' : money(value),
                  });
                }}
                placeholder="R$ 0,00"
                className="mt-1.5 h-11"
              />
            </label>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.paid}
                disabled={Boolean(selected?.paid)}
                onChange={(event) =>
                  setDraft({ ...draft, paid: event.target.checked })
                }
                className="size-4 accent-[#7353a6]"
              />
              {selected?.paid
                ? 'Pagamento já registrado'
                : 'O extra já foi pago'}
            </label>
            {draft.paid && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  htmlFor="extra-method"
                  className="block text-sm font-semibold"
                >
                  Forma de pagamento
                  <select
                    id="extra-method"
                    required
                    value={draft.method}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        method: event.target
                          .value as ExtraService['paymentMethod'],
                      })
                    }
                    className="mt-1.5 h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Escolha</option>
                    {Object.entries(methods).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  htmlFor="extra-date"
                  className="block text-sm font-semibold"
                >
                  Data do pagamento
                  <Input
                    id="extra-date"
                    required
                    type="date"
                    max={businessDate()}
                    value={draft.date}
                    onChange={(event) =>
                      setDraft({ ...draft, date: event.target.value })
                    }
                    className="mt-1.5 h-11"
                  />
                </label>
              </div>
            )}
            {draft.paid && payment && draft.method && (
              <div className="rounded-lg bg-[#f2edf7] p-3 text-sm">
                <p>Valor do serviço: {money(payment.baseCents)}</p>
                <p className="mt-1">
                  Acréscimo{' '}
                  {payment.rateBps > 0
                    ? `(${(payment.rateBps / 100).toLocaleString('pt-BR')}%)`
                    : ''}
                  : {money(payment.surchargeCents)}
                </p>
                <p className="mt-2 font-bold">
                  Total: {money(payment.totalCents)}
                </p>
              </div>
            )}
            <p className="text-xs leading-5 text-[#81748a]">
              Este serviço não muda o preço do plano nem será incluído na
              próxima renovação.
            </p>
            {(error || localError) && (
              <p
                role="alert"
                className="rounded-lg bg-[#fff0e7] p-3 text-sm text-[#994821]"
              >
                {localError || error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full bg-[#7353a6] text-white hover:bg-[#5e3f90]"
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
              {busy
                ? 'Salvando...'
                : selected
                  ? 'Salvar alterações'
                  : 'Adicionar extra'}
            </Button>
          </fieldset>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Voltar ao atendimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
