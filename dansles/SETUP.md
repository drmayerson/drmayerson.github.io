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

The anon key is meant to be public. It can only call the app's functions, and every function refuses to do anything without the group key from step 1.4, so nothing is readable without the link.

## 3. Put the app on your site (GitHub Pages)

Upload these files and folders into a folder of your `drmayerson.github.io` repository, for example `dansles/`:

```
index.html
styles.css
config.js
src/        (all files)
vendor/     (preact-htm.js, supabase.js)
```

Leave out `tests/`, `tools/`, `dist/`, `supabase/` and the `.md` files; they aren't needed on the site (they don't hurt either).

On github.com: open the repository → **Add file → Upload files** → drag the files and the two folders in → **Commit changes**. After a minute the app is at `https://drmayerson.github.io/dansles/`.

The page asks search engines not to index it, and it shows nothing without the group key.

## 4. First use

1. Open `https://drmayerson.github.io/dansles/#k=YOUR_GROUP_KEY` on your phone.
2. **Instellingen**: group name, lesson day and times, answer deadline, and the dance studio's address (tap *Zoek op kaart*, or paste the coordinates from Google Maps). Save.
3. **Gezinnen**: add the families with their address, seats and their usual pattern (or let each parent add their own family).
4. Post the link in the WhatsApp group. Each parent opens it once, taps their child under *Wie ben jij?*, and their phone remembers it. Tip for parents: *Add to Home Screen* makes it feel like an app.

## Good to know

- **History starts the first time someone uses the app**, so the fairness rotation builds up over the first few weeks. To make it start later, change *Historiek vanaf* in Instellingen.
- **Free Supabase projects pause after about a week without any use.** During the school year someone opens the app weekly, so this shouldn't happen; after a long holiday you may need to click **Restore** in the Supabase dashboard (no data is lost).
- **New group key** (if the link ends up somewhere it shouldn't): run
  `update cp_groups set secret = encode(gen_random_bytes(16), 'hex') returning secret;`
  and share the new link. Everyone opens it once; their phones then remember the new key.
- **Trying things without affecting the group**: with an empty `config.js` the app runs as a demo with example families, stored only in that browser. (Opening `index.html` straight from your disk won't work; browsers block that for module scripts. Use the site, or `npx serve` locally.)
- **Running the algorithm tests** (optional, needs Node.js): `node --test tests/*.test.js`.
