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

-- ---------- retention: one boundary everywhere ----------
-- Answers and week records are kept for 400 days (the web app uses the same number, src/history.js).
-- Reading shows week >= cp_retention_start(); writes for older weeks are refused; older rows are deleted
-- by every write function (settings, family, delete, answer, week) and, where pg_cron is available,
-- also once a day (see the end of this file).

create or replace function cp_retention_start() returns date
language sql stable as $$ select current_date - 400 $$;

create or replace function cp_purge(gid uuid) returns void
language sql security definer set search_path = public as $$
  delete from cp_responses where group_id = gid and week < cp_retention_start();
  delete from cp_weeks     where group_id = gid and week < cp_retention_start();
$$;

create or replace function cp_purge_all() returns void
language sql security definer set search_path = public as $$
  delete from cp_responses where week < cp_retention_start();
  delete from cp_weeks     where week < cp_retention_start();
$$;

-- ---------- validation (internal) ----------
-- Each check returns true only when the value has the expected shape: unknown keys are refused, and a
-- missing required field (SQL NULL) always counts as invalid (coalesce(…, false) / IS NOT TRUE).

create or replace function cp_v_null(v jsonb) returns boolean
language sql immutable as $$ select coalesce((
    v is null or jsonb_typeof(v) = 'null'
  ), false) $$;

create or replace function cp_v_str(v jsonb, maxlen int, required boolean) returns boolean
language sql immutable as $$
  select coalesce((
    case when cp_v_null(v) then not required
              else jsonb_typeof(v) = 'string' and length(v #>> '{}') between (case when required then 1 else 0 end) and maxlen end
  ), false) $$;

create or replace function cp_v_num(v jsonb, lo numeric, hi numeric, required boolean, whole boolean) returns boolean
language sql immutable as $$
  select coalesce((
    case when cp_v_null(v) then not required
              else jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between lo and hi
                   and (not whole or (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)) end
  ), false) $$;

create or replace function cp_v_bool(v jsonb) returns boolean
language sql immutable as $$ select coalesce((
    cp_v_null(v) or jsonb_typeof(v) = 'boolean'
  ), false) $$;

create or replace function cp_v_id(v jsonb) returns boolean
language sql immutable as $$ select coalesce((
    jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[A-Za-z0-9_-]{1,64}$'
  ), false) $$;

create or replace function cp_v_time(v jsonb, required boolean) returns boolean
language sql immutable as $$
  select coalesce((
    case when cp_v_null(v) then not required
              else jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' end
  ), false) $$;

create or replace function cp_v_keys(v jsonb, allowed text[]) returns boolean
language sql immutable as $$
  select coalesce((
    jsonb_typeof(v) = 'object' and not exists (select 1 from jsonb_object_keys(v) k where k <> all (allowed))
  ), false) $$;

create or replace function cp_v_ids(v jsonb, maxn int) returns boolean
language sql immutable as $$
  select coalesce((
    jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= maxn
     and not exists (select 1 from jsonb_array_elements(v) e where cp_v_id(e) is not true)
  ), false) $$;

create or replace function cp_v_leg(v jsonb) returns boolean
language sql immutable as $$
  select coalesce((
    cp_v_keys(v, array['status','seats'])
     and (v->>'status') in ('need','self','rather_not','can','driving')
     and cp_v_num(v->'seats', 0, 20, false, true)
  ), false) $$;

create or replace function cp_v_family(f jsonb) returns boolean
language sql immutable as $$
  select coalesce((
    cp_v_keys(f, array['id','name','parent','kids','address','lat','lng','seats','usual','archived','updatedAt'])
     and cp_v_id(f->'id')
     and cp_v_str(f->'name', 80, true)
     and cp_v_str(f->'parent', 80, false)
     and jsonb_typeof(f->'kids') = 'array' and jsonb_array_length(f->'kids') between 1 and 10
     and not exists (select 1 from jsonb_array_elements(f->'kids') k
                     where (cp_v_keys(k, array['id','name']) and cp_v_id(k->'id') and cp_v_str(k->'name', 60, true)) is not true)
     and cp_v_str(f->'address', 200, false)
     and cp_v_num(f->'lat', -90, 90, false, false)
     and cp_v_num(f->'lng', -180, 180, false, false)
     and cp_v_num(f->'seats', 0, 20, true, true)
     and (cp_v_null(f->'usual') or (cp_v_keys(f->'usual', array['to','from']) and cp_v_leg(f->'usual'->'to') and cp_v_leg(f->'usual'->'from')))
     and cp_v_bool(f->'archived')
  ), false) $$;

create or replace function cp_v_response(r jsonb, kid_ids jsonb) returns boolean
language sql immutable as $$
  select coalesce((
    cp_v_keys(r, array['kids','to','from'])
     and cp_v_ids(r->'kids', 10)
     and not exists (select 1 from jsonb_array_elements(r->'kids') k where (kid_ids @> jsonb_build_array(k)) is not true)
     and cp_v_leg(r->'to') and cp_v_leg(r->'from')
  ), false) $$;

create or replace function cp_v_settings(s jsonb) returns boolean
language sql immutable as $$
  select coalesce((
    cp_v_keys(s, array['groupName','studio','weekday','time','endTime','deadlineDaysBefore','deadlineTime','startWeek','lookbackWeeks'])
     and cp_v_str(s->'groupName', 80, false)
     and (cp_v_null(s->'studio') or (cp_v_keys(s->'studio', array['address','lat','lng'])
          and cp_v_str(s->'studio'->'address', 200, false)
          and cp_v_num(s->'studio'->'lat', -90, 90, false, false) and cp_v_num(s->'studio'->'lng', -180, 180, false, false)))
     and cp_v_num(s->'weekday', 0, 6, false, true)
     and cp_v_time(s->'time', false) and cp_v_time(s->'endTime', false) and cp_v_time(s->'deadlineTime', false)
     and cp_v_num(s->'deadlineDaysBefore', 0, 7, false, true)
     and (cp_v_null(s->'startWeek') or (jsonb_typeof(s->'startWeek') = 'string' and (s->>'startWeek') ~ '^\d{4}-\d{2}-\d{2}$'))
     and cp_v_num(s->'lookbackWeeks', 1, 52, false, true)
  ), false) $$;

create or replace function cp_v_plan(p jsonb) returns boolean
language plpgsql immutable as $$
declare leg text; lp jsonb; car jsonb;
begin
  -- A week without a plan is fine; a plan that is present must be complete.
  if cp_v_null(p) then return true; end if;
  if (cp_v_keys(p, array['version','week','computedAt','edited','inferred','legs','sources','fingerprints','rates'])
      and cp_v_bool(p->'edited') and cp_v_bool(p->'inferred')
      and jsonb_typeof(p->'legs') = 'object') is not true then return false; end if;
  foreach leg in array array['sources','fingerprints','rates'] loop
    if (cp_v_null(p->leg) or jsonb_typeof(p->leg) = 'object') is not true then return false; end if;
  end loop;
  if (cp_v_keys(p->'legs', array['to','from']) and p->'legs' ? 'to' and p->'legs' ? 'from') is not true then return false; end if;
  foreach leg in array array['to','from'] loop
    lp := p->'legs'->leg;
    if (cp_v_keys(lp, array['participants','cars','unassigned','seatsShort'])
        and cp_v_ids(lp->'participants', 50) and cp_v_ids(lp->'unassigned', 50)
        and cp_v_num(lp->'seatsShort', 0, 200, false, true)
        and jsonb_typeof(lp->'cars') = 'array' and jsonb_array_length(lp->'cars') <= 50) is not true then return false; end if;
    for car in select * from jsonb_array_elements(lp->'cars') loop
      if (cp_v_keys(car, array['driverId','forced','ratherNot','seats','ownKids','riders','km'])
          and cp_v_id(car->'driverId') and cp_v_ids(car->'riders', 20)
          and cp_v_bool(car->'forced') and cp_v_bool(car->'ratherNot')
          and cp_v_num(car->'seats', 0, 20, true, true) and cp_v_num(car->'ownKids', 0, 10, false, true)
          and cp_v_num(car->'km', 0, 2000, false, false)) is not true then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function cp_v_week(w jsonb) returns boolean
language sql immutable as $$
  select coalesce((
    cp_v_keys(w, array['cancelled','plan']) and cp_v_bool(w->'cancelled') and cp_v_plan(w->'plan')
  ), false) $$;

create or replace function cp_check(ok boolean, what text, p_data jsonb, p_max_bytes int) returns void
language plpgsql immutable as $$
begin
  if p_data is null or octet_length(p_data::text) > p_max_bytes or not coalesce(ok, false) then
    raise exception 'invalid %', what using errcode = '22023';
  end if;
end $$;

-- ---------- functions (the only way in) ----------

create or replace function cp_group_id(p_secret text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare gid uuid;
begin
  select id into gid from cp_groups where secret = p_secret;
  if gid is null then raise exception 'invalid key' using errcode = '28000'; end if;
  return gid;
end $$;

create or replace function cp_load(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  return jsonb_build_object(
    'settings', (select settings from cp_groups where id = gid),
    'families', coalesce((select jsonb_agg(data || jsonb_build_object('id', id, 'updatedAt', updated_at))
                          from cp_families where group_id = gid), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'familyId', family_id, 'data', data, 'updatedAt', updated_at))
                           from cp_responses where group_id = gid and week >= cp_retention_start()), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'data', data, 'updatedAt', updated_at))
                       from cp_weeks where group_id = gid and week >= cp_retention_start()), '[]'::jsonb),
    'retainFrom', cp_retention_start()
  );
end $$;

create or replace function cp_save_settings(p_secret text, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  perform cp_purge(gid);
  perform cp_check(cp_v_settings(p_settings), 'settings', p_settings, 20000);
  update cp_groups set settings = p_settings where id = gid;
end $$;

create or replace function cp_save_family(p_secret text, p_family jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  perform cp_purge(gid);
  perform cp_check(cp_v_family(p_family), 'family', p_family, 20000);
  insert into cp_families (group_id, id, data, updated_at)
  values (gid, p_family->>'id', p_family - 'id' - 'updatedAt', now())
  on conflict (group_id, id) do update set data = excluded.data, updated_at = now();
end $$;

-- Removes the family and its answers, and scrubs it from stored plans: its per-family entries
-- (answer fingerprint, source, fairness value) are deleted and every reference to its ID becomes
-- "x-removed", so other families' history and fairness stay correct but no link to it remains.
create or replace function cp_delete_family(p_secret text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
begin
  perform cp_purge(gid);
  if p_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid family id' using errcode = '22023'; end if;
  update cp_weeks
     set data = replace((data #- array['plan','fingerprints',p_id] #- array['plan','sources',p_id] #- array['plan','rates',p_id])::text,
                        '"' || p_id || '"', '"x-removed"')::jsonb,
         updated_at = now()
   where group_id = gid and strpos(data::text, '"' || p_id || '"') > 0;
  delete from cp_responses where group_id = gid and family_id = p_id;
  delete from cp_families  where group_id = gid and id = p_id;
end $$;

-- p_data null = clear this family's answer for the week.
create or replace function cp_save_response(p_secret text, p_week date, p_family_id text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
declare kid_ids jsonb;
begin
  perform cp_purge(gid);
  if p_data is null then
    delete from cp_responses where group_id = gid and week = p_week and family_id = p_family_id;
    return;
  end if;
  if p_week < cp_retention_start() then raise exception 'week outside retention period' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(k->'id'), '[]'::jsonb) into kid_ids
    from cp_families f, jsonb_array_elements(f.data->'kids') k
   where f.group_id = gid and f.id = p_family_id;
  if not exists (select 1 from cp_families where group_id = gid and id = p_family_id) then
    raise exception 'unknown family' using errcode = '22023';
  end if;
  perform cp_check(cp_v_response(p_data, kid_ids), 'answer', p_data, 20000);
  insert into cp_responses (group_id, week, family_id, data, updated_at)
  values (gid, p_week, p_family_id, p_data, now())
  on conflict (group_id, week, family_id) do update set data = excluded.data, updated_at = now();
end $$;

-- p_if_absent = true: only store the plan if no plan is stored yet (used to lock the plan at the
-- deadline, so two phones locking at the same moment can't produce two different plans).
-- Returns the week record as stored afterwards.
create or replace function cp_save_week(p_secret text, p_week date, p_data jsonb, p_if_absent boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid uuid := cp_group_id(p_secret);
declare result jsonb;
begin
  perform cp_purge(gid);
  if p_week < cp_retention_start() then raise exception 'week outside retention period' using errcode = '22023'; end if;
  perform cp_check(cp_v_week(p_data), 'week', p_data, 300000);
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

-- ---------- permissions ----------

-- Old helper from an earlier version of this file.
drop function if exists cp_check(jsonb, int);

do $$
declare f record;
begin
  -- Close every cp_ function to the public API first …
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'cp\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- … then open only the seven entry points the web page uses.
grant execute on function cp_load(text), cp_save_settings(text, jsonb),
  cp_save_family(text, jsonb), cp_delete_family(text, text),
  cp_save_response(text, date, text, jsonb), cp_save_week(text, date, jsonb, boolean) to anon, authenticated;

-- ---------- daily clean-up (optional, needs the pg_cron extension) ----------
-- Supabase offers pg_cron as "Cron" (Integrations, or Database → Extensions). If it can't be enabled,
-- old data is still deleted on every save; only a group nobody uses at all would keep its old rows.
do $$
begin
  create extension if not exists pg_cron;
  begin perform cron.unschedule('cp-retention'); exception when others then null; end;
  perform cron.schedule('cp-retention', '23 3 * * *', 'select public.cp_purge_all()');
  raise notice 'Daily clean-up scheduled (pg_cron job cp-retention).';
exception when others then
  raise notice 'pg_cron not available (%): old data is only deleted on saves.', sqlerrm;
end $$;

-- ---------- create your group (run once) ----------
-- After running everything above, run this line on its own and copy the 'secret' it returns:
--
--   insert into cp_groups default values returning secret;
