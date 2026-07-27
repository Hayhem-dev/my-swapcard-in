# EA Summit — Swapcard Check-in Scanner

A phone-camera QR scanner that checks attendees into Swapcard on the spot.
No app install — it's a web page your phone opens in the browser.

## How it works

```
Phone camera  →  scans badge QR  →  this server  →  Swapcard Content API
                                       (holds your          (looks up the
                                        API key)             registration,
                                                              then sets
                                                              checkIn = now)
```

The API key never touches the phone/browser — it lives only in the server's
`.env` file. That matters because the key can also *cancel* registrations,
so it should be treated like a password.

## 1. Get your Swapcard credentials

You need two things, scoped to your event:

- **API key** — from Studio → Developer API & Webhooks, or request one from
  `dev@swapcard.com` scoped to just your event.
- **Event ID** — visible in your event's Studio URL, or fetch it by querying
  the `events` list with your API key.

## 2. Verify the exact schema fields once you have access

I've wired this up against Swapcard's documented Content API shape
(`eventPeople` filtered by `confirmationCode`, `updateRegistration` with a
`checkIn` timestamp) — see `server.js`. Before going live:

1. Open the GraphQL API Explorer linked from your Studio's Developer API
   page (or swapcard.dev) with your real API key.
2. Confirm what code is actually encoded in your badges' QR — it may be
   `confirmationCode`, a separate `barcode`/`badgeCode` field, or the
   `EventPerson` ID depending on how your registration was set up.
3. Adjust the `code` filter field name in `server.js` → `FIND_PERSON_QUERY`
   if it differs.

This is the one part I can't verify without live access to your event's
schema, so test it against a couple of real badges before the summit.

## 3. Run it locally

```bash
npm install
cp .env.example .env
# edit .env and paste in SWAPCARD_API_KEY and SWAPCARD_EVENT_ID
npm start
```

Visit `http://localhost:3000` on your computer to confirm it loads.

## 4. Get it on your phone

Phone browsers only allow camera access over **HTTPS** (or `localhost`), so
for onsite use you'll need to deploy it somewhere with a real HTTPS URL.
Easiest options:

- **Render / Railway / Fly.io** — push this folder, set `SWAPCARD_API_KEY`
  and `SWAPCARD_EVENT_ID` as environment variables in their dashboard
  (never commit `.env`), and they give you an HTTPS URL automatically.
- **A laptop + ngrok** — run `npm start` on a laptop at the venue, then
  `ngrok http 3000` to get a temporary HTTPS URL to open on phones.

Once deployed, open the HTTPS URL on any phone, allow camera access, and
start scanning. Each scan flashes green ("Checked in") or red (already
checked in / not found), with a manual text-entry fallback underneath for
damaged badges or handheld barcode scanners.

## Notes

- Scanning the same badge twice in a row is debounced (2 seconds) so it
  doesn't double-fire, and a second scan of an already-checked-in badge
  shows a clear red "Already checked in" rather than erroring.
- The running count in the header is just this device's session count
  (not pulled from Swapcard), useful as a quick sanity check at the door.
