"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Plus,
  MusicNotesSimple,
  Heart,
  Trash,
  PencilSimple,
  WifiSlash,
  DoorOpen,
  PushPin,
  SkipForward,
} from "@phosphor-icons/react";
import type { PublicQueueItem } from "@/lib/types";
import { useGuest } from "@/lib/use-guest";
import { Cover, ProgressBar, formatTime, EqBars } from "./ui";
import { AddSong } from "./AddSong";

const JOIN_ERRORS: Record<string, string> = {
  not_found: "That room doesn't exist (or the jam ended).",
  full: "This room is full.",
  locked: "The host locked the room to new guests.",
  bad_name: "That name didn't work — try another.",
  banned: "The host removed you from this room.",
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

  // Vote-to-skip (#17): visible only while something's playing and the host has it on.
  const skip = state?.voteSkipEnabled && np ? state.skip : null;
  const youSkipped = !!skip?.voterIds.includes(me);
  const skipVotes = skip?.voterIds.length ?? 0;
  const skipNeeded = skip?.needed ?? 0;

  // Group the queue into "Playing next" (pinned) + per-round sections.
  const sections = groupSections(state?.upNext ?? []);

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
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate font-semibold">{np?.title ?? "Nothing yet"}</p>
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
        {skip && (
          <button
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
              youSkipped
                ? "border-[var(--color-warn)] bg-[color-mix(in_srgb,var(--color-warn)_15%,transparent)] text-[var(--color-warn)]"
                : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-warn)] hover:text-[var(--color-warn)]"
            }`}
            onClick={() => (youSkipped ? actions.unSkipVote(np!.id) : actions.skipVote(np!.id))}
            aria-pressed={youSkipped}
          >
            <SkipForward size={15} weight="fill" />
            {youSkipped ? "Voted to skip" : "Vote to skip"}
            {skipNeeded > 0 && (
              <span className="tabular-nums opacity-80">
                {skipVotes}/{skipNeeded}
              </span>
            )}
          </button>
        )}
      </div>

      {/* up next */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">Up next</h2>
        <span className="chip">{state?.upNext.length ?? 0}</span>
      </div>
      {state && state.upNext.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--color-ink-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <Heart size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-neon)]" />
          <span>
            Songs play in the order they&apos;re added, but everyone takes turns, one per round, so no
            one hogs. Tap <Heart size={11} weight="fill" className="inline align-[-1px] text-[var(--color-neon)]" />{" "}
            to like a song.
          </span>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {!state && <p className="py-6 text-center text-sm text-[var(--color-faint)]">Connecting…</p>}
        {state && state.upNext.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--color-faint)]">
            Nothing queued. Be the first to add a song!
          </p>
        )}
        {sections.map((sec) => (
          <div key={sec.key}>
            <div className="mb-1.5 flex items-center gap-2 px-0.5">
              {sec.pinned ? (
                <span className="flex items-center gap-1 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--color-neon)]">
                  <PushPin size={11} weight="fill" /> Playing next
                </span>
              ) : (
                <span className="text-[0.7rem] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                  Round {sec.round}
                </span>
              )}
              <span className="h-px flex-1 bg-[var(--color-line)]" />
            </div>
            <div className="flex flex-col gap-1.5">
              {sec.items.map((q) => {
                const youVoted = q.voterIds.includes(me);
                const mine = q.addedBy === me;
                return (
                  <div
                    key={q.id}
                    className="flex items-center gap-3 rounded-xl border p-2.5"
                    style={
                      mine
                        ? {
                            borderColor: "color-mix(in srgb, var(--color-neon-2) 45%, var(--color-line))",
                            background: "color-mix(in srgb, var(--color-neon-2) 7%, var(--color-panel))",
                          }
                        : { borderColor: "var(--color-line)", background: "var(--color-panel)" }
                    }
                  >
                    <Cover src={q.cover} alt={q.title} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="min-w-0 truncate text-sm font-medium">{q.title}</p>
                        {mine && (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-neon-2)_22%,transparent)] px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-[var(--color-neon-2)]">
                            you
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[var(--color-faint)]">
                        {q.artist} · {q.isRadio ? "radio" : q.addedByName}
                      </p>
                    </div>
                    {mine && !q.isRadio && (
                      <button
                        className="btn btn-ghost btn-icon !p-1.5 text-[var(--color-faint)]"
                        onClick={() => actions.remove(q.id)}
                        aria-label="Remove your song"
                        title="Remove your song"
                      >
                        <Trash size={15} />
                      </button>
                    )}
                    {!q.isRadio && (
                      <button
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                          youVoted
                            ? "border-[var(--color-neon)] bg-[color-mix(in_srgb,var(--color-neon)_15%,transparent)] text-[var(--color-neon)]"
                            : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-neon)] hover:text-[var(--color-neon)]"
                        }`}
                        onClick={() => (youVoted ? actions.unvote(q.id) : actions.vote(q.id))}
                        aria-pressed={youVoted}
                        aria-label={youVoted ? "Unlike" : "Like"}
                      >
                        <Heart size={15} weight={youVoted ? "fill" : "regular"} />
                        <span className="tabular-nums">{q.voterIds.length}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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

type Section = { key: string; pinned: boolean; round: number; items: PublicQueueItem[] };

function groupSections(items: PublicQueueItem[]): Section[] {
  const out: Section[] = [];
  for (const q of items) {
    const pinned = !!q.isPinned;
    const round = q.round ?? 1;
    const key = pinned ? "pinned" : `r${round}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(q);
    else out.push({ key, pinned, round, items: [q] });
  }
  return out;
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
