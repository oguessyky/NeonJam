"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipForward,
  Users,
  Lock,
  LockOpen,
  Radio,
  Trash,
  SignOut,
  MusicNotesSimple,
  Broadcast,
  UserMinus,
  Copy,
  Check,
  FastForward,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useHost } from "@/lib/use-host";
import { Cover, ProgressBar, formatTime, EqBars } from "@/components/ui";
import { HostQueue } from "@/components/HostQueue";
import type { Member } from "@/lib/types";

export default function HostPage() {
  const { view, controls } = useHost();
  const [qr, setQr] = useState<string>("");
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  // clientId of the guest the host is hovering — highlights their songs in the queue.
  const [hoveredGuest, setHoveredGuest] = useState<string | null>(null);

  useEffect(() => {
    if (!view.joinUrl) return;
    QRCode.toDataURL(view.joinUrl, {
      width: 320,
      margin: 1,
      color: { dark: "#f2f2f7", light: "#00000000" },
    }).then(setQr);
  }, [view.joinUrl]);

  // 1s ticker for the live progress bar
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const np = view.nowPlaying;
  const pos =
    np && np.isPlaying ? np.positionSec + (Date.now() - np.anchorMs) / 1000 : np?.positionSec ?? 0;

  if (view.status === "ended") {
    return (
      <Centered>
        <h1 className="text-2xl font-bold mb-2">Jam ended</h1>
        <p className="text-[var(--color-muted)] mb-6">The room is closed and everyone was dropped.</p>
        <Link href="/" className="btn btn-primary">
          Back home
        </Link>
      </Centered>
    );
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      {/* Reclaim collision: the connection reset and the room had to move to a NEW
          code (the old one was taken). Music kept playing, but guests must re-join. */}
      {view.reclaimedCode && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn)]/10 p-4">
          <Warning size={22} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--color-warn)]">Connection reset — new room code</p>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              The music kept playing, but your old code was taken. Re-share the new code{" "}
              <span className="font-bold tracking-widest neon-text">{view.reclaimedCode}</span> so
              guests can rejoin.
            </p>
          </div>
          <button
            className="btn btn-ghost btn-icon !px-2 shrink-0"
            onClick={controls.dismissReclaimNotice}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {/* header */}
      <header className="flex items-center justify-between mb-6">
        <Link href="/" className="flex items-center gap-2">
          <MusicNotesSimple size={24} weight="fill" className="text-[var(--color-neon)]" />
          <span className="font-extrabold text-xl">
            Neon<span className="neon-text">Jam</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {view.status === "reconnecting" ? (
            <span className="chip !text-[var(--color-warn)]">reconnecting…</span>
          ) : (
            <span className="chip">
              <span className="live-dot" /> live
            </span>
          )}
          <span className="chip">
            <Users size={14} /> {view.guestCount}
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        {/* LEFT: player + now playing + controls */}
        <section className="flex flex-col gap-5">
          <div className="card overflow-hidden">
            {/* player */}
            <div className="relative bg-black aspect-video">
              <div id="neonjam-player" className="absolute inset-0 h-full w-full" />
              {!np && (
                <div className="absolute inset-0 grid place-items-center text-[var(--color-faint)] pointer-events-none">
                  <div className="text-center">
                    <Broadcast size={40} className="mx-auto mb-2 opacity-60" />
                    <p className="text-sm">Waiting for the first song…</p>
                  </div>
                </div>
              )}
              {np && view.needsGesture && (
                <button
                  onClick={controls.resume}
                  className="absolute inset-0 z-10 grid place-items-center bg-black/60 backdrop-blur-sm cursor-pointer transition"
                >
                  <div className="text-center px-6">
                    <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--color-neon)] shadow-2xl">
                      <Play size={28} weight="fill" className="ml-0.5 text-white" />
                    </span>
                    <p className="font-semibold">Tap to start the music</p>
                    <p className="mt-0.5 text-sm text-[var(--color-faint)]">
                      Your browser needs one tap before it can play audio
                    </p>
                  </div>
                </button>
              )}
            </div>

            {/* now playing bar */}
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Cover src={np?.cover} alt={np?.title ?? ""} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate font-semibold">{np?.title ?? "Nothing playing"}</p>
                    {np?.isRadio && <span className="chip !text-[var(--color-neon-2)]">radio</span>}
                  </div>
                  <p className="truncate text-sm text-[var(--color-faint)]">
                    {np ? `${np.artist} · added by ${np.addedByName}` : "Add a song from your phone"}
                  </p>
                </div>
                {np?.isPlaying && <EqBars />}
              </div>

              <ProgressBar value={pos} max={np?.durationSec ?? 0} onSeek={np ? controls.seek : undefined} />
              <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--color-faint)]">
                <span>{formatTime(pos)}</span>
                <span>{formatTime(np?.durationSec)}</span>
              </div>

              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  className="btn btn-primary !rounded-full w-14 h-14 !p-0"
                  onClick={controls.playPause}
                  disabled={!np}
                  aria-label="Play/Pause"
                >
                  {np?.isPlaying ? (
                    <Pause size={24} weight="fill" />
                  ) : (
                    <Play size={24} weight="fill" />
                  )}
                </button>
                <button
                  className="btn btn-ghost !rounded-full w-12 h-12 !p-0"
                  onClick={controls.skip}
                  disabled={!np}
                  aria-label="Skip"
                >
                  <SkipForward size={22} weight="fill" />
                </button>
              </div>

              {np && view.voteSkipEnabled && view.skipNeeded > 0 && view.skipVotes > 0 && (
                <p className="mt-2 text-center text-xs text-[var(--color-warn)]">
                  {view.skipVotes}/{view.skipNeeded} voted to skip
                </p>
              )}
            </div>
          </div>

          {/* Queue: pinned "play next" lane + auto round-robin */}
          <HostQueue
            upNext={view.upNext}
            pinnedIds={view.pinnedIds}
            onPinNext={controls.pinNext}
            onUnpin={controls.unpin}
            onReorderPinned={controls.reorderPinned}
            onRemove={controls.removeAny}
            highlightAddedBy={hoveredGuest}
          />
        </section>

        {/* RIGHT: join + members + settings */}
        <aside className="flex flex-col gap-5">
          <div className="card p-5 text-center">
            <p className="text-sm text-[var(--color-muted)] mb-3">Scan to join the jam</p>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Join QR" className="w-44 h-44 mx-auto mb-3" />
            ) : (
              <div className="w-44 h-44 mx-auto mb-3 rounded-xl bg-[var(--color-ink-2)] animate-pulse" />
            )}
            <button
              className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-[0.3em] neon-text"
              onClick={() => {
                navigator.clipboard?.writeText(view.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              title="Copy code"
            >
              {view.code || "····"}
              {copied ? <Check size={18} className="text-[var(--color-good)]" /> : <Copy size={16} className="opacity-50" />}
            </button>
            <p className="text-xs text-[var(--color-faint)] mt-2 break-all">{view.joinUrl}</p>
          </div>

          {/* settings */}
          <div className="card p-4 flex flex-col gap-2">
            <ToggleRow
              icon={<Radio size={18} />}
              label="Autoplay radio"
              hint="Fill gaps when the queue empties"
              on={view.radioEnabled}
              onClick={controls.toggleRadio}
            />
            <ToggleRow
              icon={<FastForward size={18} />}
              label="Vote to skip"
              hint="Guests can skip by majority"
              on={view.voteSkipEnabled}
              onClick={controls.toggleVoteSkip}
            />
            <ToggleRow
              icon={view.locked ? <Lock size={18} /> : <LockOpen size={18} />}
              label="Lock room"
              hint="Stop new guests joining"
              on={view.locked}
              onClick={controls.toggleLock}
            />
          </div>

          {/* members */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={18} className="text-[var(--color-neon-3)]" />
              <h3 className="font-semibold">In the room</h3>
            </div>
            <div className="flex flex-col gap-1">
              {view.members.filter((m) => !m.isHost).length === 0 && (
                <p className="text-sm text-[var(--color-faint)]">Nobody yet — share the code.</p>
              )}
              {view.members
                .filter((m) => !m.isHost)
                .map((m) => (
                  <MemberRow
                    key={m.clientId}
                    m={m}
                    onKick={controls.kick}
                    onDrop={controls.dropGuestSongs}
                    onHover={setHoveredGuest}
                  />
                ))}
            </div>
          </div>

          <button className="btn btn-ghost !text-[var(--color-neon)]" onClick={controls.end}>
            <SignOut size={18} /> End the jam
          </button>
        </aside>
      </div>
    </main>
  );
}

function MemberRow({
  m,
  onKick,
  onDrop,
  onHover,
}: {
  m: Member;
  onKick: (id: string, alsoIp?: boolean) => void;
  onDrop: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    // Kick = remove + block rejoin (#18). Blocking the network (IP) is opt-in
    // because party guests usually share one WiFi, so it may catch bystanders.
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-[var(--color-panel-2)] p-2.5">
        <p className="text-sm">
          Remove & block <span className="font-semibold">{m.name}</span>?
        </p>
        <p className="text-xs text-[var(--color-faint)]">
          They can&apos;t rejoin this jam. Their songs are removed.
        </p>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary btn-icon !px-3 text-sm"
            onClick={() => {
              onKick(m.clientId, false);
              setConfirming(false);
            }}
          >
            Block
          </button>
          {m.ip && (
            <button
              className="btn btn-ghost btn-icon !px-3 text-sm !text-[var(--color-warn)]"
              onClick={() => {
                onKick(m.clientId, true);
                setConfirming(false);
              }}
              title="Also block their network — may block others on the same Wi‑Fi"
            >
              Block + network
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon !px-3 text-sm ml-auto"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-panel-2)] transition group"
      onMouseEnter={() => onHover(m.clientId)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className={`w-2 h-2 rounded-full ${m.connected ? "bg-[var(--color-good)]" : "bg-[var(--color-faint)]"}`}
      />
      <span className={`min-w-0 flex-1 ${m.connected ? "" : "text-[var(--color-faint)]"}`}>
        <span className="block truncate text-sm">
          {m.name}
          {!m.connected && " (away)"}
        </span>
        {m.ip && (
          <span className="block truncate text-[0.65rem] text-[var(--color-faint)]" title={m.ip}>
            {m.ip}
          </span>
        )}
      </span>
      <button
        className="btn btn-ghost btn-icon opacity-0 group-hover:opacity-100 text-xs !px-2"
        onClick={() => onDrop(m.clientId)}
        title="Drop their songs"
      >
        <Trash size={14} />
      </button>
      <button
        className="btn btn-ghost btn-icon opacity-0 group-hover:opacity-100 !text-[var(--color-neon)]"
        onClick={() => setConfirming(true)}
        title="Remove & block"
      >
        <UserMinus size={16} />
      </button>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  on,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--color-panel-2)] transition text-left"
      onClick={onClick}
    >
      <span className={on ? "text-[var(--color-neon-2)]" : "text-[var(--color-faint)]"}>{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-[var(--color-faint)]">{hint}</span>
      </span>
      <span
        className={`relative w-10 h-6 rounded-full transition ${on ? "bg-[var(--color-neon)]" : "bg-[var(--color-line)]"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[1.15rem]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center px-6 text-center">
      <div>{children}</div>
    </main>
  );
}
