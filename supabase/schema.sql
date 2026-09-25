-- HEIN PET SALON — estrutura inicial do Supabase
-- Execute este arquivo uma única vez no SQL Editor do projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  can_access boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email));
create index if not exists profiles_can_access_idx
  on public.profiles (can_access);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  customer_pet_name text not null default '',
  owner_name text not null default '',
  dog_name text not null default '',
  whatsapp text not null default '',
  cpf text not null default '',
  payment_method text not null default ''
    check (payment_method in ('', 'pix', 'cash', 'debit', 'credit')),
  payment_details jsonb,
  plan_type text not null check (plan_type in ('monthly', 'fortnightly', 'single')),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  paid boolean not null default false,
  scheduled_date date not null,
  scheduled_time time not null default '09:00',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'absent')),
  services jsonb not null default '[]'::jsonb,
  session_number integer not null default 1 check (session_number >= 1),
  total_sessions integer not null default 1 check (total_sessions >= 1),
  created_at timestamptz not null default now(),
  constraint appointments_session_unique unique (group_id, session_number)
);

create index if not exists appointments_scheduled_date_idx
  on public.appointments (scheduled_date, scheduled_time);
create index if not exists appointments_group_id_idx
  on public.appointments (group_id);
create index if not exists appointments_status_date_idx
  on public.appointments (status, scheduled_date);

create table if not exists public.payment_settings (
  id text primary key,
  credit_bps integer not null default 308 check (credit_bps between 0 and 9999),
  debit_bps integer not null default 87 check (debit_bps between 0 and 9999),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.payment_settings (id, credit_bps, debit_bps)
values ('stone', 308, 87)
on conflict (id) do nothing;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  actor_name text not null default '',
  action text not null,
  entity_type text not null,
  entity_id text not null default '',
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_user_id);

create table if not exists public.plan_renewals (
  id uuid primary key default gen_random_uuid(),
  original_group_id uuid not null unique,
  renewal_group_id uuid not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.payment_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.plan_renewals enable row level security;

-- Não há políticas para o navegador: todas as operações passam pelas rotas
-- protegidas do servidor. A service_role da Vercel ignora RLS.

-- Depois de criar o primeiro usuário em Authentication > Users, libere-o:
-- update public.profiles
-- set can_access = true, role = 'admin', name = 'Seu nome'
-- where lower(email) = lower('seu@email.com');
