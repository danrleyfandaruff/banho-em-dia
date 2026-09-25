import type { Appointment, PetProfile, Status } from './agenda-types';

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function periodDays(date: string, view: 'day' | 'week' | 'month') {
  if (view === 'day') return [date];
  const parsed = new Date(`${date}T12:00:00`);
  const start =
    view === 'week'
      ? shiftDate(date, -((parsed.getDay() + 6) % 7))
      : `${date.slice(0, 7)}-01`;
  const length =
    view === 'week'
      ? 7
      : new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
  return Array.from({ length }, (_, index) => shiftDate(start, index));
}
export function movePeriod(
  date: string,
  view: 'day' | 'week' | 'month',
  direction: number,
) {
  if (view !== 'month')
    return shiftDate(date, direction * (view === 'week' ? 7 : 1));
  const parsed = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  parsed.setMonth(parsed.getMonth() + direction);
  return dateKey(parsed);
}
export function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export function matchesSearch(
  item: {
    dogName: string;
    ownerName: string;
    cpf: string;
    whatsapp: string;
    services?: string[];
  },
  search: string,
) {
  const query = normalize(search);
  const digits = search.replace(/\D/g, '');
  return (
    !query ||
    normalize(
      `${item.dogName} ${item.ownerName} ${item.cpf} ${item.whatsapp} ${(item.services ?? []).join(' ')}`,
    ).includes(query) ||
    Boolean(
      digits &&
      !/[a-z]/i.test(query) &&
      `${item.whatsapp}${item.cpf}`.replace(/\D/g, '').includes(digits),
    )
  );
}
export function filterAgenda(
  items: Appointment[],
  search: string,
  status: Status | 'all',
  unpaid: boolean,
) {
  return items
    .filter(
      (item) =>
        matchesSearch(item, search) &&
        (status === 'all' || item.status === status) &&
        (!unpaid || !item.paid),
    )
    .sort(
      (a, b) =>
        `${a.scheduledDate} ${a.scheduledTime}`.localeCompare(
          `${b.scheduledDate} ${b.scheduledTime}`,
        ) || a.dogName.localeCompare(b.dogName, 'pt-BR'),
    );
}
export function profileMatches(item: Appointment, profile: PetProfile) {
  if (profile.petId && item.petId) return profile.petId === item.petId;
  if (normalize(profile.dogName) !== normalize(item.dogName)) return false;
  return (
    !profile.ownerName ||
    normalize(profile.ownerName) === normalize(item.ownerName) ||
    Boolean(
      profile.whatsapp &&
      profile.whatsapp.replace(/\D/g, '') === item.whatsapp.replace(/\D/g, ''),
    )
  );
}
export function clientVisits(
  items: Appointment[],
  profile: PetProfile,
  today: string,
) {
  const history = items.filter((item) => profileMatches(item, profile));
  return {
    last: history
      .filter(
        (item) => item.status === 'completed' && item.scheduledDate <= today,
      )
      .sort(
        (a, b) =>
          b.scheduledDate.localeCompare(a.scheduledDate) ||
          b.scheduledTime.localeCompare(a.scheduledTime),
      )[0],
    next: history
      .filter(
        (item) => item.status === 'scheduled' && item.scheduledDate >= today,
      )
      .sort(
        (a, b) =>
          a.scheduledDate.localeCompare(b.scheduledDate) ||
          a.scheduledTime.localeCompare(b.scheduledTime),
      )[0],
  };
}
