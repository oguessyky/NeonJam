# NeonJam — agent notes

NeonJam is a **collaborative party jukebox for YouTube Music**. It is the opposite of
its sibling NeonWave: it **stores and downloads nothing**. Playback is YouTube's
embedded IFrame player; the backend is a stateless WebSocket relay + a thin search proxy.

## Architecture (see DESIGN.md for the 22 design decisions)

- **Host-authoritative**: the host browser owns all state (queue, votes, playback).
- **Relay** (`relay/server.ts`): dumb WS router — rooms, message routing, reconnect
  grace, capacity. Holds only ephemeral socket-routing state. No persistence.
- **Search proxy** (`lib/innertube.ts` + `app/api/*`): server-only `youtubei.js`
  (InnerTube). The only thing that talks to YouTube's API. Returns metadata + videoIds.
- **Round-robin engine** (`lib/roundrobin.ts`): pure, unit-tested. Strict rounds,
  votes rank within a contributor's turn, no per-person cap.

## Running

Two processes: `npm run relay` (port 3061) + `npm run dev` (port 3060). Hosting is
desktop-only by design (#19).

## Conventions

- TypeScript strict. `npm run typecheck` must pass.
- Match the sibling stack: Next 16 App Router, React 19, Tailwind v4, zod, Phosphor icons.
- No database, no downloads, no media bytes — ever. If a feature needs storage, it's
  the wrong feature for NeonJam (revisit the design first).

## Git / commits

Do NOT add a `Co-Authored-By:` trailer. Human contributor only.
