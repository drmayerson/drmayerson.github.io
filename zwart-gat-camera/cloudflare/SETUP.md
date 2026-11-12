# Photo service for the QR-code mode (Cloudflare)

With **Foto's → QR-code tonen** switched on, every photo is uploaded to a small service of
your own. The page then shows a QR code; the visitor scans it and gets a page with their
photo and a download button. Photos are deleted automatically after **24 hours**.

The service is one file, [`worker.js`](worker.js), running as a Cloudflare Worker. The free
Cloudflare plan is enough for a booth: up to about 1,000 photos per day and roughly 1 GB
of photos online at any time. You only need a free Cloudflare account, no software.

Setting it up takes about 15 minutes, once.

## 1. Create a Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up> (free plan). No website or domain is needed.

## 2. Create the storage (Workers KV)

1. In the dashboard, open **Storage & databases → Workers KV** (on older layouts:
   **Workers & Pages → KV**).
2. **Create** a namespace, for example called `zwart-gat-fotos`.

KV deletes every photo by itself 24 hours after the upload.

## 3. Create the Worker

1. Open **Workers & Pages → Create → Worker** (choose the "Hello World" starting point).
2. Name it, for example `zwart-gat-fotos`, and click **Deploy**.
3. Click **Edit code**, delete everything in the editor, paste the full contents of
   [`worker.js`](worker.js), and click **Deploy** again.
4. Note the address of the Worker, something like
   `https://zwart-gat-fotos.<your-account>.workers.dev`.

## 4. Connect the storage and set the booth key

In the Worker, open **Settings**:

1. **Bindings → Add → KV namespace**. Variable name: `PHOTOS_KV` (exactly like this);
   namespace: the one from step 2.
2. **Variables and Secrets → Add**:
   - Type **Secret**, name `BOOTH_KEY`, value: a long password you make up, e.g. four
     random words. Only devices that know this key can upload photos.
   - Type **Text**, name `ALLOWED_ORIGIN`, value `https://drmayerson.github.io`
     (so only the camera page can use the service from a browser).
3. Click **Deploy** if the dashboard asks for it.

Check: opening the Worker address in a browser shows
"Zwart gat camera: fotodienst actief."

## 5. Set up the booth computer

On the booth computer, open the camera page, then in **Instellingen → Foto's**:

1. Tick **Klik in het beeld … om een foto te maken** and **QR-code tonen**.
2. **Adres van de fotodienst**: the Worker address from step 3.
3. **Standsleutel**: the `BOOTH_KEY` from step 4.
4. Click **Verbinding testen**. It should say "Verbinding in orde".

The browser on that computer remembers these settings. Optionally also keep
**Opslaan op deze computer** ticked, to keep your own copy of every photo.

At the booth:

- **Click or arrow key**: take a photo. The QR code shows until the next photo, or for
  30 seconds at most.
- **Q key or the small "QR" button (bottom right)**: show the most recent QR code again.
  Press again to go further back, for someone who missed theirs. A thumbnail shows
  which photo it is.
- **Esc**: hide the QR code.

## Privacy

Photos of visitors (possibly children) leave the booth computer in this mode. Put a short
notice at the booth, for example:

> *Met de QR-code download je je foto. Hij staat 24 uur online via een geheime link en
> wordt daarna automatisch gewist.*

Check whether your organisation has its own rules for photographing visitors.

The links are unguessable (128 random bits), the pages are marked "noindex", and nothing
other than the photo and its file name is stored.

## Alternative: R2 storage instead of KV

R2 has no daily upload limit worth worrying about, but Cloudflare requires a payment
method on file to switch it on (the free tier is still free). To use it instead of KV:

1. **R2 → Create bucket**, e.g. `zwart-gat-fotos`.
2. In the bucket: **Settings → Object lifecycle rules → Add rule**: delete objects
   **1 day** after upload.
3. In the Worker: **Bindings → Add → R2 bucket**, variable name `PHOTOS` (and remove the
   `PHOTOS_KV` binding).

The Worker refuses to show any photo older than 24 hours either way.

## If something doesn't work

- **"verkeerde standsleutel"**: the key in Instellingen differs from `BOOTH_KEY`.
- **"adres niet bereikbaar"**: check the Worker address (it starts with `https://`), and
  that `ALLOWED_ORIGIN` is exactly `https://drmayerson.github.io` (no slash at the end).
- **Upload fails at the booth** (no internet): the photo is saved on the booth computer
  instead, and a message says so.
- **"Je foto wordt klaargezet…" on the phone**: KV can take a few seconds to make a new
  photo available everywhere; the page refreshes by itself.
