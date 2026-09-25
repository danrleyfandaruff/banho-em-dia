'use client';

import { useMemo, useRef, useState } from 'react';
import { Dog, LoaderCircle, Search, UserPlus } from 'lucide-react';
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
import type { ClientProfile, PetProfile } from '@/lib/agenda-types';
import {
  registrationNameMessages,
  validateRegistrationNames,
} from '@/lib/registration-validation';
import { normalize } from '@/lib/agenda-view';

export type ProfileDraft = {
  clientId: string;
  petId: string;
  ownerName: string;
  dogName: string;
  whatsapp: string;
  cpf: string;
  notes: string;
};
export function PetProfileEditor({
  initial,
  clients,
  profiles,
  error,
  onSave,
  onClose,
}: {
  initial: ProfileDraft;
  clients: ClientProfile[];
  profiles: PetProfile[];
  error: string;
  onSave: (draft: ProfileDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [mode, setMode] = useState<'new' | 'existing'>(
    initial.clientId ? 'existing' : 'new',
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const lock = useRef(false);
  const editing = Boolean(initial.petId);
  const selectedClient = clients.find((client) => client.id === draft.clientId);
  const matchingClients = useMemo(
    () =>
      clients
        .filter((client) => {
          const query = normalize(search);
          const digits = search.replace(/\D/g, '');
          return (
            !query ||
            normalize(
              `${client.ownerName} ${client.whatsapp} ${client.cpf}`,
            ).includes(query) ||
            Boolean(
              digits &&
              !/[a-z]/i.test(query) &&
              `${client.whatsapp}${client.cpf}`
                .replace(/\D/g, '')
                .includes(digits),
            )
          );
        })
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName, 'pt-BR')),
    [clients, search],
  );
  const existingPets = profiles.filter(
    (profile) => profile.clientId === draft.clientId,
  );
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current) return;
    if (!editing && mode === 'existing' && !selectedClient) {
      setLocalError('Selecione o tutor já cadastrado.');
      return;
    }
    const values =
      !editing && selectedClient
        ? {
            ...draft,
            ownerName: selectedClient.ownerName,
            whatsapp: selectedClient.whatsapp,
            cpf: selectedClient.cpf,
          }
        : draft;
    const validation = validateRegistrationNames(values);
    if (validation.error) {
      setLocalError(registrationNameMessages[validation.error]);
      return;
    }
    lock.current = true;
    setBusy(true);
    setLocalError('');
    try {
      await onSave({
        ...values,
        ownerName: validation.ownerName,
        dogName: validation.dogName,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
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
            <Dog className="text-[#7353a6]" />
            {editing ? 'Editar cadastro' : 'Cadastrar cliente e pet'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Os dados do tutor são compartilhados por todos os pets dele.'
              : 'Salve a ficha e continue de onde parou. O cadastro não cria um agendamento.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!editing && (
            <fieldset className="flex gap-2">
              <legend className="sr-only">Tutor do pet</legend>
              {(['new', 'existing'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={mode === value ? 'default' : 'outline'}
                  aria-pressed={mode === value}
                  disabled={busy}
                  onClick={() => {
                    setMode(value);
                    setDraft({
                      ...draft,
                      clientId: '',
                      ownerName: '',
                      whatsapp: '',
                      cpf: '',
                    });
                    setLocalError('');
                  }}
                >
                  {value === 'new' ? 'Novo tutor' : 'Tutor já cadastrado'}
                </Button>
              ))}
            </fieldset>
          )}
          {!editing && mode === 'existing' ? (
            <div className="space-y-3 rounded-xl border border-[#ded5e7] bg-[#f7f4fa] p-3">
              {selectedClient ? (
                <>
                  <p className="font-bold">{selectedClient.ownerName}</p>
                  <p className="text-sm text-[#6c6374]">
                    {selectedClient.whatsapp || 'Sem WhatsApp cadastrado'}
                  </p>
                  <p className="text-xs text-[#6c6374]">
                    Pets:{' '}
                    {existingPets.map((p) => p.dogName).join(', ') ||
                      'Nenhum pet ainda'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, clientId: '' })}
                  >
                    Trocar tutor
                  </Button>
                </>
              ) : (
                <>
                  <label
                    htmlFor="profile-search"
                    className="block text-sm font-semibold"
                  >
                    <span className="mb-2 flex items-center gap-2">
                      <Search size={16} />
                      Buscar tutor
                    </span>
                    <Input
                      id="profile-search"
                      disabled={busy}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Nome, telefone ou CPF"
                    />
                  </label>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {matchingClients.slice(0, 20).map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, clientId: client.id })
                        }
                        className="block w-full rounded-lg bg-white px-3 py-2 text-left hover:bg-[#eee6f7]"
                      >
                        <strong className="block text-sm">
                          {client.ownerName}
                        </strong>
                        <span className="text-xs text-[#6c6374]">
                          {client.whatsapp || 'Sem WhatsApp'} ·{' '}
                          {profiles
                            .filter((p) => p.clientId === client.id)
                            .map((p) => p.dogName)
                            .join(', ') || 'Sem pets'}
                        </span>
                      </button>
                    ))}
                    {!matchingClients.length && (
                      <p className="py-3 text-sm text-[#6c6374]">
                        Nenhum tutor encontrado.
                      </p>
                    )}
                  </div>
                  {matchingClients.length > 20 && (
                    <p className="text-xs text-[#6c6374]">
                      Mostrando 20 de {matchingClients.length}. Digite mais para
                      refinar a busca.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor="profile-ownerName"
                className="block text-sm font-semibold"
              >
                Nome do tutor (obrigatório)
                <Input
                  id="profile-ownerName"
                  disabled={busy}
                  required
                  value={draft.ownerName}
                  onChange={(event) =>
                    setDraft({ ...draft, ownerName: event.target.value })
                  }
                  className="mt-1 bg-white"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="profile-whatsapp" className="block text-sm">
                  WhatsApp
                  <Input
                    id="profile-whatsapp"
                    disabled={busy}
                    type="tel"
                    value={draft.whatsapp}
                    onChange={(event) =>
                      setDraft({ ...draft, whatsapp: event.target.value })
                    }
                    className="mt-1 bg-white"
                  />
                </label>
                <label htmlFor="profile-cpf" className="block text-sm">
                  CPF (opcional)
                  <Input
                    id="profile-cpf"
                    disabled={busy}
                    inputMode="numeric"
                    value={draft.cpf}
                    onChange={(event) =>
                      setDraft({ ...draft, cpf: event.target.value })
                    }
                    className="mt-1 bg-white"
                  />
                </label>
              </div>
            </div>
          )}
          <label
            htmlFor="profile-dogName"
            className="block text-sm font-semibold"
          >
            Nome do pet (obrigatório)
            <Input
              id="profile-dogName"
              disabled={busy}
              required
              value={draft.dogName}
              onChange={(event) =>
                setDraft({ ...draft, dogName: event.target.value })
              }
              placeholder="Ex.: Yuri"
              className="mt-1 bg-white"
            />
          </label>
          <label className="block text-sm">
            Observações do pet
            <textarea
              disabled={busy}
              value={draft.notes}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
              rows={3}
              placeholder="Alergias, comportamento e cuidados especiais"
              className="mt-1 w-full rounded-lg border border-input bg-white p-3"
            />
          </label>
          {(localError || error) && (
            <p
              role="alert"
              className="rounded-lg bg-[#fff0e7] p-3 text-sm text-[#994821]"
            >
              {localError || error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Voltar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
              {busy ? 'Salvando...' : 'Salvar cadastro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
