-- Cadastro rápido de clientes e pets.
-- Execute este arquivo se o schema.sql já foi aplicado anteriormente.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null default '',
  whatsapp text not null default '',
  whatsapp_normalized text not null default '',
  cpf text not null default '',
  cpf_normalized text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_owner_name_idx on public.clients (lower(owner_name));
create index if not exists clients_whatsapp_idx on public.clients (whatsapp_normalized);
create index if not exists clients_cpf_idx on public.clients (cpf_normalized);

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null default '',
  favorite_services jsonb not null default '[]'::jsonb,
  last_time time,
  last_amount_cents integer check (last_amount_cents is null or last_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pets_client_id_idx on public.pets (client_id);
create index if not exists pets_name_idx on public.pets (lower(name));

alter table public.appointments
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists pet_id uuid references public.pets(id) on delete set null;

create index if not exists appointments_pet_id_idx on public.appointments (pet_id);

alter table public.clients enable row level security;
alter table public.pets enable row level security;
