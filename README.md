# NeonJam 🎶

A **party jukebox for YouTube Music**. One screen (a laptop at the speakers) plays;
everyone else queues, votes, and controls it from their phone. **Nothing is
downloaded or stored** — playback is YouTube's own embedded player, and the server
is a dumb relay that keeps no state.

See [DESIGN.md](DESIGN.md) for the full decision record (22 resolved decisions).

## How it works

- **Host** (desktop only) opens `/host`, gets a room code + QR, and runs the hidden
  YouTube IFrame player. The host browser is the **single source of truth**.
- **Guests** scan the QR / enter the code, pick a name (no accounts), then search
  YouTube Music or paste a link to add songs.
- Playback rotates **round-robin** across contributors (one song per turn, votes rank
  within a turn); the host is the DJ (skip / reorder / remove / kick / lock).
- The queue empties → **autoplay radio** keeps it going.
- All coordination flows over a thin WebSocket **relay** — no database.

```
 guest phones ──intents──▶  RELAY  ──▶  HOST browser (authoritative)
      ▲                    (dumb WS)         │  round-robin engine
      └──────── state broadcast ─────────────┘  YouTube IFrame player
                                                 ▲
                          /api/search /api/resolve /api/radio  (InnerTube proxy)
```

## Running locally (two processes)

Install once:

```bash
npm install
```

Terminal 1 — the WebSocket relay:

```bash
npm run relay
```

Terminal 2 — the Next.js app:

```bash
npm run dev
```

Then open **http://localhost:3060** on a computer to host, and open the room URL
(or scan the QR) on phones to join. On the same machine you can simulate guests in
separate browser tabs/windows.

- Next.js dev server: port **3060**
- Relay WebSocket server: port **3061** (override with `RELAY_PORT`)
- Client relay URL override: `NEXT_PUBLIC_RELAY_URL` (defaults to `ws://<host>:3061`)

## Layout

| Path | What |
|------|------|
| `relay/server.ts` | Dumb WS relay: rooms, routing, reconnect grace, capacity. |
| `lib/roundrobin.ts` | Pure round-robin engine (strict rounds, vote ranking). |
| `lib/use-host.ts` | Host controller: authoritative state, player, intents, broadcast. |
| `lib/use-guest.ts` | Guest remote controller. |
| `lib/innertube.ts` | Server-only YouTube Music search / resolve / radio. |
| `lib/protocol.ts` | Wire messages + zod validation. |
| `app/api/*` | Search / resolve / radio proxy routes. |
| `app/host` · `app/j/[code]` | Host room · guest remote pages. |

## Known limits (by design)

- The host embed does **not** get YouTube Premium (ads possible, no background play).
- Hosting is **desktop-only** — mobile browsers suspend audio on lock.
- Search uses YouTube's **unofficial** InnerTube API (via `youtubei.js`); it can break
  if Google changes it — the URL-paste path is the fallback.
- A room is **ephemeral**: it ends if the host truly leaves (a ~60s refresh grace aside).
