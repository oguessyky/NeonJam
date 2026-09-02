# NeonJam — Design Spec

A Spotify-Jam-style collaborative listening app for YouTube Music. Client-side
search + playback, **no downloading or storing of media**. One host plays audio;
others join a shared session, contribute to a queue, and stay in sync.

Sibling project to NeonWave (which *does* download/store via AssetHub). NeonJam
deliberately does the opposite: pure media-player/remote-control, zero media bytes
stored.

## Status: BUILT — working vertical slice (all 22 decisions implemented)

Verified end-to-end: host creates room (QR/code), guest joins + searches YouTube Music
(InnerTube), adds songs, host plays via IFrame player with round-robin ordering, live
synced now-playing + queue on the guest, host reconnect grace confirmed. See README.md.

---

## Resolved decisions

### 1. Playback engine → YouTube IFrame Player API
- Host's browser embeds the youtube.com IFrame Player; video region hidden → audio-only feel.
- `music.youtube.com` has NO embeddable player and NO public playback API, so it cannot be
  driven directly. YT Music is just a music frontend over the same content library; every
  track maps to a regular youtube.com video ID (often an auto-generated "art track").
- The "YouTube Music" identity of the app therefore lives in **search/metadata**, not the player.
- Known caveat: some videos are `embeddable: false` → must handle with a skip/fallback path.

### 2. Playback topology → HOST-ONLY audio (party-jukebox model)
- Only the **host device** plays audio out loud (e.g. a laptop at speakers). One playback surface.
- Guests are **thin remotes** on their phones: search/queue/vote/see "now playing" — no audio on guests.
- Huge simplification: **NO multi-device audio sync** needed (no drift/buffering problems). The host
  IS the source of truth for playback state; guests just render it in real time.
- Consequence: YT Premium still doesn't apply to the host's embed (ads possible), but this is accepted.

### 3. Real-time layer requirements (derived)
- Guests need live updates of: now-playing, position, queue contents/order.
- Host needs live updates of: queue additions, votes, reorder/remove requests from guests.
- => a real-time transport between host & guests is required (decided below).

### 4. Add-song input → SEARCH-FIRST + URL-paste fallback
- Primary: in-app search box → requires the InnerTube search proxy (thin, stateless, stores nothing).
- Secondary: paste a YouTube URL (extract video ID directly, no search call needed).

### 5. Session state + transport → HOST-AUTHORITATIVE, thin WS relay, NO DB
- The host browser holds the authoritative queue + playback state (already the source of truth per #2).
- Server = dumb WebSocket relay (routes messages within a room) + separate stateless search proxy.
  Holds only ephemeral socket-routing state; **no database, no persisted data.**
- Session is **ephemeral**: if the host closes/refreshes the tab, the party ends. Accepted for a jukebox.
- Infra implication: relay needs a persistent-connection host (small Node WS server / Durable Object /
  container), NOT pure serverless functions. Search proxy can be a normal serverless/edge HTTP route.

### 6. Joining → QR code + short room code
- Host screen displays a QR (scan → join link) plus a short human-typable room code (e.g. `ABCD`).
- Both resolve to the same join URL. QR for in-person, code/link for remote guests.

### 7. Guest identity → ANONYMOUS + display name (no accounts)
- Guest picks a display name on join; persisted in their own browser (localStorage). No login.
- Enough identity to: attribute songs ("added by Sam"), allow self-removal, enforce per-person limits.

### 8. Governance → HOST DJ + guests add / upvote / self-remove
- Host = benevolent DJ: full override (play/pause/skip/seek/reorder/remove ANY track).
- Guests can: add songs, upvote to influence order, remove their OWN additions.

### 9. Queue ordering → ROUND-ROBIN by contributor, strict rounds, votes rank within a slot
- Play order cycles through **active contributors** (anyone with ≥1 pending song), one song per turn.
- **Passive guests** (added nothing) are NOT in the rotation — they just listen + upvote. No problem caused.
- Within a contributor's turn, their own pending songs are ordered by **upvotes** (top pick surfaces).
- **Strict rounds (chosen):** a round = one pass through the contributors fixed at round start. A song/
  contributor added *after the round has started* (or after their turn passed) **waits for the NEXT round.**
  → latecomers never cut ahead; strictly fair to those already in the current round.
- Single contributor ⇒ degenerates to vote-ranked play for them. Fine.

### 10. Empty-queue behavior → AUTOPLAY RADIO from last song
- When the queue drains, auto-queue related tracks (InnerTube "watch next"/related for last video ID)
  so audio never stops. Radio picks yield to any real user-added song immediately.
- Should be host-toggleable (off ⇒ falls back to "stop + prompt to add"). Radio picks may drift; accepted.

### 11. Duplicates → BLOCK + auto-upvote the existing entry
- Adding a song already in the queue does not create a copy; it auto-upvotes the existing entry and
  notifies the adder ("already queued — bumped it"). No repeats; duplicate-adds feed the vote signal.

### 12. Tech stack → Next.js frontend + colocated Node WS relay server
- Reuse NeonWave-style Next.js app for UI; small `ws`/socket.io process for the room relay.
- Matches the existing two-process dev rhythm (`npm run dev` + a relay process). Self-hosted WS.
- Search proxy = a Next.js route handler (serverless/edge-friendly, stateless).

### 13. Host resilience → localStorage snapshot + reconnect grace (~60s)
- Host continuously snapshots room state (queue, votes, now-playing, position) to localStorage.
- On accidental reload, host restores the SAME room code; guests auto-reconnect within a grace window
  (~60s) instead of the party dying. True host-leave (tab closed past grace) still ends the session.
- Note: the relay must hold a room open briefly after host socket drop to allow this rejoin.

### 14. Per-guest pending cap → NO hard cap by default (round-robin already ensures fairness)
- Key insight: round-robin already bounds *playback* — a guest with 30 queued songs still plays only
  one per round; extras wait (vote-ordered) for future turns. So a cap is NOT a fairness tool.
- A cap would only reduce queue-view clutter + bound snapshot/relay state size. Minor.
- Decision: **default unlimited**, with a **generous host-adjustable soft cap** exposed as an optional
  clutter/hygiene lever. Hosts who want a tighter, snappier rotation can lower it.

---

### 23. Host reorder → "PLAY NEXT" bump lane over round-robin (not free-form manual)
- Round-robin stays the always-on engine (#9). The host does NOT get a free-form manual order.
- Host can **bump** any queued song to "play next"; bumps form an ordered **pinned lane** the host can
  **drag to reorder** and un-pin. Guests can't bump (host-only DJ, #8); they see the resulting order.
- Implementation: `pinned: itemId[]` override. `pickNext` drains still-pending pinned ids first (pure
  override — does NOT touch round-robin's served/round bookkeeping), then falls back to round-robin.
- UI: host queue shows a "Playing next" (pinned, draggable) zone above the "Then (auto)" round-robin
  list; auto rows carry a "↑ play next" control that pins them. Built with the design skill for UX.

### 24. Round-robin rewrite → FIFO-fair, immutable per-song rounds (supersedes votes-in-#9)
Fixes two reported bugs: order was by contributor-join not FIFO, and adding a song reshuffled
the already-queued order / could slip into the current round.
- **Immutable round per song, assigned at add-time** (never recomputed → no reshuffling):
  - contributor who already has pending songs → new song = their max pending round + 1.
  - fresh contributor (new or ran out) → `playingRound + 1` = the round right after the one
    currently playing (the "next round"). Before anything plays, round 1, so early joiners
    share round 1.
- **Within a round: FIFO** by add-time (decision: song order, not join order).
- **A new song joins the NEXT round to play** (appended after songs already in it) — never the
  currently-playing round, never cutting ahead. (Corrected from an earlier mislabeled option.)
- **Votes are now just LIKES** — a popularity count only, they do NOT change play order. Reframe
  the control as a like; play order is purely (round, add-time). Supersedes the vote-ranking in #9.
- Play order = pinned lane (#23) first, then non-pinned sorted by (round, add-time).

## Primary user journey (resolved model)

1. **Host** opens NeonJam on a laptop at the speakers → gets a room with a **QR + short code**;
   the hidden IFrame player is the only audio output.
2. **Guests** scan the QR (or type the code) on phones, pick a **display name** — no login.
3. Guests **search** (InnerTube proxy) or **paste a YouTube URL** to add songs.
4. Playback runs **round-robin across contributors** in **strict rounds**; within a turn, a person's
   songs are ordered by **upvotes**. Passive guests just listen + upvote.
5. **Duplicates** auto-upvote the existing entry instead of re-adding.
6. Host is the **DJ** (skip/reorder/remove anything); guests remove only their own.
7. Queue empties → **autoplay radio** from the last song keeps it alive.
8. Host accidental refresh → **localStorage snapshot + ~60s reconnect grace** restores the party.
9. Everything is **ephemeral** — no media stored/downloaded, no DB; session dies when host truly leaves.

## Open questions / minor polish (deferred, don't reshape the journey)

- **Search scope:** songs-only vs also albums/artists/playlists (adding a whole playlist could flood).
- **Guest progress bar:** do guests see a live read-only position/scrubber for "now playing"?
- **Room capacity:** practical max guests per relay room (sizing the WS server).
- **Skip semantics:** host-only skip (current model) vs optional vote-to-skip toggle.

### 15. Search scope → SONGS (+ videos) only, single-track adds
- Search returns individual tracks; each result adds exactly one song. No album/playlist bulk-add.
- Avoids one-tap flooding of a contributor's round-robin slot and keeps vote/dup logic simple.
- Albums/artists/playlists may still surface as *search categories* later, but adding stays per-track.

### 16. Guest now-playing → LIVE progress bar + full metadata
- Guest screen shows title / artist / cover / "added by" + a **moving progress bar**.
- Sync protocol: host broadcasts position only on **events** (play/pause/seek/song-change); guests
  **interpolate locally** with their own clock between events. Smooth bar, near-zero extra WS traffic.
- Late-joining guest gets a full state snapshot (queue, now-playing, position, server-time anchor) on join.

### 17. Skip → HOST-ONLY for MVP; vote-to-skip as a designed-in fast-follow
- MVP: only the host skips (consistent with #8 DJ override).
- Data model built so a **host-toggleable vote-to-skip** (majority of *present* guests) drops in later
  without rework. No crowd skip at launch.

### 18. Moderation → soft kick + song removal + room lock (1+3 combined)
- Host can: remove ANY song (per #8); **soft-kick** a guest (drop connection, remove their pending
  songs, block that browser session from rejoining); and **lock the room** (a toggle that stops new
  joiners entirely).
- Soft kick is evadable by clearing storage / new session (guests are anonymous, #7) — accepted; it
  deters casual trolls, and room-lock is the hard stop when things go sideways.

### 19. Host device → DESKTOP-ONLY host (phones are guests only)
- Hosting requires a desktop/laptop browser (a foreground tab at the speakers). Mobile devices are
  detected and offered "join as guest" instead of hosting.
- Rationale: mobile browsers suspend media on background/screen-lock and block autoplay of the next
  track — a phone host would silence the party. Desktop-only = a clean, reliable promise.

### 20. Room capacity → ~20 guests (intimate gatherings)
- Target ~20 concurrent guests per room (configurable). Relay load negligible; round-robin rounds stay
  short so everyone's pick comes around quickly. Not aiming at event/venue scale.

### 21. Guest disconnect → reconnect grace, then KEEP/orphan by default (host can drop)
- Guests keep their ID in localStorage; **brief drops are tolerated** (reconnect grace) — songs stay,
  name/ownership restored on return. (Mirrors host resilience #13.)
- After grace expires (guest truly gone): **default = keep their pending songs** (they keep playing,
  orphaned; the absent contributor's rotation slot persists so their picks still surface).
- **Host override:** host can drop a departed guest's songs (and free their slot) — a convenience action
  on top of the "remove any song" power from #18. So the vibe stays generous but the host can tidy up.
- Contrast with kick (#18): an explicit kick DOES purge the kicked guest's songs immediately.

### 22. Played history → NONE
- No "recently played" list. Once a song finishes and leaves the queue, it's forgotten.
- Duplicate-blocking (#11) therefore applies ONLY to the current pending queue; a finished song can be
  re-added later. Simplest model; accepts occasional repeats and no "what was that song?" recall.

## Key risks / watch-items

- **InnerTube is unofficial & fragile:** Google can change the internal search/watch-next endpoints;
  the proxy needs maintenance and a graceful-degradation path (fall back to URL-paste if search breaks).
- **`embeddable: false` videos:** some tracks refuse IFrame playback → must auto-skip + notify, and
  ideally filter them out of search results before they're queued.
- **ToS / legal:** IFrame playback is sanctioned; InnerTube scraping is a gray area. No ads are stripped,
  no media stored — keeps risk lower, but not zero. Worth a conscious call before public launch.
- **Premium does not apply** to the host embed → ads may interrupt the party. Accepted tradeoff.
- **WS relay isn't serverless:** needs a persistent host (rules out plain Vercel functions for the relay).
