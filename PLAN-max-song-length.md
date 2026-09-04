# Plan: Host-set max song length

## Goal
Host can cap the max playtime of songs guests add, to block 30min/1h/2h uploads.

## Code grounding
- Guests add via `add` intent → host `handleIntent` "add" (use-host.ts) = authoritative
  enforcement point. Track has `durationSec: number | null`.
- Radio auto-fill (`fillRadio`) and host `addAsHost` are separate add paths.
- Settings pattern: `radioEnabled`/`voteSkipEnabled`/`locked` live on Engine, toggled
  via controls, broadcast in PublicState, rendered as ToggleRows on the host page.
- Rejection UX already exists: `toast(from, "error", ...)` back to the guest.

## Resolved decisions

### D1 — Value ladder spans up to 3h; default Off
Presets must include a high ceiling (~3 hours) so a host can deliberately ALLOW a
2h+ track, while lower rungs block long uploads. Default = Off (no cap).
Ladder (proposed): Off, 5, 7, 10, 15, 20, 30, 45, 60, 90, 120, 180 min.
Wide range ⇒ a tap-to-cycle control is too tedious → use a dropdown/select (see D2).

### D2 — Control = dropdown of presets, Off by default
A `<select>` in the host settings area with the D1 ladder. Off = no cap.

### D3 — Unknown length: allow at add, auto-skip at playback if too long
Add-time gate blocks only songs whose KNOWN length exceeds the cap. Unknown-length
tracks are queued, but when a song STARTS playing (real duration known via
`getDuration()`), if it exceeds the cap the host auto-advances past it. This also
backstops songs queued before the cap was set/lowered. Toast the adder that their
song was skipped for exceeding the limit. (Applies within the scope from D4.)
Guard against skip loops (each skip advances to the next item; radio is filtered).

### D4 — Scope: guests + radio capped; host bypasses
Guest `add` intents and radio auto-fill are subject to the cap. Host `addAsHost`
bypasses entirely (DJ authority). The playback auto-skip (D3) therefore skips
guest/radio songs over the cap but never host-added ones.

### D5 — Guest UX: pre-empt over-limit results + rejection toast backstop
Broadcast the cap in PublicState. In the guest Add sheet, disable/grey search
results whose known length exceeds the cap (with a "over X min" hint). Host-side
rejection toast remains as the authoritative backstop (covers URL-paste + unknown-
at-search cases). URL-paste of an over-limit known track: rejected host-side w/ toast.

---

## Implementation checklist

**types.ts** — add `maxSongSec: number | null` to `PublicState` (null = no cap).
**protocol.ts** — add host action `{ kind: "setMaxSong"; maxSongSec: number | null }`?
  Not needed — it's host-owned state broadcast in PublicState; host UI sets it via a
  new control. (No guest-supplied field, so no zod change.)
**use-host.ts**
- Engine: add `maxSongSec: number | null` (default null). Include in Snapshot +
  restore + engineFromSnap.
- Broadcast `maxSongSec` in buildPublicState; mirror into HostView.
- `handleIntent` "add": if cap set and `track.durationSec` known and > cap → reject
  with toast ("Too long — Xmin max"), return. Unknown → allow.
- `fillRadio`: skip radio tracks whose known duration > cap.
- Playback auto-skip (D3): in onStateChange PLAYING, once real duration known, if
  cap set and duration > cap AND the now-playing song is NOT host-added → advance,
  toast the adder. Guard the skip loop.
- control `setMaxSong(sec: number | null)` → set engine + sync.
- addAsHost bypasses (no change).

**host page.tsx** — add a settings row with a `<select>` (Off + D1 ladder) bound to
  `view.maxSongSec`, calling `controls.setMaxSong`.

**types.ts PublicState** consumed by guest: `AddSong` greys results with
  `durationSec != null && durationSec > maxSongSec`. Pass the cap down from GuestRoom.

**Verify**: typecheck; two-tab test — set a low cap, confirm a long guest add is
  rejected + greyed, host add still works, radio respects it, and a queued unknown-
  length long song auto-skips on play.

## STATUS: IMPLEMENTED + VERIFIED
- typecheck passes.
- Live two-tab test (cap = 5 min):
  * Host dropdown set cap → broadcast to guest (maxSongSec=300). ✅
  * Guest search: over-limit results greyed + add disabled with "over 5 min limit";
    boundary correct — 4:15 addable, 5:33 blocked. ✅ (disabled button genuinely
    blocks the add — React won't fire onClick on it.)
  * Host authoritative rejection via URL-paste of a 67-min video → NOT queued +
    guest toast "Too long — 5 min max". ✅
  * Normal short add (Eisodus 4:15) accepted + played. ✅
  * Radio auto-fill respected the cap (queue filled, no track > 300s). ✅
  * Host bypass (addAsHost) is by construction — doesn't pass through the guest gate;
    playback backstop (unknown-length) is coded (overMaxLength + PLAYING/heartbeat)
    but not exercised live (hard to source an unknown-length long track).
