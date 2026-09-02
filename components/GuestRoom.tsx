"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Plus,
  MusicNotesSimple,
  CaretUp,
  Trash,
  PencilSimple,
  WifiSlash,
  DoorOpen,
} from "@phosphor-icons/react";
import { useGuest } from "@/lib/use-guest";
import { Cover, ProgressBar, formatTime, EqBars } from "./ui";
import { AddSong } from "./AddSong";

const JOIN_ERRORS: Record<string, string> = {
  not_found: "That room doesn't exist (or the jam ended).",
  full: "This room is full.",
  locked: "The host locked the room to new guests.",
  bad_name: "That name didn't work — try another.",
};

export function GuestRoom({ code, name }: { code: string; name: string }) {
  const { view, actions, setToastHandler } = useGuest(code, name);
  const [addOpen, setAddOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    setToastHandler((level, text) => {
      if (level === "success") toast.success(text);
      else if (level === "error") toast.error(text);
      else toast(text);
    });
  }, [setToastHandler]);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const me = view.clientId;
  const state = view.state;
  const np = state?.nowPlaying ?? null;
  const pos = np && np.isPlaying ? np.positionSec + (Date.now() - np.anchorMs) / 1000 : np?.positionSec ?? 0;

  const rename = () => {
    const n = prompt("Change your name", view.name)?.trim();
    if (n) actions.rename(n.slice(0, 32));
  };

  if (view.status === "error") {
    return (
      <Status icon={<DoorOpen size={40} />} title="Can't join">
        <p className="text-[var(--color-muted)] mb-6">{JOIN_ERRORS[view.error ?? ""] ?? "Something went wrong."}</p>
        <Link href="/" className="btn btn-primary">
          Back home
        </Link>
      </Status>
    );
  }
  if (view.status === "kicked") {
    return (
      <Status icon={<DoorOpen size={40} />} title="Removed from the jam">
        <p className="text-[var(--color-muted)] mb-6">The host removed you from this room.</p>
        <Link href="/" className="btn btn-ghost">
          Back home
        </Link>
      </Status>
    );
  }
  if (view.status === "ended") {
    return (
      <Status icon={<MusicNotesSimple size={40} weight="fill" />} title="The jam ended">
        <p className="text-[var(--color-muted)] mb-6">Thanks for playing 🎶</p>
        <Link href="/" className="btn btn-primary">
          Back home
        </Link>
      </Status>
    );
  }

  return (
    <main className="min-h-screen max-w-xl mx-auto px-4 pt-5 pb-28">
      {/* header */}
      <header className="flex items-center justify-between mb-4">
        <Link href="/" className="flex items-center gap-1.5">
          <MusicNotesSimple size={20} weight="fill" className="text-[var(--color-neon)]" />
          <span className="font-extrabold">
            Neon<span className="neon-text">Jam</span>
          </span>
        </Link>
        <button className="chip" onClick={rename}>
          {view.name} <PencilSimple size={12} />
        </button>
      </header>

      {(view.status === "reconnecting" || !view.hostConnected) && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3 text-sm text-[var(--color-warn)]">
          <WifiSlash size={16} />
          {view.status === "reconnecting" ? "Reconnecting…" : "Host is away — hang tight."}
        </div>
      )}

      {/* now playing */}
      <div className="card p-4 mb-5">
        <p className="text-xs uppercase tracking-wider text-[var(--color-faint)] mb-3">Now playing</p>
        <div className="flex items-center gap-3">
          <Cover src={np?.cover} alt={np?.title ?? ""} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold">{np?.title ?? "Nothing yet"}</p>
              {np?.isPlaying && <EqBars />}
            </div>
            <p className="truncate text-sm text-[var(--color-faint)]">
              {np ? `${np.artist} · ${np.isRadio ? "radio" : np.addedByName}` : "Add the first song →"}
            </p>
          </div>
        </div>
        {np && (
          <div className="mt-3">
            <ProgressBar value={pos} max={np.durationSec ?? 0} />
            <div className="flex justify-between mt-1 text-xs text-[var(--color-faint)]">
              <span>{formatTime(pos)}</span>
              <span>{formatTime(np.durationSec)}</span>
            </div>
          </div>
        )}
      </div>

      {/* up next */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Up next</h2>
        <span className="chip">{state?.upNext.length ?? 0}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {!state && <p className="text-sm text-[var(--color-faint)] py-6 text-center">Connecting…</p>}
        {state && state.upNext.length === 0 && (
          <p className="text-sm text-[var(--color-faint)] py-6 text-center">
            Nothing queued. Be the first to add a song!
          </p>
        )}
        {state?.upNext.map((q, i) => {
          const youVoted = q.voterIds.includes(me);
          const mine = q.addedBy === me;
          return (
            <div key={q.id} className="card !rounded-xl flex items-center gap-3 p-2.5">
              <span className="w-4 text-center text-xs text-[var(--color-faint)] tabular-nums">{i + 1}</span>
              <Cover src={q.cover} alt={q.title} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{q.title}</p>
                <p className="truncate text-xs text-[var(--color-faint)]">
                  {q.artist} · {q.isRadio ? "radio" : q.addedByName}
                </p>
              </div>
              {mine && !q.isRadio && (
                <button
                  className="btn btn-ghost btn-icon !p-1.5 text-[var(--color-faint)]"
                  onClick={() => actions.remove(q.id)}
                  aria-label="Remove your song"
                >
                  <Trash size={15} />
                </button>
              )}
              <button
                className={`flex flex-col items-center justify-center rounded-lg px-2.5 py-1 min-w-[2.6rem] border transition ${
                  youVoted
                    ? "border-[var(--color-neon)] text-[var(--color-neon)] bg-[color-mix(in_srgb,var(--color-neon)_12%,transparent)]"
                    : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-faint)]"
                }`}
                onClick={() => (youVoted ? actions.unvote(q.id) : actions.vote(q.id))}
                aria-label="Upvote"
              >
                <CaretUp size={16} weight={youVoted ? "fill" : "bold"} />
                <span className="text-xs font-semibold tabular-nums">{q.voterIds.length}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* add FAB */}
      <button
        className="btn btn-primary fixed bottom-5 left-1/2 -translate-x-1/2 !rounded-full !px-6 !py-3.5 shadow-2xl z-40"
        onClick={() => setAddOpen(true)}
      >
        <Plus size={20} weight="bold" /> Add a song
      </button>

      <AddSong
        open={addOpen}
        onClose={() => setAddOpen(false)}
        search={actions.search}
        resolveUrl={actions.resolveUrl}
        onAdd={actions.add}
      />
    </main>
  );
}

function Status({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen grid place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="text-[var(--color-neon)] mb-3 flex justify-center">{icon}</div>
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        {children}
      </div>
    </main>
  );
}
