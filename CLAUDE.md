@AGENTS.md

# Git / Commits
Do NOT add a `Co-Authored-By:` trailer to commit messages (no AI/Claude co-author). The commit author and committer must be the human contributor only.

# Storage architecture (IMPORTANT — read before touching media code)
**All media bytes (mp3 audio + cover images) live in AssetHub (assetshub_v2), NOT in this repo,
not on local disk, not in Neon.** NeonWave talks to AssetHub only through its consumer CMS API.

- Neon (Postgres, via Drizzle) stores **metadata only**: users, tracks, playlists, shares, jams,
  and the AssetHub asset ids (`tracks.assethub_audio_id` / `assethub_cover_id`).
- AssetHub client: [lib/assethub.ts](lib/assethub.ts) — the ONLY module that calls AssetHub.
  Env: `ASSETHUB_BASE_URL` + `ASSETHUB_API_KEY` (secret, server-side only, never in client code).
  Local dev AssetHub runs at `http://localhost:3000` (why `next dev` gets bumped to another port).
- Verified API contract (grounded in AssetHub's route code, diverges from its spec doc in places):
  [docs/assethub-storage-api.md](docs/assethub-storage-api.md).
- Browser never gets AssetHub URLs/keys: audio + covers stream through same-origin proxies
  ([lib/stream-proxy.ts](lib/stream-proxy.ts) → `/api/audio`, `/api/cover`, `/api/stream/[token]`),
  forwarding `Range` for seeking. Same-origin is REQUIRED by the Web Audio visualizer (CORS taint).
- Assets can be SHARED between tracks (YouTube dedup cache `youtube_cache`, Discover catalog adds).
  Never delete an AssetHub asset directly — use [lib/asset-refs.ts](lib/asset-refs.ts)
  (`deleteTrackAssetsIfUnreferenced`), which checks all references first.

# Database schema
Canonical source of truth: [db/schema/](db/schema/) (Drizzle). Human-readable reference to consult
BEFORE any schema edit: [db/SCHEMA.md](db/SCHEMA.md). Workflow: edit `db/schema/*` →
`npm run db:generate` → `npm run db:migrate` → update `db/SCHEMA.md`. Never hand-edit migrations.

# Running locally
Two processes: `npm run dev` (Next.js) + `npm run worker` (pg-boss ingest worker: ffmpeg/yt-dlp →
mp3 → AssetHub). They share the OS temp dir for staged uploads, so same host in dev.