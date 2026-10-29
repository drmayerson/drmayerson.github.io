-- Dansles carpool — production self-check.
-- Paste into Supabase → SQL Editor → Run, after schema.sql. It creates a temporary test group,
-- runs every check as the public web role ("anon"), deletes the test group again and shows a
-- table of results. It never reads or changes your real group.

create temp table if not exists cp_selftest (n serial, check_name text, passed boolean, detail text);
truncate cp_selftest;
create temp table if not exists cp_selftest_key (secret text, old_secret text);
truncate cp_selftest_key;
insert into cp_groups (secret) values ('selftest-' || encode(gen_random_bytes(12), 'hex'));
insert into cp_selftest_key (secret) select secret from cp_groups where secret like 'selftest-%' order by created_at desc limit 1;
-- Scratch tables for this session only (they disappear when the session ends). Row-level security is
-- on with a policy that lets the test role write its results, so the editor's RLS warning doesn't apply.
alter table cp_selftest enable row level security;
alter table cp_selftest_key enable row level security;
drop policy if exists cp_selftest_all on cp_selftest;
drop policy if exists cp_selftest_key_all on cp_selftest_key;
create policy cp_selftest_all on cp_selftest for all using (true) with check (true);
create policy cp_selftest_key_all on cp_selftest_key for all using (true) with check (true);
grant all on cp_selftest, cp_selftest_key to anon;
grant usage on sequence cp_selftest_n_seq to anon;

set role anon;
do $$
declare
  k text := (select secret from cp_selftest_key);
  r text;
  j jsonb;
  w date := current_date;
  plan jsonb := '{"plan":{"version":1,"legs":{"to":{"participants":["f-selftest","f-other"],"cars":[{"driverId":"f-other","riders":["f-selftest"],"seats":3,"ownKids":1,"km":2.5}],"unassigned":[],"seatsShort":0},"from":{"participants":[],"cars":[],"unassigned":[],"seatsShort":0}},"fingerprints":{"f-selftest":"k1|need|need"},"rates":{"f-selftest":0.4}}}';
begin
  -- access control
  begin perform cp_load('not-the-key'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('wrong key is refused', r like '%invalid key%', r);
  begin perform 1 from cp_families limit 1; r := 'readable'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('tables cannot be read directly', r like '%permission denied%', r);
  begin perform cp_group_id(k); r := 'callable'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('key checker is internal', r like '%permission denied%', r);
  begin perform cp_purge_all(); r := 'callable'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('clean-up is internal', r like '%permission denied%', r);
  begin j := cp_load(k); r := 'ok'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('correct key loads', r = 'ok', r);

  -- validation
  begin perform cp_save_family(k, '{"id":"f-selftest","name":123,"kids":"invalid"}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('malformed family is refused', r like '%invalid family%', r);
  begin perform cp_save_family(k, '{"id":"f-selftest","name":"Test","kids":[{"id":"k1","name":"Kid"}],"seats":3,"usual":null}'); r := 'ok'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('valid family is saved', r = 'ok', r);
  begin perform cp_save_response(k, w, 'f-nobody', '{"kids":[],"to":{"status":"need"},"from":{"status":"need"}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('answer for unknown family is refused', r like '%unknown family%', r);
  begin perform cp_save_response(k, w, 'f-selftest', '{"kids":["k1"],"to":{"status":"maybe"},"from":{"status":"need"}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('answer with unknown status is refused', r like '%invalid answer%', r);
  begin perform cp_save_response(k, w, 'f-selftest', '{"kids":["k99"],"to":{"status":"need"},"from":{"status":"need"}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('answer with unknown child is refused', r like '%invalid answer%', r);
  begin perform cp_save_response(k, w, 'f-selftest', '{"kids":["k1"],"to":{"status":"can","seats":3},"from":{"status":"need"}}'); r := 'ok'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('valid answer is saved', r = 'ok', r);
  begin perform cp_save_week(k, w, '{"plan":{"legs":"nonsense"}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('malformed plan is refused', r like '%invalid week%', r);
  -- missing required fields must be refused too (not only wrong types)
  begin perform cp_save_week(k, w, '{"plan":{}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('empty plan object is refused', r like '%invalid week%', r);
  begin perform cp_save_week(k, w, '{"plan":{"version":1}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('plan without legs is refused', r like '%invalid week%', r);
  begin perform cp_save_week(k, w, '{"plan":{"legs":{"to":{"participants":[],"cars":[],"unassigned":[]}}}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('plan missing one direction is refused', r like '%invalid week%', r);
  begin perform cp_save_week(k, w, '{"plan":{"legs":{"to":{},"from":{}}}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('plan missing participants/cars/unassigned is refused', r like '%invalid week%', r);
  begin perform cp_save_week(k, w, '{"plan":{"legs":{"to":{"participants":[],"cars":[{"riders":[]}],"unassigned":[]},"from":{"participants":[],"cars":[],"unassigned":[]}}}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('car missing driver/seats is refused', r like '%invalid week%', r);
  begin perform cp_save_family(k, '{"id":"f-selftest2","name":"X","kids":[{"name":"No id"}],"seats":3}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('child without ID is refused', r like '%invalid family%', r);
  begin perform cp_save_family(k, '{"id":"f-selftest2","kids":[{"id":"k1","name":"Kid"}],"seats":3}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('family without name is refused', r like '%invalid family%', r);
  begin perform cp_save_response(k, w, 'f-selftest', '{"kids":["k1"],"to":{"status":"need"}}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('answer missing a direction is refused', r like '%invalid answer%', r);
  begin perform cp_save_week(k, w, '{"plan":{"legs":{"to":{"participants":[],"cars":[],"unassigned":[]},"from":{"participants":[],"cars":[],"unassigned":[]}}}}'); r := 'ok'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('minimal complete plan is accepted', r = 'ok', r);

  begin perform cp_save_settings(k, '{"weekday":9}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('malformed settings are refused', r like '%invalid settings%', r);

  -- retention
  begin perform cp_save_week(k, current_date - 500, '{"cancelled":true}'); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('writes older than the retention period are refused', r like '%retention%', r);

  -- deleting a family scrubs it from stored plans
  begin
    perform cp_save_week(k, w, plan);
    perform cp_delete_family(k, 'f-selftest');
    j := cp_load(k);
    r := case when strpos(j::text, 'f-selftest') = 0 and strpos(j::text, 'x-removed') > 0 then 'ok' else j::text end;
  exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('deleting a family removes it from stored plans', r = 'ok', left(r, 200));
end $$;
reset role;

-- retention really deletes: plant expired rows directly (as owner), then trigger each clean-up path
insert into cp_responses (group_id, week, family_id, data)
  select id, current_date - 500, 'f-old', '{}'::jsonb from cp_groups where secret = (select secret from cp_selftest_key);
insert into cp_weeks (group_id, week, data)
  select id, current_date - 500, '{}'::jsonb from cp_groups where secret = (select secret from cp_selftest_key)
  on conflict do nothing;
set role anon;
do $$
declare k text := (select secret from cp_selftest_key); r text;
begin
  begin perform cp_save_settings(k, '{"groupName":"selftest"}'); r := 'ok'; exception when others then r := sqlerrm; end;
end $$;
reset role;
insert into cp_selftest (check_name, passed, detail)
select 'expired rows are deleted by a save',
       not exists (select 1 from cp_responses r join cp_groups g on g.id = r.group_id where g.secret like 'selftest-%' and r.week < cp_retention_start())
   and not exists (select 1 from cp_weeks w join cp_groups g on g.id = w.group_id where g.secret like 'selftest-%' and w.week < cp_retention_start()),
       'planted 2 rows 500 days old, then saved settings';
insert into cp_weeks (group_id, week, data)
  select id, current_date - 500, '{}'::jsonb from cp_groups where secret = (select secret from cp_selftest_key)
  on conflict do nothing;
select cp_purge_all();
insert into cp_selftest (check_name, passed, detail)
select 'expired rows are deleted by the daily clean-up command',
       not exists (select 1 from cp_weeks w join cp_groups g on g.id = w.group_id where g.secret like 'selftest-%' and w.week < cp_retention_start()),
       'planted 1 row 500 days old, then ran cp_purge_all()';

-- daily clean-up job: configured? and has it run?
do $$
declare j record; run record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    insert into cp_selftest (check_name, passed, detail) values ('daily clean-up job is configured', false, 'pg_cron not installed: old data is only deleted when someone saves');
    return;
  end if;
  execute $q$select jobid, schedule, command, active from cron.job where jobname = 'cp-retention'$q$ into j;
  insert into cp_selftest (check_name, passed, detail) values ('daily clean-up job is configured',
    j.jobid is not null and j.active and j.schedule = '23 3 * * *' and j.command = 'select public.cp_purge_all()',
    coalesce(format('active=%s schedule=%s command=%s', j.active, j.schedule, j.command), 'job cp-retention not found'));
  if j.jobid is null then return; end if;
  execute $q$select status, return_message, start_time from cron.job_run_details where jobid = $1 order by start_time desc limit 1$q$ into run using j.jobid;
  insert into cp_selftest (check_name, passed, detail) values ('daily clean-up job: last run',
    case when run.status is null then null else run.status = 'succeeded' end,
    case when run.status is null then 'has not run yet (runs daily at 03:23 UTC)'
         else format('%s at %s: %s', run.status, run.start_time, run.return_message) end);
end $$;

-- key rotation: the old key must stop working
update cp_selftest_key set old_secret = secret;
update cp_groups set secret = 'selftest-' || encode(gen_random_bytes(12), 'hex') where secret = (select old_secret from cp_selftest_key);
set role anon;
do $$
declare r text;
begin
  begin perform cp_load((select old_secret from cp_selftest_key)); r := 'accepted'; exception when others then r := sqlerrm; end;
  insert into cp_selftest (check_name, passed, detail) values ('old key fails after rotation', r like '%invalid key%', r);
end $$;
reset role;

-- remove the test group (and everything in it)
delete from cp_groups where secret like 'selftest-%';

select n as "#", check_name as "check", case when passed then 'PASS' when passed is null then 'INFO' else 'FAIL' end as result, detail
from cp_selftest order by n;
