create function public.player_has_consolidated(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players as player
    where player.id = target_player_id
      and player.position = 30
      and player.capital >= 10000
      and player.reputation >= 5
      and player.innovation >= 5
  );
$$;

revoke all on function public.player_has_consolidated(uuid) from public;
revoke all on function public.player_has_consolidated(uuid) from anon;
revoke all on function public.player_has_consolidated(uuid) from authenticated;

create function public.roll_dice(
  room_id uuid,
  expected_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  existing_action public.actions%rowtype;
  target_room public.rooms%rowtype;
  current_player public.players%rowtype;
  rolled_value smallint;
  destination smallint;
  destination_card_id text;
  action_result jsonb;
  response jsonb;
begin
  if authenticated_actor_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  if $3 is null then
    raise exception using errcode = 'P0001', message = 'invalid_request_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      authenticated_actor_id::text || ':' || $3::text,
      0
    )
  );

  select action.*
  into existing_action
  from public.actions as action
  where action.actor_id = authenticated_actor_id
    and action.request_id = $3;

  if found then
    if existing_action.command <> 'roll_dice' then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return existing_action.result;
  end if;

  select room.*
  into target_room
  from public.rooms as room
  where room.id = $1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if target_room.expires_at <= now() or target_room.status = 'expired' then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if not exists (
    select 1
    from public.players as player
    where player.room_id = target_room.id
      and player.identity_id = authenticated_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_room_member';
  end if;

  if target_room.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'room_not_playing';
  end if;

  if $2 is null or target_room.version <> $2 then
    raise exception using errcode = 'P0001', message = 'stale_version';
  end if;

  if target_room.phase <> 'waiting_for_roll' then
    raise exception using errcode = 'P0001', message = 'invalid_turn_phase';
  end if;

  if target_room.deadline <= now() then
    raise exception using errcode = 'P0001', message = 'deadline_expired';
  end if;

  select player.*
  into current_player
  from public.players as player
  where player.room_id = target_room.id
    and player.id = target_room.current_player_id
  for update;

  if current_player.identity_id <> authenticated_actor_id then
    raise exception using errcode = 'P0001', message = 'not_your_turn';
  end if;

  rolled_value := (1 + floor(random() * 6))::smallint;
  destination := least(30, current_player.position + rolled_value)::smallint;

  update public.players as player
  set position = destination
  where player.id = current_player.id;

  action_result := jsonb_build_object(
    'kind', 'roll',
    'player_id', current_player.id,
    'roll', rolled_value,
    'from_position', current_player.position,
    'to_position', destination
  );

  if destination = 30 then
    if public.player_has_consolidated(current_player.id) then
      perform public.advance_turn(
        target_room.id,
        current_player.turn_order,
        action_result,
        current_player.id
      );
    else
      update public.rooms as room
      set phase = 'waiting_for_choice',
          pending_kind = 'management',
          pending_card_id = null,
          deadline = now() + interval '60 seconds',
          result = action_result,
          version = room.version + 1,
          updated_at = now()
      where room.id = target_room.id;
    end if;
  else
    select board.card_id
    into destination_card_id
    from public.board_spaces as board
    where board.position = destination;

    update public.rooms as room
    set phase = 'waiting_for_choice',
        pending_kind = 'card',
        pending_card_id = destination_card_id,
        deadline = now() + interval '60 seconds',
        result = action_result,
        version = room.version + 1,
        updated_at = now()
    where room.id = target_room.id;
  end if;

  response := public.room_state_payload(target_room.id);

  insert into public.actions (
    room_id,
    actor_id,
    request_id,
    command,
    result,
    resulting_version
  ) values (
    target_room.id,
    authenticated_actor_id,
    $3,
    'roll_dice',
    response,
    (response #>> '{room,version}')::bigint
  );

  return response;
end;
$$;

revoke all on function public.roll_dice(uuid, bigint, uuid) from public;
revoke all on function public.roll_dice(uuid, bigint, uuid) from anon;
grant execute on function public.roll_dice(uuid, bigint, uuid) to authenticated;

create function public.apply_card_option(
  target_player_id uuid,
  target_card_id text,
  selected_option_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_player public.players%rowtype;
  selected_option public.card_options%rowtype;
  selected_outcome public.card_outcomes%rowtype;
  outcome_ticket integer;
begin
  select option.*
  into selected_option
  from public.card_options as option
  where option.id = selected_option_id
    and option.card_id = target_card_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_option';
  end if;

  select player.*
  into target_player
  from public.players as player
  where player.id = target_player_id
  for update;

  if target_player.capital < selected_option.cost_capital
    or target_player.reputation < selected_option.cost_reputation
    or target_player.innovation < selected_option.cost_innovation then
    raise exception using errcode = 'P0001', message = 'insufficient_resources';
  end if;

  outcome_ticket := 1 + floor(random() * 100)::integer;

  select weighted_outcome.id,
         weighted_outcome.option_id,
         weighted_outcome.label,
         weighted_outcome.probability,
         weighted_outcome.capital_delta,
         weighted_outcome.reputation_delta,
         weighted_outcome.innovation_delta,
         weighted_outcome.explanation
  into selected_outcome
  from (
    select
      outcome.*,
      sum(outcome.probability) over (order by outcome.id) as ceiling
    from public.card_outcomes as outcome
    where outcome.option_id = selected_option.id
  ) as weighted_outcome
  where outcome_ticket <= weighted_outcome.ceiling
  order by weighted_outcome.ceiling
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_outcome_weights';
  end if;

  update public.players as player
  set capital = greatest(
        0,
        player.capital
          - selected_option.cost_capital
          + selected_outcome.capital_delta
      ),
      reputation = greatest(
        0,
        player.reputation
          - selected_option.cost_reputation
          + selected_outcome.reputation_delta
      ),
      innovation = greatest(
        0,
        player.innovation
          - selected_option.cost_innovation
          + selected_outcome.innovation_delta
      )
  where player.id = target_player.id;

  return jsonb_build_object(
    'kind', 'card',
    'player_id', target_player.id,
    'card_id', target_card_id,
    'option_id', selected_option.id,
    'outcome_id', selected_outcome.id,
    'outcome_label', selected_outcome.label,
    'explanation', selected_outcome.explanation,
    'capital_delta', selected_outcome.capital_delta - selected_option.cost_capital,
    'reputation_delta',
      selected_outcome.reputation_delta - selected_option.cost_reputation,
    'innovation_delta',
      selected_outcome.innovation_delta - selected_option.cost_innovation
  );
end;
$$;

revoke all on function public.apply_card_option(uuid, text, text) from public;
revoke all on function public.apply_card_option(uuid, text, text) from anon;
revoke all on function public.apply_card_option(uuid, text, text)
  from authenticated;

create function public.advance_turn(
  target_room_id uuid,
  completed_turn_order smallint,
  action_result jsonb,
  winning_player_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  maximum_turn_order smallint;
  next_turn_order smallint;
  next_player public.players%rowtype;
  next_round smallint;
  finish_result jsonb;
begin
  select room.*
  into target_room
  from public.rooms as room
  where room.id = target_room_id
  for update;

  select max(player.turn_order)
  into maximum_turn_order
  from public.players as player
  where player.room_id = target_room.id;

  if winning_player_id is not null
    or (
      target_room.round = 12
      and completed_turn_order = maximum_turn_order
    ) then
    select jsonb_build_object(
      'kind', 'match_finished',
      'reason', case
        when winning_player_id is not null then 'consolidation'
        else 'round_limit'
      end,
      'winner_player_id', winning_player_id,
      'last_action', action_result,
      'rankings', jsonb_agg(
        jsonb_build_object(
          'player_id', ranked.id,
          'name', ranked.name,
          'rank', ranked.rank,
          'score', ranked.score,
          'position', ranked.position,
          'capital', ranked.capital,
          'reputation', ranked.reputation,
          'innovation', ranked.innovation
        )
        order by ranked.rank, ranked.turn_order
      )
    )
    into finish_result
    from (
      select
        scored.*,
        rank() over (
          order by
            case when scored.id = winning_player_id then 1 else 0 end desc,
            scored.score desc,
            scored.position desc
        ) as rank
      from (
        select
          player.*,
          least(player.capital::numeric / 10000, 1)
            + least(player.reputation::numeric / 5, 1)
            + least(player.innovation::numeric / 5, 1) as score
        from public.players as player
        where player.room_id = target_room.id
      ) as scored
    ) as ranked;

    update public.rooms as room
    set status = 'finished',
        phase = null,
        current_player_id = null,
        pending_kind = null,
        pending_card_id = null,
        deadline = null,
        result = finish_result,
        version = room.version + 1,
        updated_at = now()
    where room.id = target_room.id;

    return;
  end if;

  if completed_turn_order = maximum_turn_order then
    next_turn_order := 0;
    next_round := target_room.round + 1;
  else
    next_turn_order := completed_turn_order + 1;
    next_round := target_room.round;
  end if;

  select player.*
  into next_player
  from public.players as player
  where player.room_id = target_room.id
    and player.turn_order = next_turn_order;

  update public.rooms as room
  set current_player_id = next_player.id,
      round = next_round,
      phase = case
        when next_player.position = 30
          then 'waiting_for_choice'::public.turn_phase
        else 'waiting_for_roll'::public.turn_phase
      end,
      pending_kind = case
        when next_player.position = 30
          then 'management'::public.pending_kind
        else null
      end,
      pending_card_id = null,
      deadline = now() + case
        when next_player.position = 30 then interval '60 seconds'
        else interval '30 seconds'
      end,
      result = action_result,
      version = room.version + 1,
      updated_at = now()
  where room.id = target_room.id;
end;
$$;

revoke all on function public.advance_turn(uuid, smallint, jsonb, uuid)
  from public;
revoke all on function public.advance_turn(uuid, smallint, jsonb, uuid)
  from anon;
revoke all on function public.advance_turn(uuid, smallint, jsonb, uuid)
  from authenticated;

create function public.apply_management_action(
  target_player_id uuid,
  selected_action_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_player public.players%rowtype;
  selected_action public.management_actions%rowtype;
begin
  select management_action.*
  into selected_action
  from public.management_actions as management_action
  where management_action.id = selected_action_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_option';
  end if;

  select player.*
  into target_player
  from public.players as player
  where player.id = target_player_id
  for update;

  if target_player.capital < selected_action.cost_capital
    or target_player.reputation < selected_action.cost_reputation
    or target_player.innovation < selected_action.cost_innovation then
    raise exception using errcode = 'P0001', message = 'insufficient_resources';
  end if;

  update public.players as player
  set capital = greatest(
        0,
        player.capital
          - selected_action.cost_capital
          + selected_action.capital_delta
      ),
      reputation = greatest(
        0,
        player.reputation
          - selected_action.cost_reputation
          + selected_action.reputation_delta
      ),
      innovation = greatest(
        0,
        player.innovation
          - selected_action.cost_innovation
          + selected_action.innovation_delta
      )
  where player.id = target_player.id;

  return jsonb_build_object(
    'kind', 'management',
    'player_id', target_player.id,
    'action_id', selected_action.id,
    'explanation', selected_action.explanation,
    'capital_delta', selected_action.capital_delta - selected_action.cost_capital,
    'reputation_delta',
      selected_action.reputation_delta - selected_action.cost_reputation,
    'innovation_delta',
      selected_action.innovation_delta - selected_action.cost_innovation
  );
end;
$$;

revoke all on function public.apply_management_action(uuid, text) from public;
revoke all on function public.apply_management_action(uuid, text) from anon;
revoke all on function public.apply_management_action(uuid, text)
  from authenticated;

create function public.choose_option(
  room_id uuid,
  option_id text,
  expected_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  existing_action public.actions%rowtype;
  target_room public.rooms%rowtype;
  current_player public.players%rowtype;
  winning_player_id uuid;
  action_result jsonb;
  response jsonb;
begin
  if authenticated_actor_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  if $4 is null then
    raise exception using errcode = 'P0001', message = 'invalid_request_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      authenticated_actor_id::text || ':' || $4::text,
      0
    )
  );

  select action.*
  into existing_action
  from public.actions as action
  where action.actor_id = authenticated_actor_id
    and action.request_id = $4;

  if found then
    if existing_action.command <> 'choose_option' then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return existing_action.result;
  end if;

  select room.*
  into target_room
  from public.rooms as room
  where room.id = $1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if target_room.expires_at <= now() or target_room.status = 'expired' then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if not exists (
    select 1
    from public.players as player
    where player.room_id = target_room.id
      and player.identity_id = authenticated_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_room_member';
  end if;

  if target_room.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'room_not_playing';
  end if;

  if $3 is null or target_room.version <> $3 then
    raise exception using errcode = 'P0001', message = 'stale_version';
  end if;

  if target_room.phase <> 'waiting_for_choice' then
    raise exception using errcode = 'P0001', message = 'invalid_turn_phase';
  end if;

  if target_room.deadline <= now() then
    raise exception using errcode = 'P0001', message = 'deadline_expired';
  end if;

  select player.*
  into current_player
  from public.players as player
  where player.room_id = target_room.id
    and player.id = target_room.current_player_id
  for update;

  if current_player.identity_id <> authenticated_actor_id then
    raise exception using errcode = 'P0001', message = 'not_your_turn';
  end if;

  if target_room.pending_kind = 'card' then
    action_result := public.apply_card_option(
      current_player.id,
      target_room.pending_card_id,
      $2
    );
  elsif target_room.pending_kind = 'management' then
    action_result := public.apply_management_action(current_player.id, $2);
  else
    raise exception using errcode = 'P0001', message = 'invalid_option';
  end if;

  if public.player_has_consolidated(current_player.id) then
    winning_player_id := current_player.id;
  end if;

  perform public.advance_turn(
    target_room.id,
    current_player.turn_order,
    action_result,
    winning_player_id
  );

  response := public.room_state_payload(target_room.id);

  insert into public.actions (
    room_id,
    actor_id,
    request_id,
    command,
    result,
    resulting_version
  ) values (
    target_room.id,
    authenticated_actor_id,
    $4,
    'choose_option',
    response,
    (response #>> '{room,version}')::bigint
  );

  return response;
end;
$$;

revoke all on function public.choose_option(uuid, text, bigint, uuid)
  from public;
revoke all on function public.choose_option(uuid, text, bigint, uuid)
  from anon;
grant execute on function public.choose_option(uuid, text, bigint, uuid)
  to authenticated;

create function public.resolve_timeout(
  room_id uuid,
  expected_version bigint,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  existing_action public.actions%rowtype;
  target_room public.rooms%rowtype;
  current_player public.players%rowtype;
  default_option_id text;
  winning_player_id uuid;
  action_result jsonb;
  response jsonb;
begin
  if authenticated_actor_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  if $3 is null then
    raise exception using errcode = 'P0001', message = 'invalid_request_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      authenticated_actor_id::text || ':' || $3::text,
      0
    )
  );

  select action.*
  into existing_action
  from public.actions as action
  where action.actor_id = authenticated_actor_id
    and action.request_id = $3;

  if found then
    if existing_action.command <> 'resolve_timeout' then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return existing_action.result;
  end if;

  select room.*
  into target_room
  from public.rooms as room
  where room.id = $1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if target_room.expires_at <= now() or target_room.status = 'expired' then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if not exists (
    select 1
    from public.players as player
    where player.room_id = target_room.id
      and player.identity_id = authenticated_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_room_member';
  end if;

  if target_room.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'room_not_playing';
  end if;

  if $2 is null or target_room.version <> $2 then
    raise exception using errcode = 'P0001', message = 'stale_version';
  end if;

  if target_room.deadline > now() then
    raise exception using errcode = 'P0001', message = 'deadline_not_reached';
  end if;

  select player.*
  into current_player
  from public.players as player
  where player.room_id = target_room.id
    and player.id = target_room.current_player_id
  for update;

  if target_room.phase = 'waiting_for_roll' then
    action_result := jsonb_build_object(
      'kind', 'roll_timeout',
      'player_id', current_player.id,
      'timed_out', true
    );
  elsif target_room.phase = 'waiting_for_choice'
    and target_room.pending_kind = 'card' then
    select option.id
    into default_option_id
    from public.card_options as option
    where option.card_id = target_room.pending_card_id
      and option.is_default
      and option.cost_capital = 0
      and option.cost_reputation = 0
      and option.cost_innovation = 0;

    if not found then
      raise exception using errcode = 'P0001', message = 'default_option_not_found';
    end if;

    action_result := public.apply_card_option(
      current_player.id,
      target_room.pending_card_id,
      default_option_id
    ) || jsonb_build_object('timed_out', true);
  elsif target_room.phase = 'waiting_for_choice'
    and target_room.pending_kind = 'management' then
    action_result := jsonb_build_object(
      'kind', 'management_timeout',
      'player_id', current_player.id,
      'timed_out', true
    );
  else
    raise exception using errcode = 'P0001', message = 'invalid_turn_phase';
  end if;

  if public.player_has_consolidated(current_player.id) then
    winning_player_id := current_player.id;
  end if;

  perform public.advance_turn(
    target_room.id,
    current_player.turn_order,
    action_result,
    winning_player_id
  );

  response := public.room_state_payload(target_room.id);

  insert into public.actions (
    room_id,
    actor_id,
    request_id,
    command,
    result,
    resulting_version
  ) values (
    target_room.id,
    authenticated_actor_id,
    $3,
    'resolve_timeout',
    response,
    (response #>> '{room,version}')::bigint
  );

  return response;
end;
$$;

revoke all on function public.resolve_timeout(uuid, bigint, uuid) from public;
revoke all on function public.resolve_timeout(uuid, bigint, uuid) from anon;
grant execute on function public.resolve_timeout(uuid, bigint, uuid)
  to authenticated;
