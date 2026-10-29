-- Dansles carpool — Supabase schema.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- Privacy model: the tables are closed to the public (row-level security on, no policies).
-- The web page can only call the functions below, and every function needs the group's
-- secret key (a long random code that lives only in the link you share in the WhatsApp group).

create extension if not exists pgcrypto;

create table if not exists cp_groups (
  id         uuid primary key default gen_random_uuid(),
  secret     text unique not null default encode(gen_random_bytes(16), 'hex'),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cp_families (
  group_id   uuid not null references cp_groups(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, id)
);

-- One row per family per week: parents saving at the same time never overwrite each other.
create table if not exists cp_responses (
  group_id   uuid not null references cp_groups(id) on delete cascade,
  week       date not null,
  family_id  text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, week, family_id)
);

-- Per-week record: { cancelled, plan } — the plan is stored once locked or manually edited.
create table if not exists cp_weeks (
  group_id   uuid not null references cp_groups(id) on delete cascade,
  week       date not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, week)
);

alter table cp_groups    enable row level security;
alter table cp_families  enable row level security;
alter table cp_responses enable row level security;
alter table cp_weeks     enable row level security;
revoke all on cp_groups, cp_families, cp_responses, cp_weeks from anon, authenticated;

-- ---------- functions (the only way in) ----------

create or replace function cp_group_id(p_secret text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare gid uuid;
begin
  select id into gid from cp_groups where secret = p_secret;
  if gid is null then raise exception 'invalid key' using errcode = '28000'; end if;
  return gid;
end $$;

-- Basic shape and size checks on what the page sends (protects against garbage or oversized writes).
create or replace function cp_check(p_data jsonb, p_max_bytes int) returns void
language plpgsql immutable as $$
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid data' using errcode = '22023'; end if;
  if octet_length(p_data::text) > p_max_bytes then raise exception 'data too large' using errcode = '22023'; end if;
end $$;

-- Retention: answers and week records older than ~13 months are deleted (called on every write).
create or replace function cp_purge(gid uuid) returns void
language sql security definer set search_path = public as $$
  delete from cp_responses where group_id = gid and week < current_date - 400;
  delete from cp_weeks     where group_id = gid and week < current_date - 400;
$$;

create or replace function cp_load(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  return jsonb_build_object(
    'settings', (select settings from cp_groups where id = gid),
    'families', coalesce((select jsonb_agg(data || jsonb_build_object('id', id, 'updatedAt', updated_at))
                          from cp_families where group_id = gid), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'familyId', family_id, 'data', data, 'updatedAt', updated_at))
                           from cp_responses where group_id = gid and week > current_date - 400), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'data', data, 'updatedAt', updated_at))
                       from cp_weeks where group_id = gid and week > current_date - 400), '[]'::jsonb)
  );
end $$;

create or replace function cp_save_settings(p_secret text, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cp_check(p_settings, 20000);
  update cp_groups set settings = p_settings where id = cp_group_id(p_secret);
end $$;

create or replace function cp_save_family(p_secret text, p_family jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  perform cp_check(p_family, 20000);
  if coalesce(p_family->>'id', '') = '' or length(p_family->>'id') > 64 then raise exception 'invalid family id'; end if;
  insert into cp_families (group_id, id, data, updated_at)
  values (gid, p_family->>'id', p_family - 'id' - 'updatedAt', now())
  on conflict (group_id, id) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function cp_delete_family(p_secret text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  delete from cp_responses where group_id = gid and family_id = p_id;
  delete from cp_families  where group_id = gid and id = p_id;
end $$;

-- p_data null = clear this family's answer for the week.
create or replace function cp_save_response(p_secret text, p_week date, p_family_id text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  perform cp_purge(gid);
  if p_data is null then
    delete from cp_responses where group_id = gid and week = p_week and family_id = p_family_id;
  else
    perform cp_check(p_data, 20000);
    insert into cp_responses (group_id, week, family_id, data, updated_at)
    values (gid, p_week, p_family_id, p_data, now())
    on conflict (group_id, week, family_id) do update set data = excluded.data, updated_at = now();
  end if;
end $$;

-- p_if_absent = true: only store the plan if no plan is stored yet (used to lock the plan at the deadline,
-- so two phones locking at the same moment can't produce two different plans).
-- Returns the week record as stored afterwards.
create or replace function cp_save_week(p_secret text, p_week date, p_data jsonb, p_if_absent boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
declare result jsonb;
begin
  perform cp_check(p_data, 300000);
  perform cp_purge(gid);
  if p_if_absent then
    insert into cp_weeks (group_id, week, data) values (gid, p_week, p_data)
    on conflict (group_id, week) do update
      set data = cp_weeks.data || jsonb_build_object('plan', excluded.data->'plan'), updated_at = now()
      where coalesce(jsonb_typeof(cp_weeks.data->'plan'), 'null') = 'null';
  else
    insert into cp_weeks (group_id, week, data, updated_at) values (gid, p_week, p_data, now())
    on conflict (group_id, week) do update set data = excluded.data, updated_at = now();
  end if;
  select data into result from cp_weeks where group_id = gid and week = p_week;
  return result;
end $$;

revoke all on function cp_group_id(text), cp_load(text), cp_save_settings(text, jsonb),
  cp_save_family(text, jsonb), cp_delete_family(text, text),
  cp_save_response(text, date, text, jsonb), cp_save_week(text, date, jsonb, boolean) from public;
-- Supabase grants new functions to anon by default; the internal helpers stay internal.
revoke all on function cp_group_id(text), cp_purge(uuid), cp_check(jsonb, int) from public, anon, authenticated;
grant execute on function cp_load(text), cp_save_settings(text, jsonb),
  cp_save_family(text, jsonb), cp_delete_family(text, text),
  cp_save_response(text, date, text, jsonb), cp_save_week(text, date, jsonb, boolean) to anon, authenticated;

-- ---------- create your group (run once) ----------
-- After running everything above, run this line on its own and copy the 'secret' it returns:
--
--   insert into cp_groups default values returning secret;
