begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_type('public', 'room_status', 'room_status enum exists');
select has_type('public', 'turn_phase', 'turn_phase enum exists');
select has_type('public', 'pending_kind', 'pending_kind enum exists');
select has_type(
  'public',
  'entrepreneurship_type',
  'entrepreneurship_type enum exists'
);
select has_type('public', 'card_category', 'card_category enum exists');

select has_table('public', 'rooms', 'rooms table exists');
select has_table('public', 'players', 'players table exists');
select has_table('public', 'actions', 'actions table exists');
select has_function(
  'public',
  'is_room_member',
  array['uuid'],
  'membership policy helper exists'
);

select is((select count(*) from public.cards), 24::bigint, 'seed has 24 cards');
select results_eq(
  $$
    select category::text, count(*)::bigint
    from public.cards
    group by category
    order by category::text
  $$,
  $$ values
    ('crisis', 6::bigint),
    ('decision', 6::bigint),
    ('innovation', 6::bigint),
    ('opportunity', 6::bigint)
  $$,
  'seed has six cards per category'
);
select is(
  (select count(*) from public.board_spaces),
  31::bigint,
  'seed has all 31 board spaces'
);
select is(
  (select count(*) from public.management_actions),
  3::bigint,
  'seed has the three Empresa actions'
);
select is(
  (
    select count(*)
    from (
      select option_id
      from public.card_outcomes
      group by option_id
      having sum(probability) <> 100
    ) invalid_weights
  ),
  0::bigint,
  'every option outcome weight totals 100 percent'
);
select is(
  (
    select count(*)
    from (
      select c.id
      from public.cards c
      join public.card_options o on o.card_id = c.id
      group by c.id
      having count(*) filter (
        where o.is_default
          and o.cost_capital = 0
          and o.cost_reputation = 0
          and o.cost_innovation = 0
      ) <> 1
    ) invalid_defaults
  ),
  0::bigint,
  'every card has exactly one free default option'
);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array['rooms', 'players', 'actions'])
  ),
  'game-state tables have RLS enabled'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'member@example.test',
    '',
    now(),
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'outsider@example.test',
    '',
    now(),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.rooms (id, code, host_id) values
  (
    '30000000-0000-0000-0000-000000000003',
    'ABC234',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    'XYZ789',
    '20000000-0000-0000-0000-000000000002'
  );

insert into public.players (
  room_id,
  identity_id,
  name,
  entrepreneurship_type
) values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Ana',
  'technology'
);

select throws_ok(
  $$
    insert into public.rooms (code, host_id, status)
    values (
      'RUN234',
      '10000000-0000-0000-0000-000000000001',
      'playing'
    )
  $$,
  '23514',
  null,
  'a playing Room must identify its active Turno'
);

select throws_ok(
  $$
    insert into public.rooms (
      code,
      host_id,
      pending_kind,
      pending_card_id
    ) values (
      'MGT234',
      '10000000-0000-0000-0000-000000000001',
      'management',
      'decision-focus'
    )
  $$,
  '23514',
  null,
  'an Empresa interaction cannot retain a pending Tarjeta'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

select results_eq(
  $$ select code from public.rooms order by code $$,
  $$ values ('ABC234'::text) $$,
  'a member reads only their Room'
);

select throws_ok(
  $$
    insert into public.rooms (code, host_id)
    values ('NEW234', '10000000-0000-0000-0000-000000000001')
  $$,
  '42501',
  null,
  'authenticated clients cannot write game state directly'
);

select * from finish();
rollback;
