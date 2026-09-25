-- Observações permanentes do pet.
-- Execute após a migração de cadastro rápido se ela já foi aplicada.

alter table if exists public.pets
  add column if not exists notes text not null default '';
