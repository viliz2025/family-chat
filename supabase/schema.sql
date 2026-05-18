create extension if not exists pgcrypto;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz null,
  last_read_at timestamptz null
);

alter table public.members
  add column if not exists last_seen_at timestamptz null,
  add column if not exists last_read_at timestamptz null,
  add column if not exists pin_hash text null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null default 'text' check (type in ('text', 'system', 'image')),
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  deleted_at timestamptz null,
  deleted_by uuid null references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists type text not null default 'text';

alter table public.messages
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references public.members(id) on delete set null;

do $$
begin
  alter table public.messages
    drop constraint if exists messages_type_check;

  alter table public.messages
    add constraint messages_type_check check (type in ('text', 'system', 'image'));
exception
  when duplicate_object then null;
end;
$$;

create index if not exists members_chat_id_idx on public.members(chat_id);
create index if not exists messages_chat_created_at_idx on public.messages(chat_id, created_at desc);
create index if not exists messages_created_at_idx on public.messages(created_at);

alter table public.chats enable row level security;
alter table public.members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "No direct chat reads" on public.chats;
create policy "No direct chat reads"
  on public.chats for select
  to anon
  using (false);

drop policy if exists "Realtime can resolve member names" on public.members;
create policy "Realtime can resolve member names"
  on public.members for select
  to anon
  using (true);

drop policy if exists "Realtime can receive messages" on public.messages;
create policy "Realtime can receive messages"
  on public.messages for select
  to anon
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

create or replace function public.cleanup_family_chat_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.messages
  where created_at < now() - interval '15 days';

  delete from public.messages m
  using (
    select id
    from (
      select
        id,
        row_number() over (partition by chat_id order by created_at desc) as rn
      from public.messages
    ) ranked
    where ranked.rn > 1000
  ) old_messages
  where m.id = old_messages.id;
end;
$$;

revoke all on function public.cleanup_family_chat_messages() from public;
grant execute on function public.cleanup_family_chat_messages() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-chat-photos',
  'family-chat-photos',
  false,
  20971520,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
