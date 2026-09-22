create extension if not exists pgcrypto with schema extensions;

create type public.room_status as enum ('waiting', 'playing', 'finished', 'expired');
create type public.turn_phase as enum ('waiting_for_roll', 'waiting_for_choice');
create type public.pending_kind as enum ('card', 'management');
create type public.entrepreneurship_type as enum ('technology', 'social', 'traditional');
create type public.card_category as enum ('decision', 'opportunity', 'crisis', 'innovation');
create type public.board_stage as enum ('idea', 'validation', 'prototype', 'launch', 'growth', 'company');

create table public.cards (
  id text primary key,
  category public.card_category not null,
  title text not null check (char_length(title) > 0),
  scenario text not null check (char_length(scenario) > 0),
  learning text not null check (char_length(learning) > 0),
  tags text[] not null default '{}'
);

create table public.card_options (
  id text primary key,
  card_id text not null references public.cards(id) on delete cascade,
  label text not null check (char_length(label) > 0),
  is_default boolean not null default false,
  cost_capital integer not null default 0 check (cost_capital >= 0),
  cost_reputation integer not null default 0 check (cost_reputation >= 0),
  cost_innovation integer not null default 0 check (cost_innovation >= 0)
);

create table public.card_outcomes (
  id text primary key,
  option_id text not null references public.card_options(id) on delete cascade,
  label text not null check (char_length(label) > 0),
  probability smallint not null check (probability between 1 and 100),
  capital_delta integer not null default 0,
  reputation_delta integer not null default 0,
  innovation_delta integer not null default 0,
  explanation text not null check (char_length(explanation) > 0)
);

create table public.board_spaces (
  position smallint primary key check (position between 0 and 30),
  stage public.board_stage not null,
  category public.card_category,
  card_id text references public.cards(id),
  constraint board_card_pair check (
    (category is null and card_id is null)
    or (category is not null and card_id is not null)
  )
);

create table public.management_actions (
  id text primary key check (id in ('financing', 'product_improvement', 'brand_building')),
  label text not null check (char_length(label) > 0),
  cost_capital integer not null default 0 check (cost_capital >= 0),
  cost_reputation integer not null default 0 check (cost_reputation >= 0),
  cost_innovation integer not null default 0 check (cost_innovation >= 0),
  capital_delta integer not null default 0,
  reputation_delta integer not null default 0,
  innovation_delta integer not null default 0,
  explanation text not null check (char_length(explanation) > 0)
);

create table public.rooms (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete restrict,
  status public.room_status not null default 'waiting',
  phase public.turn_phase,
  current_player_id uuid,
  round smallint not null default 1 check (round between 1 and 12),
  version bigint not null default 0 check (version >= 0),
  pending_kind public.pending_kind,
  pending_card_id text references public.cards(id),
  deadline timestamptz,
  result jsonb,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_pending_state check (
    (pending_kind is null and pending_card_id is null)
    or (pending_kind = 'management' and pending_card_id is null)
    or (pending_kind = 'card' and pending_card_id is not null)
  ),
  constraint playing_room_has_active_turn check (
    status <> 'playing'
    or (phase is not null and current_player_id is not null)
  ),
  constraint room_expiry_after_creation check (expires_at > created_at)
);

create table public.players (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  identity_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    char_length(name) between 1 and 24
    and name = btrim(name)
  ),
  name_key text generated always as (lower(name)) stored,
  entrepreneurship_type public.entrepreneurship_type not null,
  turn_order smallint check (turn_order between 0 and 3),
  position smallint not null default 0 check (position between 0 and 30),
  capital integer not null default 5000 check (capital >= 0),
  reputation integer not null default 1 check (reputation >= 0),
  innovation integer not null default 1 check (innovation >= 0),
  joined_at timestamptz not null default now(),
  unique (room_id, identity_id),
  unique (room_id, name_key),
  unique (room_id, turn_order),
  unique (room_id, id)
);

alter table public.rooms
  add constraint rooms_current_player_fk
  foreign key (id, current_player_id)
  references public.players(room_id, id)
  deferrable initially deferred;

create table public.actions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  command text not null check (char_length(command) > 0),
  result jsonb not null,
  resulting_version bigint not null check (resulting_version >= 0),
  created_at timestamptz not null default now(),
  unique (actor_id, request_id)
);

create index players_room_order_idx on public.players(room_id, turn_order);
create index actions_room_created_idx on public.actions(room_id, created_at);
create index rooms_expiry_idx on public.rooms(expires_at) where status <> 'expired';

create function public.is_room_member(
  target_room_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players as player
    where player.room_id = target_room_id
      and player.identity_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.is_room_member(uuid) from anon;
grant execute on function public.is_room_member(uuid) to authenticated;

alter table public.cards enable row level security;
alter table public.card_options enable row level security;
alter table public.card_outcomes enable row level security;
alter table public.board_spaces enable row level security;
alter table public.management_actions enable row level security;
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.actions enable row level security;

create policy authenticated_can_read_cards
on public.cards for select to authenticated using (true);

create policy authenticated_can_read_card_options
on public.card_options for select to authenticated using (true);

create policy authenticated_can_read_card_outcomes
on public.card_outcomes for select to authenticated using (true);

create policy authenticated_can_read_board
on public.board_spaces for select to authenticated using (true);

create policy authenticated_can_read_management_actions
on public.management_actions for select to authenticated using (true);

create policy room_members_can_read_rooms
on public.rooms for select to authenticated
using (public.is_room_member(id));

create policy room_members_can_read_players
on public.players for select to authenticated
using (public.is_room_member(room_id));

create policy room_members_can_read_actions
on public.actions for select to authenticated
using (public.is_room_member(room_id));

revoke all on table public.cards, public.card_options, public.card_outcomes,
  public.board_spaces, public.management_actions, public.rooms, public.players,
  public.actions from anon;

revoke all on table public.cards, public.card_options, public.card_outcomes,
  public.board_spaces, public.management_actions, public.rooms, public.players,
  public.actions from authenticated;

grant select on table public.cards, public.card_options, public.card_outcomes,
  public.board_spaces, public.management_actions to authenticated;

grant select, insert, update, delete on table public.rooms, public.players,
  public.actions to authenticated;
