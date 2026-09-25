# Changelog

## v1.0.0 — 2026-09-25

First release of NeonJam, a collaborative party jukebox for YouTube Music.

### Host
- Desktop-only host room with a room code, QR code, and YouTube IFrame playback.
- DJ controls: play/pause, skip, remove, kick, lock room.
- "Play next" lane with drag-to-reorder.
- Optional max song length cap.
- Autoplay radio fills the queue when it runs dry.
- Tap-to-start prompt when the browser blocks autoplay.
- Reclaims its room code if the relay restarts.

### Guests
- Join by QR or code with just a name, no accounts.
- Search YouTube Music, or paste a link (one-tap paste-to-add).
- Live, synced "now playing" and queue grouped by round.
- Likes, plus vote-to-skip by majority.

### Queue
- Fair round-robin: one song per contributor per round, likes rank within a turn,
  newcomers join the next round.

### Infrastructure
- Stateless WebSocket relay with reconnect grace and room capacity, deployable
  separately from the Next.js app (Render blueprint and Dockerfile included).
- Stateless InnerTube search/resolve/radio proxy.
- Nothing is stored or downloaded.
