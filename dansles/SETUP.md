# Going live: Supabase + GitHub Pages

About 20 minutes, once. Afterwards parents only ever open one link.

You need: a free Supabase account and your GitHub account (`drmayerson`, site `drmayerson.github.io`).

## 1. Create the database (Supabase)

1. Go to <https://supabase.com>, sign up (GitHub login is fine) and click **New project**.
   - Name: `carpool` (anything works)
   - Database password: generate one and store it in your password manager (the app never needs it)
   - Region: **Central EU (Frankfurt)**, closest to Belgium
2. Wait until the project is ready (1–2 minutes).
3. Open **SQL Editor** (left sidebar) → **New query**. Paste the full contents of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned".
4. Make a new query with just this line and run it:

   ```sql
   insert into cp_groups default values returning secret;
   ```

   Copy the 32-character code it returns. This is the **group key**: whoever has it can open the app, so treat it like the WhatsApp group itself.
5. Open **Project Settings → API Keys** (older dashboards: **Settings → API**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`, under *Data API* in newer dashboards)
   - the **anon / publishable** key. *Not* the `service_role` / secret key.

## 2. Fill in `config.js`

```js
window.CARPOOL_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJ… or sb_publishable_…',
};
```

The anon key is meant to be public. It can only call the app's functions, and every function refuses to do anything without the group key from step 1.4, so nothing is readable through the app's API without the invite link.

The data is not end-to-end encrypted: it travels over HTTPS and Supabase encrypts its disks, but anyone who can log in to your Supabase account can read it. **Turn on two-factor authentication** for your Supabase and GitHub accounts.

## 3. Put the app on your site (GitHub Pages)

Upload these files and folders into a folder of your `drmayerson.github.io` repository, for example `dansles/`:

```
index.html
styles.css
config.js
fonts/      (self-hosted fonts, so the page makes no requests to Google)
src/        (all files)
vendor/     (preact-htm.js, supabase.js)
```

Leave out `tests/`, `tools/`, `dist/`, `supabase/` and the `.md` files; they aren't needed on the site (they don't hurt either).

On github.com: open the repository → **Add file → Upload files** → drag the files and the three folders in → **Commit changes**. After a minute the app is at `https://drmayerson.github.io/dansles/`.

The page asks search engines not to index it, and it shows nothing without the group key.

## 4. First use

1. Open `https://drmayerson.github.io/dansles/#k=YOUR_GROUP_KEY` on your phone.
2. **Instellingen**: group name, lesson day and times, answer deadline, and the dance studio's address (tap *Zoek op kaart*, or paste the coordinates from Google Maps). Save.
3. **Gezinnen**: add the families with their address, seats and their usual pattern (or let each parent add their own family).
4. Post the **invite link** (with `#k=…`; Instellingen → *Kopieer uitnodigingslink*) in the WhatsApp group yourself, ideally as a pinned message. Each parent opens it once, taps their child under *Wie ben jij?*, and their phone remembers the key. After that the plain address `https://drmayerson.github.io/dansles/` is enough. Tip for parents: *Add to Home Screen* makes it feel like an app.

   The reminder and schedule messages the app prepares contain only the plain address, never the key, so sharing them through WhatsApp's share button doesn't pass the key to WhatsApp's servers.

## Good to know

- **History starts the first time someone uses the app**, so the fairness rotation builds up over the first few weeks. To make it start later, change *Historiek vanaf* in Instellingen.
- **Free Supabase projects pause after about a week without any use.** During the school year someone opens the app weekly, so this shouldn't happen; after a long holiday you may need to click **Restore** in the Supabase dashboard (no data is lost).
- **Who has access**: everyone with the invite link can see and change everything; there are no personal accounts (a deliberate choice for a small, trusted group). Leaving the WhatsApp group does not remove access by itself.
- **New group key** (if the link ends up somewhere it shouldn't, or someone leaves the group): run
  `update cp_groups set secret = encode(gen_random_bytes(16), 'hex') returning secret;`
  and share the new invite link. The old key stops working immediately; everyone opens the new link once.
- **Updating the database code**: when `supabase/schema.sql` changes, paste the whole file into the SQL Editor again and run it. It is safe to re-run and keeps all data.
- **Checking the live database**: paste `supabase/check.sql` into the SQL Editor and run it. It uses a temporary test group (never your real one), deletes it afterwards, and shows a PASS/FAIL table for access control, validation, retention, deleting a family and key rotation. All rows should say PASS. If only the pg_cron row fails, enable *Cron* (Integrations, or Database → Extensions → `pg_cron`) and run `schema.sql` once more.
- **Retention**: answers and week records are kept for 400 days. Older ones are deleted on every save and once a day (pg_cron), can't be written again, and are never rebuilt by the app.
- **Deleting a family** removes the family and all its answers. In stored week plans its ID is replaced by "removed" and its own entries are deleted; what remains is that a (removed) family took part, kept so the other families' rotation stays correct.
- **Backups**: the free Supabase plan includes no automatic backups (daily backups start on the paid Pro plan). For a safety copy, export the four `cp_` tables as CSV from the Table Editor now and then, or use `supabase db dump` with the Supabase CLI. Keep such copies private: they contain the families' data.
- **Trying things without affecting the group**: with an empty `config.js` the app runs as a demo with example families, stored only in that browser. (Opening `index.html` straight from your disk won't work; browsers block that for module scripts. Use the site, or `npx serve` locally.)
- **Running the algorithm tests** (optional, needs Node.js): `node --test tests/*.test.js`.
