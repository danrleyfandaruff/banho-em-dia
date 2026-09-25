import { Check, X } from 'lucide-react';
import type { Appointment } from '@/lib/agenda-types';

export function PlanSessionDates({
  sessions,
  currentId,
  onOpen,
}: {
  sessions: Appointment[];
  currentId: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7353a6]"
      aria-label={`Sessões do plano: ${sessions.map((session) => `${session.scheduledDate.split('-').reverse().join('/')} ${session.status === 'completed' ? 'concluída' : session.status === 'absent' ? 'faltou' : 'em aberto'}`).join('; ')}. Abrir detalhes.`}
    >
      {sessions.map((session) => (
        <span
          key={session.id}
          title={`${session.scheduledDate.split('-').reverse().join('/')} · ${session.status === 'completed' ? 'Concluída' : session.status === 'absent' ? 'Faltou' : 'Em aberto'}`}
          aria-label={`${session.scheduledDate.split('-').reverse().join('/')} · ${session.status === 'completed' ? 'Concluída' : session.status === 'absent' ? 'Faltou' : 'Em aberto'}`}
          className={`inline-flex items-center gap-0.5 ${session.status === 'completed' ? 'text-[#24734f]' : session.status === 'absent' ? 'text-[#9b4d2a]' : 'text-[#6c6374]'} ${session.id === currentId ? 'font-bold underline decoration-[#d1c3df] underline-offset-4' : ''}`}
        >
          {session.status === 'completed' && (
            <Check size={12} aria-hidden="true" />
          )}
          {session.status === 'absent' && <X size={12} aria-hidden="true" />}
          <time dateTime={session.scheduledDate}>
            {session.scheduledDate.slice(8, 10)}/
            {session.scheduledDate.slice(5, 7)}
          </time>
        </span>
      ))}
    </button>
  );
}
