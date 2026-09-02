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
            </div>

            {/* now playing bar */}
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Cover src={np?.cover} alt={np?.title ?? ""} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{np?.title ?? "Nothing playing"}</p>
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
                  <MemberRow key={m.clientId} m={m} onKick={controls.kick} onDrop={controls.dropGuestSongs} />
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
}: {
  m: Member;
  onKick: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-panel-2)] transition group">
      <div
        className={`w-2 h-2 rounded-full ${m.connected ? "bg-[var(--color-good)]" : "bg-[var(--color-faint)]"}`}
      />
      <span className={`flex-1 truncate text-sm ${m.connected ? "" : "text-[var(--color-faint)]"}`}>
        {m.name}
        {!m.connected && " (away)"}
      </span>
      {!m.connected && (
        <button
          className="btn btn-ghost btn-icon opacity-0 group-hover:opacity-100 text-xs !px-2"
          onClick={() => onDrop(m.clientId)}
          title="Drop their songs"
        >
          <Trash size={14} />
        </button>
      )}
      <button
        className="btn btn-ghost btn-icon opacity-0 group-hover:opacity-100 !text-[var(--color-neon)]"
        onClick={() => onKick(m.clientId)}
        title="Kick"
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
