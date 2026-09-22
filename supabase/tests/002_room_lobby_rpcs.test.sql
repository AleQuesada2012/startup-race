begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(19);

create temporary table room_lobby_test_context (
  key text primary key,
  value jsonb not null
);

grant select, insert, update on room_lobby_test_context to authenticated;

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
    '11000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'host@example.test',
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
    '22000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'guest@example.test',
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
    '33000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'third@example.test',
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
    '44000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'fourth@example.test',
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
    '55000000-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'fifth@example.test',
    '',
    now(),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

select ok(
  (
    with created as (
      select public.create_room(
        'Ana',
        'technology',
        '11000000-0000-0000-0000-000000000011'
      ) as state
    )
    select
      state #>> '{room,code}' ~ '^[A-HJ-NP-Z2-9]{6}$'
      and state #>> '{room,status}' = 'waiting'
      and jsonb_array_length(state -> 'players') = 1
      and state #>> '{players,0,name}' = 'Ana'
      and (state #>> '{players,0,capital}')::integer = 5000
      and (state #>> '{players,0,reputation}')::integer = 1
      and (state #>> '{players,0,innovation}')::integer = 2
    from created
  ),
  'a Jugador creates a waiting Sala with a valid code and type bonus'
);

select ok(
  (
    with created as (
      select public.create_room(
        'Host',
        'traditional',
        '11000000-0000-0000-0000-000000000012'
      ) as state
    ),
    guest_identity as (
      select set_config(
        'request.jwt.claim.sub',
        '22000000-0000-0000-0000-000000000002',
        true
      )
    ),
    joined as (
      select public.join_room(
        lower(created.state #>> '{room,code}'),
        ' Luis ',
        'social',
        '22000000-0000-0000-0000-000000000022'
      ) as state
      from created
      cross join guest_identity
    )
    select
      state #>> '{room,status}' = 'waiting'
      and jsonb_array_length(state -> 'players') = 2
      and state #>> '{players,1,name}' = 'Luis'
      and (state #>> '{players,1,reputation}')::integer = 2
      and (state #>> '{players,1,innovation}')::integer = 1
    from joined
  ),
  'a second Jugador joins a Sala through its case-insensitive code'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
select
  'member_read_room',
  public.create_room(
    'Marta',
    'technology',
    '11000000-0000-0000-0000-000000000013'
  );

select ok(
  (
    select
      fetched.state #>> '{room,id}' = created.value #>> '{room,id}'
      and (fetched.state #>> '{players,0,is_self}')::boolean
    from room_lobby_test_context as created
    cross join lateral (
      select public.get_room_state(
        lower(created.value #>> '{room,code}')
      ) as state
    ) as fetched
    where created.key = 'member_read_room'
  ),
  'a member reads their Sala state through the public RPC'
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.get_room_state(value #>> '{room,code}')
    from room_lobby_test_context
    where key = 'member_read_room'
  $$,
  'P0001',
  'not_room_member',
  'a non-member cannot read a Sala through the public RPC'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

select is(
  public.create_room(
    'Marta',
    'technology',
    '11000000-0000-0000-0000-000000000013'
  ),
  (
    select value
    from room_lobby_test_context
    where key = 'member_read_room'
  ),
  'create_room replays the recorded response for a duplicate request ID'
);

select throws_ok(
  $$
    select public.join_room(
      'AAAAAA',
      'Marta',
      'technology',
      '11000000-0000-0000-0000-000000000013'
    )
  $$,
  'P0001',
  'request_id_conflict',
  'join_room rejects a request ID already used for another command'
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

insert into room_lobby_test_context (key, value)
select
  'idempotent_join',
  public.join_room(
    host_room.value #>> '{room,code}',
    'Diego',
    'social',
    '22000000-0000-0000-0000-000000000023'
  )
from room_lobby_test_context as host_room
where host_room.key = 'member_read_room';

select is(
  public.join_room(
    (
      select value #>> '{room,code}'
      from room_lobby_test_context
      where key = 'member_read_room'
    ),
    'Diego',
    'social',
    '22000000-0000-0000-0000-000000000023'
  ),
  (
    select value
    from room_lobby_test_context
    where key = 'idempotent_join'
  ),
  'join_room replays the recorded response for a duplicate request ID'
);

select throws_ok(
  $$
    select public.create_room(
      'Diego',
      'social',
      '22000000-0000-0000-0000-000000000023'
    )
  $$,
  'P0001',
  'request_id_conflict',
  'create_room rejects a request ID already used for another command'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
values (
  'duplicate_name_room',
  public.create_room(
    'Casey',
    'traditional',
    '11000000-0000-0000-0000-000000000014'
  )
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.join_room(
      value #>> '{room,code}',
      'cAsEy',
      'social',
      '22000000-0000-0000-0000-000000000024'
    )
    from room_lobby_test_context
    where key = 'duplicate_name_room'
  $$,
  'P0001',
  'player_name_taken',
  'a Sala rejects duplicate case-insensitive Jugador names'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
values (
  'capacity_room',
  public.create_room(
    'One',
    'technology',
    '11000000-0000-0000-0000-000000000015'
  )
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from room_lobby_test_context
    where key = 'capacity_room'
  ),
  'Two',
  'social',
  '22000000-0000-0000-0000-000000000025'
);

select set_config(
  'request.jwt.claim.sub',
  '33000000-0000-0000-0000-000000000003',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from room_lobby_test_context
    where key = 'capacity_room'
  ),
  'Three',
  'traditional',
  '33000000-0000-0000-0000-000000000035'
);

select set_config(
  'request.jwt.claim.sub',
  '44000000-0000-0000-0000-000000000004',
  true
);

insert into room_lobby_test_context (key, value)
select
  'full_room',
  public.join_room(
    capacity_room.value #>> '{room,code}',
    'Four',
    'technology',
    '44000000-0000-0000-0000-000000000045'
  )
from room_lobby_test_context as capacity_room
where capacity_room.key = 'capacity_room';

select is(
  (
    select jsonb_array_length(value -> 'players')
    from room_lobby_test_context
    where key = 'full_room'
  ),
  4,
  'a Sala accepts exactly four Jugadores'
);

select set_config(
  'request.jwt.claim.sub',
  '55000000-0000-0000-0000-000000000005',
  true
);

select throws_ok(
  $$
    select public.join_room(
      value #>> '{room,code}',
      'Five',
      'social',
      '55000000-0000-0000-0000-000000000055'
    )
    from room_lobby_test_context
    where key = 'capacity_room'
  $$,
  'P0001',
  'room_full',
  'a fifth Jugador cannot join a full Sala'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
values (
  'expired_room',
  public.create_room(
    'Old Host',
    'traditional',
    '11000000-0000-0000-0000-000000000016'
  )
);

reset role;

update public.rooms as room
set created_at = now() - interval '25 hours',
    expires_at = now() - interval '1 hour'
from room_lobby_test_context as test_room
where test_room.key = 'expired_room'
  and room.id = (test_room.value #>> '{room,id}')::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.join_room(
      value #>> '{room,code}',
      'Late Guest',
      'technology',
      '22000000-0000-0000-0000-000000000026'
    )
    from room_lobby_test_context
    where key = 'expired_room'
  $$,
  'P0001',
  'room_expired',
  'a Jugador cannot join a Sala after its 24-hour expiry'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
values (
  'start_room',
  public.create_room(
    'Starter',
    'technology',
    '11000000-0000-0000-0000-000000000017'
  )
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from room_lobby_test_context
    where key = 'start_room'
  ),
  'Second',
  'social',
  '22000000-0000-0000-0000-000000000027'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
select
  'started_room',
  public.start_game(
    (start_room.value #>> '{room,id}')::uuid,
    1,
    '11000000-0000-0000-0000-000000000018'
  )
from room_lobby_test_context as start_room
where start_room.key = 'start_room';

select ok(
  (
    select
      value #>> '{room,status}' = 'playing'
      and value #>> '{room,phase}' = 'waiting_for_roll'
      and (value #>> '{room,round}')::integer = 1
      and (value #>> '{room,version}')::bigint = 2
      and (value #>> '{room,current_player_id}') = value #>> '{players,0,id}'
      and (value #>> '{players,0,turn_order}')::integer = 0
      and (value #>> '{players,1,turn_order}')::integer = 1
      and (value #>> '{room,deadline}')::timestamptz
        = now() + interval '30 seconds'
    from room_lobby_test_context
    where key = 'started_room'
  ),
  'the host starts a Partida with randomized unique order and an active Turno'
);

select is(
  public.start_game(
    (
      select (value #>> '{room,id}')::uuid
      from room_lobby_test_context
      where key = 'start_room'
    ),
    1,
    '11000000-0000-0000-0000-000000000018'
  ),
  (
    select value
    from room_lobby_test_context
    where key = 'started_room'
  ),
  'start_game replays a duplicate request before stale-version validation'
);

select set_config(
  'request.jwt.claim.sub',
  '33000000-0000-0000-0000-000000000003',
  true
);

select throws_ok(
  $$
    select public.join_room(
      value #>> '{room,code}',
      'Too Late',
      'traditional',
      '33000000-0000-0000-0000-000000000037'
    )
    from room_lobby_test_context
    where key = 'start_room'
  $$,
  'P0001',
  'room_not_joinable',
  'joining a Sala closes after its Partida starts'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

insert into room_lobby_test_context (key, value)
values (
  'one_player_room',
  public.create_room(
    'Solo',
    'social',
    '11000000-0000-0000-0000-000000000019'
  )
);

select throws_ok(
  $$
    select public.start_game(
      (value #>> '{room,id}')::uuid,
      0,
      '11000000-0000-0000-0000-000000000029'
    )
    from room_lobby_test_context
    where key = 'one_player_room'
  $$,
  'P0001',
  'not_enough_players',
  'a Partida requires at least two Jugadores'
);

insert into room_lobby_test_context (key, value)
values (
  'guard_room',
  public.create_room(
    'Guard Host',
    'traditional',
    '11000000-0000-0000-0000-000000000020'
  )
);

select set_config(
  'request.jwt.claim.sub',
  '22000000-0000-0000-0000-000000000002',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from room_lobby_test_context
    where key = 'guard_room'
  ),
  'Guard Guest',
  'technology',
  '22000000-0000-0000-0000-000000000030'
);

select throws_ok(
  $$
    select public.start_game(
      (value #>> '{room,id}')::uuid,
      1,
      '22000000-0000-0000-0000-000000000031'
    )
    from room_lobby_test_context
    where key = 'guard_room'
  $$,
  'P0001',
  'not_room_host',
  'only the host can start a Partida'
);

select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000001',
  true
);

select throws_ok(
  $$
    select public.start_game(
      (value #>> '{room,id}')::uuid,
      0,
      '11000000-0000-0000-0000-000000000021'
    )
    from room_lobby_test_context
    where key = 'guard_room'
  $$,
  'P0001',
  'stale_version',
  'start_game rejects a stale expected Sala version'
);

reset role;

select extensions.dblink_connect(
  'capacity_setup',
  'host=supabase_db_startup-race port=5432 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'capacity_setup',
  $setup$
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
        '66000000-0000-0000-0000-000000000006',
        'authenticated', 'authenticated', 'race-host@example.test', '',
        now(), now(), now(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000',
        '77000000-0000-0000-0000-000000000007',
        'authenticated', 'authenticated', 'race-two@example.test', '',
        now(), now(), now(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000',
        '88000000-0000-0000-0000-000000000008',
        'authenticated', 'authenticated', 'race-three@example.test', '',
        now(), now(), now(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000',
        '99000000-0000-0000-0000-000000000009',
        'authenticated', 'authenticated', 'race-four-a@example.test', '',
        now(), now(), now(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000',
        'aa000000-0000-0000-0000-00000000000a',
        'authenticated', 'authenticated', 'race-four-b@example.test', '',
        now(), now(), now(), '', '', '', ''
      );

    insert into public.rooms (id, code, host_id)
    values (
      '90000000-0000-0000-0000-000000000009',
      'CNCR24',
      '66000000-0000-0000-0000-000000000006'
    );

    insert into public.players (
      room_id,
      identity_id,
      name,
      entrepreneurship_type
    ) values
      (
        '90000000-0000-0000-0000-000000000009',
        '66000000-0000-0000-0000-000000000006',
        'Race Host',
        'technology'
      ),
      (
        '90000000-0000-0000-0000-000000000009',
        '77000000-0000-0000-0000-000000000007',
        'Race Two',
        'social'
      ),
      (
        '90000000-0000-0000-0000-000000000009',
        '88000000-0000-0000-0000-000000000008',
        'Race Three',
        'traditional'
      );

    create table public.room_lobby_concurrency_results (
      actor_id uuid primary key,
      outcome text not null
    );

    grant select, insert on public.room_lobby_concurrency_results
      to authenticated;
  $setup$
);

select extensions.dblink_disconnect('capacity_setup');

select extensions.dblink_connect(
  'capacity_a',
  'host=supabase_db_startup-race port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'capacity_b',
  'host=supabase_db_startup-race port=5432 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec('capacity_a', 'set role authenticated');
select extensions.dblink_exec('capacity_b', 'set role authenticated');

select extensions.dblink_exec(
  'capacity_a',
  $claim$
    do $do$
    begin
      perform set_config(
        'request.jwt.claim.sub',
        '99000000-0000-0000-0000-000000000009',
        false
      );
    end
    $do$;
  $claim$
);
select extensions.dblink_exec(
  'capacity_b',
  $claim$
    do $do$
    begin
      perform set_config(
        'request.jwt.claim.sub',
        'aa000000-0000-0000-0000-00000000000a',
        false
      );
    end
    $do$;
  $claim$
);

select extensions.dblink_send_query(
  'capacity_a',
  $race$
    do $do$
    begin
      perform public.join_room(
        'CNCR24',
        'Race Four A',
        'technology',
        '99000000-0000-0000-0000-000000000019'
      );
      insert into public.room_lobby_concurrency_results (actor_id, outcome)
      values ('99000000-0000-0000-0000-000000000009', 'joined');
    exception
      when others then
        insert into public.room_lobby_concurrency_results (actor_id, outcome)
        values ('99000000-0000-0000-0000-000000000009', sqlerrm);
    end
    $do$;
  $race$
);
select extensions.dblink_send_query(
  'capacity_b',
  $race$
    do $do$
    begin
      perform public.join_room(
        'CNCR24',
        'Race Four B',
        'social',
        'aa000000-0000-0000-0000-00000000001a'
      );
      insert into public.room_lobby_concurrency_results (actor_id, outcome)
      values ('aa000000-0000-0000-0000-00000000000a', 'joined');
    exception
      when others then
        insert into public.room_lobby_concurrency_results (actor_id, outcome)
        values ('aa000000-0000-0000-0000-00000000000a', sqlerrm);
    end
    $do$;
  $race$
);

select *
from extensions.dblink_get_result('capacity_a') as result(status text);
select *
from extensions.dblink_get_result('capacity_b') as result(status text);

select extensions.dblink_connect(
  'capacity_read',
  'host=supabase_db_startup-race port=5432 dbname=postgres user=postgres password=postgres'
);

select results_eq(
  $$
    select outcome
    from extensions.dblink(
      'capacity_read',
      'select outcome from public.room_lobby_concurrency_results order by outcome'
    ) as remote_result(outcome text)
  $$,
  $$ values ('joined'::text), ('room_full'::text) $$,
  'concurrent joins serialize so exactly one Jugador claims the fourth seat'
);

select extensions.dblink_exec(
  'capacity_read',
  $$ delete from public.rooms where id = '90000000-0000-0000-0000-000000000009' $$
);
select extensions.dblink_exec(
  'capacity_read',
  'drop table public.room_lobby_concurrency_results'
);
select extensions.dblink_exec(
  'capacity_read',
  $$
    delete from auth.users
    where id in (
      '66000000-0000-0000-0000-000000000006',
      '77000000-0000-0000-0000-000000000007',
      '88000000-0000-0000-0000-000000000008',
      '99000000-0000-0000-0000-000000000009',
      'aa000000-0000-0000-0000-00000000000a'
    )
  $$
);

select extensions.dblink_disconnect('capacity_a');
select extensions.dblink_disconnect('capacity_b');
select extensions.dblink_disconnect('capacity_read');

select * from finish();
rollback;
