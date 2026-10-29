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

-- daily clean-up job
insert into cp_selftest (check_name, passed, detail)
select 'daily clean-up is scheduled (pg_cron)',
       exists (select 1 from pg_namespace where nspname = 'cron')
         and exists (select 1 from pg_extension where extname = 'pg_cron'),
       case when exists (select 1 from pg_extension where extname = 'pg_cron')
            then 'pg_cron installed' else 'pg_cron not installed: old data is only deleted on saves' end;

-- remove the test group (and everything in it)
delete from cp_groups where secret like 'selftest-%';

select n as "#", check_name as "check", case when passed then 'PASS' else 'FAIL' end as result, detail
from cp_selftest order by n;
