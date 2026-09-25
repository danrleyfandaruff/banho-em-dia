import { createSupabaseAdmin } from '@/lib/supabase';
import { validateRegistrationNames } from '@/lib/registration-validation';
import type {
  Appointment,
  ClientProfile,
  PetProfile,
} from '@/lib/agenda-types';

type ClientRow = {
  id: string;
  owner_name: string;
  whatsapp: string;
  cpf: string;
};
type PetRow = {
  id: string;
  client_id: string;
  name: string;
  notes: string;
  favorite_services: string[];
  last_time: string | null;
  last_amount_cents: number | null;
};
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const digits = (value: string) => value.replace(/\D/g, '');
const phone = (value: string) => {
  const number = digits(value);
  return number.startsWith('55') && [12, 13].includes(number.length)
    ? number.slice(2)
    : number;
};
export class RegistryError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
function mapProfile(pet: PetRow, client: ClientRow): PetProfile {
  return {
    key: pet.id,
    clientId: client.id,
    petId: pet.id,
    ownerName: client.owner_name,
    dogName: pet.name,
    whatsapp: client.whatsapp,
    cpf: client.cpf,
    notes: pet.notes || '',
    favoriteServices: Array.isArray(pet.favorite_services)
      ? pet.favorite_services
      : [],
    lastTime: pet.last_time?.slice(0, 5) ?? '09:00',
    lastAmountCents: pet.last_amount_cents,
  };
}
async function allRows<T>(
  table: 'clients' | 'pets',
  columns: string,
): Promise<T[]> {
  const admin = createSupabaseAdmin();
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await admin
      .from(table)
      .select(columns)
      .order('id')
      .range(offset, offset + 999)
      .overrideTypes<T[], { merge: false }>();
    check(result.error);
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return rows;
  }
}
export async function listRegistry() {
  const [clients, pets] = await Promise.all([
    allRows<ClientRow>('clients', 'id,owner_name,whatsapp,cpf'),
    allRows<PetRow>(
      'pets',
      'id,client_id,name,notes,favorite_services,last_time,last_amount_cents',
    ),
  ]);
  const byClient = new Map(clients.map((client) => [client.id, client]));
  return {
    clients: clients.map(
      (client): ClientProfile => ({
        id: client.id,
        ownerName: client.owner_name,
        whatsapp: client.whatsapp,
        cpf: client.cpf,
      }),
    ),
    petProfiles: pets.flatMap((pet) => {
      const client = byClient.get(pet.client_id);
      return client ? [mapProfile(pet, client)] : [];
    }),
  };
}
export async function getRegisteredPet(petId: unknown, clientId?: unknown) {
  if (!text(petId)) throw new RegistryError('pet_selection_required');
  const admin = createSupabaseAdmin();
  const petResult = await admin
    .from('pets')
    .select('*')
    .eq('id', text(petId))
    .maybeSingle<PetRow>();
  check(petResult.error);
  const pet = petResult.data;
  if (!pet) throw new RegistryError('pet_not_found', 404);
  if (text(clientId) && text(clientId) !== pet.client_id)
    throw new RegistryError('pet_client_mismatch', 409);
  const clientResult = await admin
    .from('clients')
    .select('id,owner_name,whatsapp,cpf')
    .eq('id', pet.client_id)
    .maybeSingle<ClientRow>();
  check(clientResult.error);
  if (!clientResult.data) throw new RegistryError('client_not_found', 404);
  const profile = mapProfile(pet, clientResult.data);
  const names = validateRegistrationNames(profile);
  if (names.error) throw new RegistryError(names.error);
  return profile;
}
export function currentAppointmentProfiles(
  items: Appointment[],
  profiles: PetProfile[],
) {
  const byPet = new Map(profiles.map((profile) => [profile.petId, profile]));
  return items.map((item) => {
    const profile = item.petId ? byPet.get(item.petId) : undefined;
    return profile && profile.clientId === item.clientId
      ? {
          ...item,
          ownerName: profile.ownerName,
          dogName: profile.dogName,
          whatsapp: profile.whatsapp,
          cpf: profile.cpf,
          customerPetName: `${profile.ownerName} + ${profile.dogName}`,
        }
      : item;
  });
}
export async function savePetRegistration(body: Record<string, unknown>) {
  const admin = createSupabaseAdmin();
  const edit = body.action === 'profile_edit';
  let clientId = text(body.clientId);
  let petId = text(body.petId);
  if (edit) {
    // Resolve the relationship directly so incomplete legacy names can be corrected.
    const result = await admin
      .from('pets')
      .select('id,client_id')
      .eq('id', petId)
      .maybeSingle<{ id: string; client_id: string }>();
    check(result.error);
    if (!result.data) throw new RegistryError('pet_not_found', 404);
    if (clientId && clientId !== result.data.client_id)
      throw new RegistryError('pet_client_mismatch', 409);
    clientId = result.data.client_id;
  } else if (petId) throw new RegistryError('invalid_profile_action');
  let ownerName = text(body.ownerName);
  let whatsapp = text(body.whatsapp);
  let cpf = text(body.cpf);
  const dogName = text(body.dogName);
  const notes = text(body.notes);
  const registry = await listRegistry();
  if (clientId) {
    const client = registry.clients.find((item) => item.id === clientId);
    if (!client) throw new RegistryError('client_not_found', 404);
    if (!edit) {
      ownerName = client.ownerName;
      whatsapp = client.whatsapp;
      cpf = client.cpf;
    }
  }
  const names = validateRegistrationNames({ ownerName, dogName });
  if (names.error) throw new RegistryError(names.error);
  if (
    registry.clients.some(
      (client) =>
        client.id !== clientId &&
        ((phone(whatsapp) && phone(client.whatsapp) === phone(whatsapp)) ||
          (digits(cpf) && digits(client.cpf) === digits(cpf))),
    )
  ) {
    throw new RegistryError('client_exists', 409);
  }
  if (
    clientId &&
    registry.petProfiles.some(
      (profile) =>
        profile.clientId === clientId &&
        profile.petId !== petId &&
        normalize(profile.dogName) === normalize(dogName),
    )
  ) {
    throw new RegistryError('pet_exists', 409);
  }
  // An explicit legacy record may be linked when completing its registration.
  const appointmentId = text(body.sourceAppointmentId);
  let legacyGroupId: string | null = null;
  if (appointmentId) {
    const result = await admin
      .from('appointments')
      .select('group_id,pet_id')
      .eq('id', appointmentId)
      .maybeSingle<{ group_id: string; pet_id: string | null }>();
    check(result.error);
    if (!result.data || result.data.pet_id)
      throw new RegistryError('legacy_already_linked', 409);
    legacyGroupId = result.data.group_id;
  }
  const updatedAt = new Date().toISOString();
  const clientValues = {
    owner_name: names.ownerName,
    whatsapp,
    whatsapp_normalized: digits(whatsapp),
    cpf,
    cpf_normalized: digits(cpf),
    updated_at: updatedAt,
  };
  if (!clientId) {
    clientId = crypto.randomUUID();
    const result = await admin
      .from('clients')
      .insert({ id: clientId, ...clientValues });
    check(result.error);
  } else if (edit) {
    const result = await admin
      .from('clients')
      .update(clientValues)
      .eq('id', clientId);
    check(result.error);
  }
  const petValues = { name: names.dogName, notes, updated_at: updatedAt };
  if (edit) {
    const result = await admin
      .from('pets')
      .update(petValues)
      .eq('id', petId)
      .eq('client_id', clientId);
    check(result.error);
  } else {
    petId = crypto.randomUUID();
    const result = await admin
      .from('pets')
      .insert({ id: petId, client_id: clientId, ...petValues });
    check(result.error);
  }
  if (legacyGroupId) {
    const result = await admin
      .from('appointments')
      .update({
        client_id: clientId,
        pet_id: petId,
        owner_name: names.ownerName,
        dog_name: names.dogName,
        customer_pet_name: `${names.ownerName} + ${names.dogName}`,
        whatsapp,
        cpf,
      })
      .eq('group_id', legacyGroupId)
      .is('pet_id', null);
    check(result.error);
  }
  return { petId, clientId };
}
