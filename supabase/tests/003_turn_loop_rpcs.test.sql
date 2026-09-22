begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

create temporary table turn_loop_test_context (
  key text primary key,
  value jsonb not null
);

grant select, insert, update on turn_loop_test_context to authenticated;

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
    'a1000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'turn-host@example.test', '',
    now(), now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a2000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'turn-guest@example.test', '',
    now(), now(), now(), '', '', '', ''
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-0000-0000-000000000001',
  true
);

insert into turn_loop_test_context (key, value)
values (
  'room',
  public.create_room(
    'Host',
    'technology',
    'a1000000-0000-0000-0000-000000000011'
  )
);

select set_config(
  'request.jwt.claim.sub',
  'a2000000-0000-0000-0000-000000000002',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from turn_loop_test_context
    where key = 'room'
  ),
  'Guest',
  'social',
  'a2000000-0000-0000-0000-000000000012'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-0000-0000-000000000001',
  true
);

insert into turn_loop_test_context (key, value)
select
  'started',
  public.start_game(
    (room.value #>> '{room,id}')::uuid,
    1,
    'a1000000-0000-0000-0000-000000000013'
  )
from turn_loop_test_context as room
where room.key = 'room';

select set_config(
  'request.jwt.claim.sub',
  case
    when value #>> '{room,current_player_id}' = (
      select player ->> 'id'
      from jsonb_array_elements(value -> 'players') as player
      where (player ->> 'is_host')::boolean
    ) then 'a1000000-0000-0000-0000-000000000001'
    else 'a2000000-0000-0000-0000-000000000002'
  end,
  true
)
from turn_loop_test_context
where key = 'started';

insert into turn_loop_test_context (key, value)
select
  'rolled',
  public.roll_dice(
    (started.value #>> '{room,id}')::uuid,
    2,
    'a3000000-0000-0000-0000-000000000014'
  )
from turn_loop_test_context as started
where started.key = 'started';

select ok(
  (
    select
      (value #>> '{room,version}')::bigint = 3
      and value #>> '{room,phase}' = 'waiting_for_choice'
      and value #>> '{room,pending_kind}' = 'card'
      and (value #>> '{room,deadline}')::timestamptz
        = now() + interval '60 seconds'
      and (value #>> '{room,result,roll}')::integer between 1 and 6
      and (value #>> '{room,result,to_position}')::integer
        = (value #>> '{room,result,roll}')::integer
      and value #>> '{room,pending_card_id}' = case
        (value #>> '{room,result,to_position}')::integer
        when 1 then 'decision-focus'
        when 2 then 'innovation-prototype'
        when 3 then 'opportunity-fair'
        when 4 then 'crisis-competitor'
        when 5 then 'decision-pricing'
        when 6 then 'opportunity-mentor'
      end
    from turn_loop_test_context
    where key = 'rolled'
  ),
  'the current Jugador rolls, moves, and receives the fixed Tarjeta'
);

reset role;

insert into public.card_options (
  id,
  card_id,
  label,
  is_default,
  cost_capital,
  cost_reputation,
  cost_innovation
)
select
  'test-clamping-option',
  value #>> '{room,pending_card_id}',
  'Test clamping option',
  false,
  0,
  0,
  0
from turn_loop_test_context
where key = 'rolled';

insert into public.card_outcomes (
  id,
  option_id,
  label,
  probability,
  capital_delta,
  reputation_delta,
  innovation_delta,
  explanation
) values (
  'test-clamping-outcome',
  'test-clamping-option',
  'Test clamping outcome',
  100,
  -10000,
  -10,
  2,
  'Deterministic test outcome.'
);

set local role authenticated;

insert into turn_loop_test_context (key, value)
select
  'chosen',
  public.choose_option(
    (rolled.value #>> '{room,id}')::uuid,
    'test-clamping-option',
    3,
    'a3000000-0000-0000-0000-000000000015'
  )
from turn_loop_test_context as rolled
where rolled.key = 'rolled';

select ok(
  (
    select
      chosen.value #>> '{room,phase}' = 'waiting_for_roll'
      and chosen.value #>> '{room,pending_kind}' is null
      and chosen.value #>> '{room,pending_card_id}' is null
      and (chosen.value #>> '{room,version}')::bigint = 4
      and chosen.value #>> '{room,current_player_id}'
        <> rolled.value #>> '{room,current_player_id}'
      and (chosen.value #>> '{room,deadline}')::timestamptz
        = now() + interval '30 seconds'
      and chosen.value #>> '{room,result,kind}' = 'card'
      and chosen.value #>> '{room,result,option_id}' = 'test-clamping-option'
      and chosen.value #>> '{room,result,outcome_id}' = 'test-clamping-outcome'
      and (
        select (player ->> 'capital')::integer = 0
          and (player ->> 'reputation')::integer = 0
          and (player ->> 'innovation')::integer = case
            when (player ->> 'is_host')::boolean then 4
            else 3
          end
        from jsonb_array_elements(chosen.value -> 'players') as player
        where player ->> 'id' = rolled.value #>> '{room,current_player_id}'
      )
    from turn_loop_test_context as chosen
    cross join turn_loop_test_context as rolled
    where chosen.key = 'chosen'
      and rolled.key = 'rolled'
  ),
  'a Tarjeta choice applies its server outcome, clamps resources, and advances'
);

reset role;

update public.players as player
set position = 29
from turn_loop_test_context as chosen
where chosen.key = 'chosen'
  and player.id = (chosen.value #>> '{room,current_player_id}')::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  case
    when value #>> '{room,current_player_id}' = (
      select player ->> 'id'
      from jsonb_array_elements(value -> 'players') as player
      where (player ->> 'is_host')::boolean
    ) then 'a1000000-0000-0000-0000-000000000001'
    else 'a2000000-0000-0000-0000-000000000002'
  end,
  true
)
from turn_loop_test_context
where key = 'chosen';

insert into turn_loop_test_context (key, value)
select
  'empresa_roll',
  public.roll_dice(
    (chosen.value #>> '{room,id}')::uuid,
    4,
    'a3000000-0000-0000-0000-000000000016'
  )
from turn_loop_test_context as chosen
where chosen.key = 'chosen';

select ok(
  (
    select
      value #>> '{room,phase}' = 'waiting_for_choice'
      and value #>> '{room,pending_kind}' = 'management'
      and value #>> '{room,pending_card_id}' is null
      and (value #>> '{room,result,to_position}')::integer = 30
      and (value #>> '{room,version}')::bigint = 5
    from turn_loop_test_context
    where key = 'empresa_roll'
  ),
  'overshoot stops at Empresa and triggers no Tarjeta'
);

reset role;

update public.players as player
set capital = 500
from turn_loop_test_context as empresa_roll
where empresa_roll.key = 'empresa_roll'
  and player.id = (empresa_roll.value #>> '{room,current_player_id}')::uuid;

set local role authenticated;

select throws_ok(
  $$
    select public.choose_option(
      (value #>> '{room,id}')::uuid,
      'product_improvement',
      5,
      'a3000000-0000-0000-0000-000000000017'
    )
    from turn_loop_test_context
    where key = 'empresa_roll'
  $$,
  'P0001',
  'insufficient_resources',
  'an Empresa action rejects a cost the Jugador cannot pay'
);

reset role;

update public.players as player
set capital = 11000,
    reputation = 4,
    innovation = 5
from turn_loop_test_context as empresa_roll
where empresa_roll.key = 'empresa_roll'
  and player.id = (empresa_roll.value #>> '{room,current_player_id}')::uuid;

update public.players as player
set position = 30,
    capital = 20000,
    reputation = 10,
    innovation = 10
from turn_loop_test_context as empresa_roll
where empresa_roll.key = 'empresa_roll'
  and player.room_id = (empresa_roll.value #>> '{room,id}')::uuid
  and player.id <> (empresa_roll.value #>> '{room,current_player_id}')::uuid;

set local role authenticated;

insert into turn_loop_test_context (key, value)
select
  'victory',
  public.choose_option(
    (empresa_roll.value #>> '{room,id}')::uuid,
    'brand_building',
    5,
    'a3000000-0000-0000-0000-000000000018'
  )
from turn_loop_test_context as empresa_roll
where empresa_roll.key = 'empresa_roll';

select ok(
  (
    select
      value #>> '{room,status}' = 'finished'
      and value #>> '{room,phase}' is null
      and value #>> '{room,current_player_id}' is null
      and value #>> '{room,deadline}' is null
      and value #>> '{room,result,reason}' = 'consolidation'
      and value #>> '{room,result,winner_player_id}'
        = value #>> '{room,result,rankings,0,player_id}'
      and (value #>> '{room,result,rankings,0,rank}')::integer = 1
      and (value #>> '{room,result,rankings,1,rank}')::integer = 2
      and (value #>> '{room,version}')::bigint = 6
    from turn_loop_test_context
    where key = 'victory'
  ),
  'an Empresa action that reaches every threshold wins by Consolidación'
);

select is(
  public.choose_option(
    (
      select (value #>> '{room,id}')::uuid
      from turn_loop_test_context
      where key = 'empresa_roll'
    ),
    'brand_building',
    5,
    'a3000000-0000-0000-0000-000000000018'
  ),
  (
    select value
    from turn_loop_test_context
    where key = 'victory'
  ),
  'a duplicate winning choice replays before later state validation'
);

select throws_ok(
  $$
    select public.roll_dice(
      (value #>> '{room,id}')::uuid,
      6,
      'a3000000-0000-0000-0000-000000000019'
    )
    from turn_loop_test_context
    where key = 'victory'
  $$,
  'P0001',
  'room_not_playing',
  'a finished Sala rejects later game commands'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-0000-0000-000000000001',
  true
);

insert into turn_loop_test_context (key, value)
values (
  'timeout_room',
  public.create_room(
    'Timeout Host',
    'traditional',
    'a1000000-0000-0000-0000-000000000021'
  )
);

select set_config(
  'request.jwt.claim.sub',
  'a2000000-0000-0000-0000-000000000002',
  true
);

select public.join_room(
  (
    select value #>> '{room,code}'
    from turn_loop_test_context
    where key = 'timeout_room'
  ),
  'Timeout Guest',
  'technology',
  'a2000000-0000-0000-0000-000000000022'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-0000-0000-000000000001',
  true
);

insert into turn_loop_test_context (key, value)
select
  'timeout_started',
  public.start_game(
    (room.value #>> '{room,id}')::uuid,
    1,
    'a1000000-0000-0000-0000-000000000023'
  )
from turn_loop_test_context as room
where room.key = 'timeout_room';

select set_config(
  'request.jwt.claim.sub',
  case
    when value #>> '{room,current_player_id}' = (
      select player ->> 'id'
      from jsonb_array_elements(value -> 'players') as player
      where (player ->> 'is_host')::boolean
    ) then 'a2000000-0000-0000-0000-000000000002'
    else 'a1000000-0000-0000-0000-000000000001'
  end,
  true
)
from turn_loop_test_context
where key = 'timeout_started';

select throws_ok(
  $$
    select public.roll_dice(
      (value #>> '{room,id}')::uuid,
      2,
      'a3000000-0000-0000-0000-000000000024'
    )
    from turn_loop_test_context
    where key = 'timeout_started'
  $$,
  'P0001',
  'not_your_turn',
  'a Jugador cannot roll during another Jugador''s Turno'
);

select throws_ok(
  $$
    select public.resolve_timeout(
      (value #>> '{room,id}')::uuid,
      2,
      'a3000000-0000-0000-0000-000000000025'
    )
    from turn_loop_test_context
    where key = 'timeout_started'
  $$,
  'P0001',
  'deadline_not_reached',
  'a member cannot resolve a Turno before its public deadline'
);

reset role;

update public.rooms as room
set deadline = now() - interval '1 second'
from turn_loop_test_context as started
where started.key = 'timeout_started'
  and room.id = (started.value #>> '{room,id}')::uuid;

set local role authenticated;

select throws_ok(
  $$
    select public.resolve_timeout(
      (value #>> '{room,id}')::uuid,
      1,
      'a3000000-0000-0000-0000-000000000026'
    )
    from turn_loop_test_context
    where key = 'timeout_started'
  $$,
  'P0001',
  'stale_version',
  'resolve_timeout rejects a stale expected Sala version'
);

insert into turn_loop_test_context (key, value)
select
  'roll_timeout',
  public.resolve_timeout(
    (started.value #>> '{room,id}')::uuid,
    2,
    'a3000000-0000-0000-0000-000000000027'
  )
from turn_loop_test_context as started
where started.key = 'timeout_started';

select ok(
  (
    select
      timed_out.value #>> '{room,result,kind}' = 'roll_timeout'
      and timed_out.value #>> '{room,current_player_id}'
        <> started.value #>> '{room,current_player_id}'
      and (timed_out.value #>> '{room,version}')::bigint = 3
      and timed_out.value #>> '{room,phase}' = 'waiting_for_roll'
    from turn_loop_test_context as timed_out
    cross join turn_loop_test_context as started
    where timed_out.key = 'roll_timeout'
      and started.key = 'timeout_started'
  ),
  'any member can resolve an elapsed roll deadline by skipping the Turno'
);

select is(
  public.resolve_timeout(
    (
      select (value #>> '{room,id}')::uuid
      from turn_loop_test_context
      where key = 'timeout_started'
    ),
    2,
    'a3000000-0000-0000-0000-000000000027'
  ),
  (
    select value
    from turn_loop_test_context
    where key = 'roll_timeout'
  ),
  'a duplicate timeout request replays before stale-version validation'
);

select set_config(
  'request.jwt.claim.sub',
  case
    when value #>> '{room,current_player_id}' = (
      select player ->> 'id'
      from jsonb_array_elements(value -> 'players') as player
      where (player ->> 'is_host')::boolean
    ) then 'a1000000-0000-0000-0000-000000000001'
    else 'a2000000-0000-0000-0000-000000000002'
  end,
  true
)
from turn_loop_test_context
where key = 'roll_timeout';

insert into turn_loop_test_context (key, value)
select
  'choice_wait',
  public.roll_dice(
    (timed_out.value #>> '{room,id}')::uuid,
    3,
    'a3000000-0000-0000-0000-000000000028'
  )
from turn_loop_test_context as timed_out
where timed_out.key = 'roll_timeout';

reset role;

update public.rooms as room
set deadline = now() - interval '1 second'
from turn_loop_test_context as choice_wait
where choice_wait.key = 'choice_wait'
  and room.id = (choice_wait.value #>> '{room,id}')::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  case
    when value #>> '{room,current_player_id}' = (
      select player ->> 'id'
      from jsonb_array_elements(value -> 'players') as player
      where (player ->> 'is_host')::boolean
    ) then 'a2000000-0000-0000-0000-000000000002'
    else 'a1000000-0000-0000-0000-000000000001'
  end,
  true
)
from turn_loop_test_context
where key = 'choice_wait';

insert into turn_loop_test_context (key, value)
select
  'choice_timeout',
  public.resolve_timeout(
    (choice_wait.value #>> '{room,id}')::uuid,
    4,
    'a3000000-0000-0000-0000-000000000029'
  )
from turn_loop_test_context as choice_wait
where choice_wait.key = 'choice_wait';

select ok(
  (
    select
      resolved.value #>> '{room,result,kind}' = 'card'
      and (resolved.value #>> '{room,result,timed_out}')::boolean
      and resolved.value #>> '{room,result,option_id}' = (
        select option.id
        from public.card_options as option
        where option.card_id = waiting.value #>> '{room,pending_card_id}'
          and option.is_default
      )
      and (resolved.value #>> '{room,version}')::bigint = 5
      and (resolved.value #>> '{room,round}')::integer = 2
    from turn_loop_test_context as resolved
    cross join turn_loop_test_context as waiting
    where resolved.key = 'choice_timeout'
      and waiting.key = 'choice_wait'
  ),
  'an elapsed choice deadline applies the Tarjeta''s free default Opción'
);

reset role;

update public.players as player
set position = 30,
    capital = 5000,
    reputation = 1,
    innovation = 1
from turn_loop_test_context as test_room
where test_room.key = 'timeout_room'
  and player.room_id = (test_room.value #>> '{room,id}')::uuid;

update public.rooms as room
set round = 12,
    current_player_id = (
      select player.id
      from public.players as player
      where player.room_id = room.id
        and player.turn_order = 1
    ),
    phase = 'waiting_for_choice',
    pending_kind = 'management',
    pending_card_id = null,
    deadline = now() - interval '1 second',
    result = null
from turn_loop_test_context as test_room
where test_room.key = 'timeout_room'
  and room.id = (test_room.value #>> '{room,id}')::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  player.identity_id::text,
  true
)
from public.players as player
join turn_loop_test_context as test_room
  on player.room_id = (test_room.value #>> '{room,id}')::uuid
where test_room.key = 'timeout_room'
  and player.turn_order = 1;

insert into turn_loop_test_context (key, value)
select
  'round_limit',
  public.resolve_timeout(
    (test_room.value #>> '{room,id}')::uuid,
    5,
    'a3000000-0000-0000-0000-000000000030'
  )
from turn_loop_test_context as test_room
where test_room.key = 'timeout_room';

select ok(
  (
    select
      value #>> '{room,status}' = 'finished'
      and value #>> '{room,result,reason}' = 'round_limit'
      and value #>> '{room,result,winner_player_id}' is null
      and value #>> '{room,result,last_action,kind}' = 'management_timeout'
      and (value #>> '{room,result,last_action,timed_out}')::boolean
      and (value #>> '{room,result,rankings,0,rank}')::integer = 1
      and (value #>> '{room,result,rankings,1,rank}')::integer = 1
      and (value #>> '{room,result,rankings,0,score}')::numeric
        = (value #>> '{room,result,rankings,1,score}')::numeric
      and (value #>> '{room,round}')::integer = 12
      and (value #>> '{room,version}')::bigint = 6
    from turn_loop_test_context
    where key = 'round_limit'
  ),
  'the final action of Ronda 12 finishes without Consolidación and ties share rank'
);

select * from finish();
rollback;
