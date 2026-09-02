@AGENTS.md

# What NeonJam is
A **collaborative party jukebox for YouTube Music**. A desktop **host** at the speakers
plays audio; **guests** join from phones to search, queue, upvote, and see a live synced
"now playing". It is the deliberate inverse of its sibling NeonWave.

Full design rationale (22 resolved decisions): [DESIGN.md](DESIGN.md). Run/layout: [README.md](README.md).

# Git / Commits
Do NOT add a `Co-Authored-By:` trailer to commit messages (no AI/Claude co-author). The commit
author and committer must be the human contributor only.

# The one hard rule: NOTHING is stored or downloaded
**No database. No AssetHub. No media bytes. No disk writes. Ever.** This is the whole point.
- Playback = YouTube's own **IFrame player** embedded in the host browser (no download).
- Search/metadata = a **stateless proxy** over YouTube's InnerTube API — returns ids + metadata,
  never media.
- Coordination = a **dumb WebSocket relay** that holds only ephemeral socket-routing state.
- If a feature seems to need persistence (a DB, a cache of media, a file), it is the wrong
  feature for NeonJam — revisit [DESIGN.md](DESIGN.md) before building it.

> NOTE: this project has NO Neon/Postgres/Drizzle, NO AssetHub, NO ingest worker, NO `db/` — if
> you're pattern-matching from NeonWave, stop. None of that exists here.

# Architecture (host-authoritative)
The **host browser is the single source of truth** — it owns the queue, votes, and playback state.
- [relay/server.ts](relay/server.ts) — dumb WS router: rooms, message routing, host/guest reconnect
  grace, capacity (~20). No queue logic, no persistence.
- [lib/roundrobin.ts](lib/roundrobin.ts) — **pure, unit-tested** queue engine: strict rounds, votes
  rank within a contributor's turn, no per-person cap. Change carefully; keep it pure and tested.
- [lib/use-host.ts](lib/use-host.ts) — host controller: authoritative state, IFrame player, processes
  relayed guest intents, broadcasts `PublicState`, localStorage snapshot for reconnect.
- [lib/use-guest.ts](lib/use-guest.ts) — thin guest remote: sends intents, renders host state.
- [lib/innertube.ts](lib/innertube.ts) — the ONLY module that talks to YouTube (server-only,
  `youtubei.js`). Exposed via [app/api/search](app/api/search), `/api/resolve`, `/api/radio`.
- [lib/protocol.ts](lib/protocol.ts) — wire messages; guest-supplied payloads are zod-validated here.
- Pages: [app/host](app/host) (host room), [app/j/[code]](app/j/[code]) (guest remote).

Data flow: guest intents ──▶ relay ──▶ host (authoritative) ──state broadcast──▶ guests.

# Running locally (TWO processes)
Both are required:
- `npm run dev` — Next.js app on port **3060**.
- `npm run relay` — WebSocket relay on port **3061** (`RELAY_PORT` to override; client override
  `NEXT_PUBLIC_RELAY_URL`).

Hosting is **desktop-only by design** (#19) — mobile browsers suspend audio on screen-lock, so the
landing page blocks phones from hosting. Test guests via separate browser tabs/windows.

Before committing: `npm run typecheck` must pass. If you touch the round-robin logic, re-run its
tests (see the test approach in the commit that added [lib/roundrobin.ts](lib/roundrobin.ts)).

# Watch-items (see DESIGN.md "Key risks")
- InnerTube is **unofficial** and can break when Google changes it — the URL-paste path is the
  fallback; degrade gracefully, never hard-crash search.
- Some videos are `embeddable: false` → the host auto-skips them; don't assume every id plays.
- YouTube Premium does NOT apply to the host embed (ads possible) — accepted tradeoff, not a bug.
