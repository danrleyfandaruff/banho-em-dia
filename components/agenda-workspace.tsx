'use client';

import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dog,
  LoaderCircle,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Appointment, PetProfile, Status } from '@/lib/agenda-types';
import {
  clientVisits,
  dateKey,
  filterAgenda,
  matchesSearch,
  movePeriod,
  periodDays,
} from '@/lib/agenda-view';

type Props = {
  appointments: Appointment[];
  profiles: PetProfile[];
  loading: boolean;
  renderAppointment: (item: Appointment) => ReactNode;
  renderDayActions: (date: string, items: Appointment[]) => ReactNode;
  onNew: (date: string) => void;
  onOpenProfile: (profile: PetProfile) => void;
  onScheduleProfile: (profile: PetProfile) => void;
  onViewChange: () => void;
  draggingId: string | null;
  dropTarget: string | null;
  onDragOver: (event: DragEvent<HTMLElement>, date: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, date: string) => void;
};
const shortDate = (date: string) => date.split('-').reverse().join('/');
const fullDate = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
const filters: [Status | 'all', string][] = [
  ['all', 'Todos'],
  ['scheduled', 'Em aberto'],
  ['completed', 'Concluídos'],
  ['absent', 'Faltaram'],
];
const pageSize = 20;

export function AgendaWorkspace(props: Props) {
  const {
    appointments,
    profiles,
    loading,
    renderAppointment,
    renderDayActions,
    onNew,
    onOpenProfile,
    onScheduleProfile,
    onViewChange,
  } = props;
  const [section, setSection] = useState<'agenda' | 'clients'>('agenda');
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [date, setDate] = useState(dateKey);
  const [search, setSearch] = useState('');
  const [allDates, setAllDates] = useState(false);
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [unpaid, setUnpaid] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSort, setClientSort] = useState('pet');
  const [clientPage, setClientPage] = useState(1);
  const today = dateKey();
  const days = useMemo(() => periodDays(date, view), [date, view]);
  const searchingAllDates = allDates && Boolean(search.trim());
  const periodItems = useMemo(
    () =>
      appointments.filter(
        (item) =>
          searchingAllDates ||
          (item.scheduledDate >= days[0] &&
            item.scheduledDate <= days[days.length - 1]),
      ),
    [appointments, days, searchingAllDates],
  );
  const searchedItems = useMemo(
    () => filterAgenda(periodItems, search, 'all', unpaid),
    [periodItems, search, unpaid],
  );
  const visibleItems = useMemo(
    () => filterAgenda(periodItems, search, status, unpaid),
    [periodItems, search, status, unpaid],
  );
  const byDay = useMemo(() => {
    const result = new Map<string, Appointment[]>();
    for (const item of visibleItems) {
      const day = result.get(item.scheduledDate) ?? [];
      day.push(item);
      result.set(item.scheduledDate, day);
    }
    return result;
  }, [visibleItems]);
  const visibleDays = searchingAllDates ? [...byDay.keys()] : days;
  const clientRows = useMemo(() => {
    // Index modern records once; legacy records without petId keep the fallback match.
    const byPet = new Map<string, Appointment[]>();
    const legacy: Appointment[] = [];
    for (const item of appointments) {
      if (item.petId) {
        const history = byPet.get(item.petId) ?? [];
        history.push(item);
        byPet.set(item.petId, history);
      } else legacy.push(item);
    }
    return profiles
      .filter((profile) => matchesSearch(profile, clientSearch))
      .map((profile) => ({
        profile,
        ...clientVisits(
          profile.petId
            ? [...(byPet.get(profile.petId) ?? []), ...legacy]
            : appointments,
          profile,
          today,
        ),
      }))
      .sort((a, b) => {
        const name = a.profile.dogName.localeCompare(
          b.profile.dogName,
          'pt-BR',
        );
        if (clientSort === 'owner')
          return (
            a.profile.ownerName.localeCompare(b.profile.ownerName, 'pt-BR') ||
            name
          );
        if (clientSort === 'last')
          return (
            (b.last?.scheduledDate ?? '').localeCompare(
              a.last?.scheduledDate ?? '',
            ) || name
          );
        if (clientSort === 'next')
          return (
            (a.next?.scheduledDate ?? '9999').localeCompare(
              b.next?.scheduledDate ?? '9999',
            ) || name
          );
        return name;
      });
  }, [appointments, profiles, clientSearch, clientSort, today]);
  const pages = Math.max(1, Math.ceil(clientRows.length / pageSize));
  const currentPage = Math.min(clientPage, pages);
  const pagedClients = clientRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const counts = (filter: Status | 'all') =>
    filter === 'all'
      ? searchedItems.length
      : searchedItems.filter((item) => item.status === filter).length;
  const changeDate = (next: string) => {
    if (next) {
      setDate(next);
      onViewChange();
    }
  };
  const heading =
    view === 'day'
      ? fullDate(date)
      : view === 'week'
        ? `${shortDate(days[0])} – ${shortDate(days[6])}`
        : new Intl.DateTimeFormat('pt-BR', {
            month: 'long',
            year: 'numeric',
          }).format(new Date(`${date}T12:00:00`));
  const toolbarClass =
    'sticky top-0 z-20 -mx-3 border-b border-[#e5e1e9] bg-[#f7f7f9]/95 px-3 py-3 backdrop-blur sm:mx-0 sm:px-0';
  const visit = (item: Appointment | undefined) =>
    item ? (
      <>
        <time dateTime={item.scheduledDate}>
          {shortDate(item.scheduledDate)}
        </time>
        <span className="ml-1 text-xs text-[#726a7c]">
          {item.scheduledTime}
        </span>
      </>
    ) : (
      <span className="text-[#726a7c]">—</span>
    );

  return (
    <section className="min-w-0">
      <nav
        aria-label="Área de trabalho"
        className="mb-4 flex gap-1 border-b border-[#e5e1e9]"
      >
        {(
          [
            ['agenda', 'Agenda', CalendarDays],
            ['clients', 'Clientes e pets', Users],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-current={section === key ? 'page' : undefined}
            onClick={() => {
              setSection(key);
              onViewChange();
            }}
            className={`flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-bold ${section === key ? 'border-[#7353a6] text-[#694594]' : 'border-transparent text-[#6c6374] hover:text-[#302638]'}`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      {section === 'agenda' ? (
        <>
          <div className={toolbarClass}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <fieldset className="flex rounded-xl border border-[#ddd7e4] bg-white p-1">
                <legend className="sr-only">Visualização da agenda</legend>
                {(
                  [
                    ['day', 'Dia'],
                    ['week', 'Semana'],
                    ['month', 'Mês'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => {
                      setView(key);
                      onViewChange();
                    }}
                    className={`min-h-9 rounded-lg px-3 text-sm font-bold ${view === key ? 'bg-[#7353a6] text-white' : 'text-[#655b70] hover:bg-[#f4f1f7]'}`}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Período anterior"
                  onClick={() => changeDate(movePeriod(date, view, -1))}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    changeDate(today);
                    setAllDates(false);
                  }}
                >
                  Hoje
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Próximo período"
                  onClick={() => changeDate(movePeriod(date, view, 1))}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold capitalize tracking-tight">
                {searchingAllDates ? 'Pesquisa em toda a agenda' : heading}
              </h2>
              <Input
                type="date"
                aria-label="Ir para data"
                value={date}
                onChange={(event) => changeDate(event.target.value)}
                className="h-9 w-auto min-w-0 max-w-full bg-white"
              />
            </div>
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#726a7c]"
              />
              <Input
                type="search"
                aria-label="Buscar na agenda"
                placeholder="Pet, tutor, telefone, CPF ou serviço"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  onViewChange();
                }}
                className="h-11 bg-white pl-10 pr-16"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setAllDates(false);
                    onViewChange();
                  }}
                  className="absolute inset-y-0 right-2 text-xs font-bold text-[#694594]"
                >
                  Limpar
                </button>
              )}
            </div>
            {search.trim() && (
              <label className="mt-2 flex min-h-8 items-center gap-2 text-sm text-[#62576c]">
                <input
                  type="checkbox"
                  checked={allDates}
                  onChange={(event) => {
                    setAllDates(event.target.checked);
                    onViewChange();
                  }}
                  className="size-4 accent-[#7353a6]"
                />{' '}
                Buscar em todas as datas
              </label>
            )}
            <fieldset className="mt-3 flex flex-wrap items-center gap-2">
              <legend className="sr-only">Filtros de situação</legend>
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={status === key}
                  onClick={() => {
                    setStatus(key);
                    onViewChange();
                  }}
                  className={`min-h-9 rounded-full border px-3 text-sm ${status === key ? 'border-[#7353a6] bg-[#eee8f5] font-bold text-[#603d88]' : 'border-[#ddd7e4] bg-white text-[#655b70]'}`}
                >
                  {label}{' '}
                  <span className="ml-1 tabular-nums">{counts(key)}</span>
                </button>
              ))}
              <label className="flex min-h-9 items-center gap-2 px-1 text-sm text-[#655b70]">
                <input
                  type="checkbox"
                  checked={unpaid}
                  onChange={(event) => {
                    setUnpaid(event.target.checked);
                    onViewChange();
                  }}
                  className="size-4 accent-[#7353a6]"
                />
                Pagamento pendente
              </label>
            </fieldset>
          </div>
          {loading ? (
            <Loading />
          ) : (
            <>
              <p className="my-3 text-xs text-[#6c6374]" aria-live="polite">
                {visibleItems.length} atendimento(s)
                {status !== 'all' || unpaid || search
                  ? ' com os filtros atuais'
                  : ' no período'}{' '}
                · Datas dos planos: ✓ concluída · × faltou · sem marca: em
                aberto
              </p>
              {view === 'month' && !searchingAllDates ? (
                <div className="overflow-hidden rounded-2xl border border-[#ded8e6] bg-white">
                  <div className="grid grid-cols-7 border-b border-[#eeeaf2] bg-[#f5f3f8]">
                    {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(
                      (day) => (
                        <span
                          key={day}
                          className="py-3 text-center text-xs font-bold text-[#665c70]"
                        >
                          {day}
                        </span>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-7 gap-px bg-[#e8e4ed]">
                    {Array.from(
                      {
                        length:
                          (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7,
                      },
                      (_, index) => (
                        <div key={`blank-${index}`} className="bg-[#faf9fb]" />
                      ),
                    )}
                    {days.map((day) => {
                      const items = byDay.get(day) ?? [];
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            changeDate(day);
                            setView('day');
                          }}
                          onDragOver={(event) => props.onDragOver(event, day)}
                          onDrop={(event) => props.onDrop(event, day)}
                          aria-label={`${fullDate(day)}, ${items.length} atendimentos. Abrir dia.`}
                          aria-current={day === today ? 'date' : undefined}
                          className={`flex min-h-24 min-w-0 flex-col items-center gap-2 px-1 py-3 text-sm transition hover:bg-[#f1eaf8] sm:min-h-28 sm:items-start sm:px-3 ${props.dropTarget === day && props.draggingId ? 'bg-[#e9def7]' : 'bg-white'}`}
                        >
                          <span
                            className={`grid size-7 place-items-center rounded-full font-bold ${day === today ? 'bg-[#7353a6] text-white' : 'text-[#4a3d57]'}`}
                          >
                            {Number(day.slice(-2))}
                          </span>
                          {items.length > 0 ? (
                            <span className="rounded bg-[#f0ecf5] px-1.5 py-1 text-xs font-semibold text-[#674789]">
                              <span>{items.length}</span>
                              <span className="hidden sm:inline"> atend.</span>
                            </span>
                          ) : (
                            <span className="text-xs text-[#8a8192]">—</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleDays.length === 0 && (
                    <div className="rounded-xl border border-dashed border-[#d3c9df] bg-white p-8 text-center text-sm text-[#6c6374]">
                      Nenhum atendimento encontrado. Ajuste a busca ou os
                      filtros.
                    </div>
                  )}
                  {visibleDays.map((day) => {
                    const items = byDay.get(day) ?? [];
                    return (
                      // Drop targets also have keyboard-accessible rescheduling in each record's menu.
                      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                      <article
                        key={day}
                        onDragOver={(event) => props.onDragOver(event, day)}
                        onDrop={(event) => props.onDrop(event, day)}
                        className={`rounded-2xl border bg-white ${props.draggingId && props.dropTarget === day ? 'border-[#7353a6] ring-2 ring-[#7353a6]/20' : 'border-[#e1dbe8]'}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eeeaf2] px-4 py-3">
                          <h3 className="text-sm font-bold capitalize">
                            {day === today ? 'Hoje · ' : ''}
                            {fullDate(day)}{' '}
                            <span className="ml-1 text-[#756a81]">
                              ({items.length})
                            </span>
                          </h3>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onNew(day)}
                            className="text-[#694594]"
                          >
                            <Plus />
                            Agendar
                          </Button>
                        </div>
                        {renderDayActions(day, items)}
                        {items.length ? (
                          <div className="divide-y divide-[#eeeaf2]">
                            {items.map((item) => renderAppointment(item))}
                          </div>
                        ) : (
                          <div className="px-4 py-6 text-sm text-[#71667b]">
                            {status !== 'all' || unpaid || search
                              ? 'Nenhum atendimento com estes filtros.'
                              : 'Nenhum atendimento agendado.'}
                            {props.draggingId &&
                              ' Solte aqui para mover para este dia.'}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className={toolbarClass}>
            <h2 className="mb-3 text-xl font-extrabold">
              Clientes e pets{' '}
              <span className="ml-1 text-sm font-medium text-[#756a81]">
                {profiles.length}
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-48 flex-1">
                <Search
                  size={18}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#726a7c]"
                />
                <Input
                  aria-label="Buscar clientes e pets"
                  type="search"
                  value={clientSearch}
                  onChange={(event) => {
                    setClientSearch(event.target.value);
                    setClientPage(1);
                  }}
                  placeholder="Pet, tutor, telefone ou CPF"
                  className="h-11 bg-white pl-10"
                />
              </div>
              <select
                aria-label="Ordenar clientes"
                value={clientSort}
                onChange={(event) => {
                  setClientSort(event.target.value);
                  setClientPage(1);
                }}
                className="h-11 max-w-full rounded-lg border border-[#ddd7e4] bg-white px-3 text-sm"
              >
                <option value="pet">Pet: A–Z</option>
                <option value="owner">Tutor: A–Z</option>
                <option value="last">Último atendimento</option>
                <option value="next">Próximo atendimento</option>
              </select>
            </div>
          </div>
          {loading ? (
            <Loading />
          ) : (
            <>
              <p className="my-3 text-sm text-[#71667b]" aria-live="polite">
                {clientRows.length} pet(s) encontrado(s)
              </p>
              {!clientRows.length ? (
                <div className="rounded-2xl border border-dashed border-[#d3c9df] bg-white p-8 text-center">
                  <Dog className="mx-auto mb-3 text-[#7353a6]" />
                  <p className="text-sm text-[#71667b]">
                    {clientSearch
                      ? 'Nenhum pet encontrado. Tente outro nome ou telefone.'
                      : 'Os clientes cadastrados nos agendamentos aparecem aqui.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="hidden overflow-hidden rounded-2xl border border-[#e1dbe8] bg-white md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#f2eff6] text-xs text-[#655b70]">
                        <tr>
                          <th scope="col" className="px-3 py-3">
                            Pet
                          </th>
                          <th scope="col" className="px-3 py-3">
                            Tutor
                          </th>
                          <th scope="col" className="px-3 py-3">
                            Último atendimento
                          </th>
                          <th scope="col" className="px-3 py-3">
                            Próximo atendimento
                          </th>
                          <th scope="col" className="px-3 py-3">
                            <span className="sr-only">Ações</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eeeaf2]">
                        {pagedClients.map(({ profile, last, next }) => (
                          <tr key={profile.key} className="hover:bg-[#faf8fc]">
                            <td className="max-w-44 px-3 py-3">
                              <button
                                type="button"
                                onClick={() => onOpenProfile(profile)}
                                className="break-words text-left font-bold text-[#694594] hover:underline"
                              >
                                {profile.dogName || 'Pet sem nome'}
                              </button>
                            </td>
                            <td className="max-w-44 break-words px-3 py-3">
                              {profile.ownerName || 'Não informado'}
                            </td>
                            <td className="px-3 py-3">{visit(last)}</td>
                            <td className="px-3 py-3">{visit(next)}</td>
                            <td className="px-3 py-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onScheduleProfile(profile)}
                                aria-label={`Agendar ${profile.dogName}`}
                              >
                                <Plus />
                                Agendar
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-3 md:hidden">
                    {pagedClients.map(({ profile, last, next }) => (
                      <article
                        key={profile.key}
                        className="rounded-xl border border-[#e1dbe8] bg-white p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenProfile(profile)}
                              className="break-words text-left font-bold text-[#694594]"
                            >
                              {profile.dogName || 'Pet sem nome'}
                            </button>
                            <p className="mt-1 break-words text-sm text-[#71667b]">
                              {profile.ownerName || 'Tutor não informado'}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onScheduleProfile(profile)}
                            aria-label={`Agendar ${profile.dogName}`}
                          >
                            <Plus />
                            Agendar
                          </Button>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[#eeeaf2] pt-3 text-sm">
                          <div>
                            <dt className="mb-1 text-xs text-[#71667b]">
                              Último atendimento
                            </dt>
                            <dd>{visit(last)}</dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-xs text-[#71667b]">
                              Próximo atendimento
                            </dt>
                            <dd>{visit(next)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[#71667b]">
                    <p>
                      {(currentPage - 1) * pageSize + 1}–
                      {Math.min(currentPage * pageSize, clientRows.length)} de{' '}
                      {clientRows.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Página anterior de clientes"
                        disabled={currentPage === 1}
                        onClick={() => setClientPage(currentPage - 1)}
                      >
                        <ChevronLeft />
                      </Button>
                      <span>
                        Página {currentPage} de {pages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Próxima página de clientes"
                        disabled={currentPage === pages}
                        onClick={() => setClientPage(currentPage + 1)}
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function Loading() {
  return (
    <output className="block rounded-xl border border-[#e1dbe8] bg-white p-10 text-center text-sm text-[#71667b]">
      <LoaderCircle className="mx-auto mb-2 animate-spin text-[#7353a6]" />
      Carregando...
    </output>
  );
}
