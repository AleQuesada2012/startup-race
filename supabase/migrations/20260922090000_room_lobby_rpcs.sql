create function public.room_state_payload(target_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', room.id,
      'code', room.code,
      'host_id', room.host_id,
      'status', room.status,
      'phase', room.phase,
      'current_player_id', room.current_player_id,
      'round', room.round,
      'version', room.version,
      'pending_kind', room.pending_kind,
      'pending_card_id', room.pending_card_id,
      'deadline', room.deadline,
      'result', room.result,
      'expires_at', room.expires_at
    ),
    'players', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', player.id,
            'name', player.name,
            'entrepreneurship_type', player.entrepreneurship_type,
            'turn_order', player.turn_order,
            'position', player.position,
            'capital', player.capital,
            'reputation', player.reputation,
            'innovation', player.innovation,
            'is_host', player.identity_id = room.host_id,
            'is_self', player.identity_id = auth.uid()
          )
          order by
            player.turn_order nulls last,
            (player.identity_id = room.host_id) desc,
            player.name_key,
            player.id
        )
        from public.players as player
        where player.room_id = room.id
      ),
      '[]'::jsonb
    )
  )
  from public.rooms as room
  where room.id = target_room_id;
$$;

revoke all on function public.room_state_payload(uuid) from public;
revoke all on function public.room_state_payload(uuid) from anon;
revoke all on function public.room_state_payload(uuid) from authenticated;

create function public.create_room(
  name text,
  entrepreneurship_type public.entrepreneurship_type,
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
  created_room_id uuid;
  created_code text;
  response jsonb;
begin
  if authenticated_actor_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  if request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_request_id';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      authenticated_actor_id::text || ':' || request_id::text,
      0
    )
  );

  if name is null
    or char_length(btrim(name)) not between 1 and 24 then
    raise exception using errcode = 'P0001', message = 'invalid_player_name';
  end if;

  select action.*
  into existing_action
  from public.actions as action
  where action.actor_id = authenticated_actor_id
    and action.request_id = create_room.request_id;

  if found then
    if existing_action.command <> 'create_room' then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return existing_action.result;
  end if;

  loop
    select string_agg(
      substr(
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        1 + floor(random() * 32)::integer,
        1
      ),
      ''
    )
    into created_code
    from generate_series(1, 6);

    begin
      insert into public.rooms (code, host_id)
      values (created_code, authenticated_actor_id)
      returning id into created_room_id;
      exit;
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  insert into public.players (
    room_id,
    identity_id,
    name,
    entrepreneurship_type,
    capital,
    reputation,
    innovation
  ) values (
    created_room_id,
    authenticated_actor_id,
    btrim(name),
    entrepreneurship_type,
    5000 + case when entrepreneurship_type = 'traditional' then 2000 else 0 end,
    1 + case when entrepreneurship_type = 'social' then 1 else 0 end,
    1 + case when entrepreneurship_type = 'technology' then 1 else 0 end
  );

  response := public.room_state_payload(created_room_id);

  insert into public.actions (
    room_id,
    actor_id,
    request_id,
    command,
    result,
    resulting_version
  ) values (
    created_room_id,
    authenticated_actor_id,
    request_id,
    'create_room',
    response,
    0
  );

  return response;
end;
$$;

revoke all on function public.create_room(
  text,
  public.entrepreneurship_type,
  uuid
) from public;
revoke all on function public.create_room(
  text,
  public.entrepreneurship_type,
  uuid
) from anon;
grant execute on function public.create_room(
  text,
  public.entrepreneurship_type,
  uuid
) to authenticated;

create function public.join_room(
  code text,
  name text,
  entrepreneurship_type public.entrepreneurship_type,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  normalized_code text := upper(btrim($1));
  normalized_name text := btrim($2);
  existing_action public.actions%rowtype;
  target_room public.rooms%rowtype;
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

  if normalized_name is null
    or char_length(normalized_name) not between 1 and 24 then
    raise exception using errcode = 'P0001', message = 'invalid_player_name';
  end if;

  select action.*
  into existing_action
  from public.actions as action
  where action.actor_id = authenticated_actor_id
    and action.request_id = $4;

  if found then
    if existing_action.command <> 'join_room' then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return existing_action.result;
  end if;

  select room.*
  into target_room
  from public.rooms as room
  where room.code = normalized_code
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if target_room.expires_at <= now() or target_room.status = 'expired' then
    raise exception using errcode = 'P0001', message = 'room_expired';
  end if;

  if target_room.status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'room_not_joinable';
  end if;

  if exists (
    select 1
    from public.players as player
    where player.room_id = target_room.id
      and player.identity_id = authenticated_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'already_joined';
  end if;

  if exists (
    select 1
    from public.players as player
    where player.room_id = target_room.id
      and player.name_key = lower(normalized_name)
  ) then
    raise exception using errcode = 'P0001', message = 'player_name_taken';
  end if;

  if (
    select count(*)
    from public.players as player
    where player.room_id = target_room.id
  ) >= 4 then
    raise exception using errcode = 'P0001', message = 'room_full';
  end if;

  insert into public.players (
    room_id,
    identity_id,
    name,
    entrepreneurship_type,
    capital,
    reputation,
    innovation
  ) values (
    target_room.id,
    authenticated_actor_id,
    normalized_name,
    $3,
    5000 + case when $3 = 'traditional' then 2000 else 0 end,
    1 + case when $3 = 'social' then 1 else 0 end,
    1 + case when $3 = 'technology' then 1 else 0 end
  );

  update public.rooms as room
  set version = room.version + 1,
      updated_at = now()
  where room.id = target_room.id;

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
    'join_room',
    response,
    (response #>> '{room,version}')::bigint
  );

  return response;
end;
$$;

revoke all on function public.join_room(
  text,
  text,
  public.entrepreneurship_type,
  uuid
) from public;
revoke all on function public.join_room(
  text,
  text,
  public.entrepreneurship_type,
  uuid
) from anon;
grant execute on function public.join_room(
  text,
  text,
  public.entrepreneurship_type,
  uuid
) to authenticated;

create function public.start_game(
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
  first_player_id uuid;
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
    if existing_action.command <> 'start_game' then
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

  if target_room.host_id <> authenticated_actor_id then
    raise exception using errcode = 'P0001', message = 'not_room_host';
  end if;

  if target_room.status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'room_not_startable';
  end if;

  if $2 is null or target_room.version <> $2 then
    raise exception using errcode = 'P0001', message = 'stale_version';
  end if;

  if (
    select count(*)
    from public.players as player
    where player.room_id = target_room.id
  ) < 2 then
    raise exception using errcode = 'P0001', message = 'not_enough_players';
  end if;

  with randomized_players as (
    select
      player.id,
      (row_number() over (order by random()) - 1)::smallint as turn_order
    from public.players as player
    where player.room_id = target_room.id
  )
  update public.players as player
  set turn_order = randomized_player.turn_order
  from randomized_players as randomized_player
  where player.id = randomized_player.id;

  select player.id
  into first_player_id
  from public.players as player
  where player.room_id = target_room.id
    and player.turn_order = 0;

  update public.rooms as room
  set status = 'playing',
      phase = 'waiting_for_roll',
      current_player_id = first_player_id,
      round = 1,
      version = room.version + 1,
      pending_kind = null,
      pending_card_id = null,
      deadline = now() + interval '30 seconds',
      result = null,
      updated_at = now()
  where room.id = target_room.id;

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
    'start_game',
    response,
    (response #>> '{room,version}')::bigint
  );

  return response;
end;
$$;

revoke all on function public.start_game(uuid, bigint, uuid) from public;
revoke all on function public.start_game(uuid, bigint, uuid) from anon;
grant execute on function public.start_game(uuid, bigint, uuid) to authenticated;

create function public.get_room_state(code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  target_room_id uuid;
begin
  if authenticated_actor_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  select room.id
  into target_room_id
  from public.rooms as room
  where room.code = upper(btrim($1));

  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  if not exists (
    select 1
    from public.players as player
    where player.room_id = target_room_id
      and player.identity_id = authenticated_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_room_member';
  end if;

  return public.room_state_payload(target_room_id);
end;
$$;

revoke all on function public.get_room_state(text) from public;
revoke all on function public.get_room_state(text) from anon;
grant execute on function public.get_room_state(text) to authenticated;
