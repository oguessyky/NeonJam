"use client";

import { useState } from "react";
import { DotsSixVertical, CaretDoubleUp, Trash, X, PushPin } from "@phosphor-icons/react";
import type { QueueItem } from "@/lib/types";
import { Cover } from "./ui";

type Props = {
  upNext: QueueItem[];
  pinnedIds: string[];
  onPinNext: (id: string) => void;
  onUnpin: (id: string) => void;
  onReorderPinned: (orderedIds: string[]) => void;
  onRemove: (id: string) => void;
};

export function HostQueue({ upNext, pinnedIds, onPinNext, onUnpin, onReorderPinned, onRemove }: Props) {
  const pinnedSet = new Set(pinnedIds);
  const byId = new Map(upNext.map((q) => [q.id, q]));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter(Boolean) as QueueItem[];
  const auto = upNext.filter((q) => !pinnedSet.has(q.id));

  // drag state for the pinned lane
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  const drop = () => {
    if (dragId && overId && dragId !== overId) {
      const ids = pinned.map((p) => p.id).filter((id) => id !== dragId);
      const at = ids.indexOf(overId);
      ids.splice(after ? at + 1 : at, 0, dragId);
      onReorderPinned(ids);
    }
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Queue</h3>
        <span className="chip">{upNext.length}</span>
      </div>

      {upNext.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--color-faint)]">
          Nothing queued yet.
        </p>
      )}

      {/* Playing-next lane (draggable) */}
      {pinned.length > 0 && (
        <div
          className="mb-4 rounded-xl p-2"
          style={{ background: "color-mix(in srgb, var(--color-neon) 8%, transparent)" }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 px-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--color-neon)]">
            <PushPin size={12} weight="fill" /> Playing next
          </div>
          <ol className="flex flex-col">
            {pinned.map((q, i) => {
              const isOver = overId === q.id && dragId && dragId !== q.id;
              return (
                <li
                  key={q.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(q.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setOverId(q.id);
                    setAfter(e.clientY > r.top + r.height / 2);
                  }}
                  onDrop={drop}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  className={`group relative flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-[opacity,transform] duration-150 ${
                    dragId === q.id ? "opacity-40" : "opacity-100"
                  } ${isOver && !after ? "shadow-[inset_0_2px_0_var(--color-neon)]" : ""} ${
                    isOver && after ? "shadow-[inset_0_-2px_0_var(--color-neon)]" : ""
                  }`}
                >
                  <span className="cursor-grab text-[var(--color-faint)] active:cursor-grabbing group-hover:text-[var(--color-muted)]">
                    <DotsSixVertical size={16} weight="bold" />
                  </span>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-neon)] text-[0.7rem] font-bold text-white tabular-nums">
                    {i + 1}
                  </span>
                  <Cover src={q.cover} alt={q.title} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{q.title}</p>
                    <p className="truncate text-xs text-[var(--color-faint)]">
                      {q.artist} · {q.isRadio ? "radio" : q.addedByName}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon !p-1.5 opacity-0 transition group-hover:opacity-100"
                    onClick={() => onUnpin(q.id)}
                    title="Remove from playing next"
                    aria-label="Unpin"
                  >
                    <X size={15} />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Auto round-robin list */}
      {auto.length > 0 && (
        <>
          {pinned.length > 0 && (
            <div className="mb-1.5 px-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
              Then, in fair rotation
            </div>
          )}
          <ol className="flex flex-col">
            {auto.map((q, i) => (
              <li
                key={q.id}
                className="group flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition hover:bg-[var(--color-panel-2)]"
              >
                <span className="w-5 text-center text-sm tabular-nums text-[var(--color-faint)]">
                  {i + 1}
                </span>
                <Cover src={q.cover} alt={q.title} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{q.title}</p>
                  <p className="truncate text-xs text-[var(--color-faint)]">
                    {q.artist} · {q.isRadio ? "radio" : q.addedByName}
                  </p>
                </div>
                {q.voters.length > 0 && <span className="chip">▲ {q.voters.length}</span>}
                <button
                  className="btn btn-ghost btn-icon !p-1.5 opacity-0 transition group-hover:opacity-100 hover:!text-[var(--color-neon)]"
                  onClick={() => onPinNext(q.id)}
                  title="Play next"
                  aria-label="Play next"
                >
                  <CaretDoubleUp size={16} weight="bold" />
                </button>
                <button
                  className="btn btn-ghost btn-icon !p-1.5 opacity-0 transition group-hover:opacity-100"
                  onClick={() => onRemove(q.id)}
                  title="Remove"
                  aria-label="Remove"
                >
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
