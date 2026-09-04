"use client";

import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, LinkSimple, X, Plus, CircleNotch } from "@phosphor-icons/react";
import type { Track } from "@/lib/types";
import { Cover, formatTime } from "./ui";

export function AddSong({
  open,
  onClose,
  search,
  resolveUrl,
  onAdd,
  initialMode = "search",
  maxSongSec = null,
}: {
  open: boolean;
  onClose: () => void;
  search: (q: string) => Promise<Track[]>;
  resolveUrl: (url: string) => Promise<Track | null>;
  onAdd: (t: Track) => void;
  /** Which tab to show when the sheet opens (clipboard fallback opens "url"). */
  initialMode?: "search" | "url";
  /** Host's max song length (seconds), or null for no cap (#D5). */
  maxSongSec?: number | null;
}) {
  const [mode, setMode] = useState<"search" | "url">(initialMode);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Honor the requested tab each time the sheet is (re)opened.
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, mode]);

  // debounced search
  useEffect(() => {
    if (mode !== "search") return;
    const term = q.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const r = await search(term);
      if (id === seq.current) {
        setResults(r);
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, mode, search]);

  const doAdd = (t: Track) => {
    onAdd(t);
    setAdded((s) => new Set(s).add(t.videoId));
  };

  const submitUrl = async () => {
    const url = q.trim();
    if (!url) return;
    setLoading(true);
    const t = await resolveUrl(url);
    setLoading(false);
    if (t) {
      doAdd(t);
      setQ("");
    } else {
      setResults([]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)]">
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-ink-2)]">
            <button
              className={`btn btn-icon px-3 text-sm ${mode === "search" ? "btn-primary" : "btn-ghost !bg-transparent !border-transparent"}`}
              onClick={() => {
                setMode("search");
                setQ("");
                setResults([]);
              }}
            >
              <MagnifyingGlass size={16} weight="bold" /> Search
            </button>
            <button
              className={`btn btn-icon px-3 text-sm ${mode === "url" ? "btn-primary" : "btn-ghost !bg-transparent !border-transparent"}`}
              onClick={() => {
                setMode("url");
                setQ("");
                setResults([]);
              }}
            >
              <LinkSimple size={16} weight="bold" /> Link
            </button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="p-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="input"
              placeholder={mode === "search" ? "Search songs, artists…" : "Paste a YouTube link"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && mode === "url" && submitUrl()}
            />
            {mode === "url" && (
              <button className="btn btn-primary shrink-0" onClick={submitUrl} disabled={loading}>
                Add
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-[120px]">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-[var(--color-faint)]">
              <CircleNotch size={20} className="animate-spin" /> Searching…
            </div>
          )}
          {!loading && mode === "search" && q.trim() && results.length === 0 && (
            <p className="text-center text-[var(--color-faint)] py-8 text-sm">No results.</p>
          )}
          {!loading &&
            results.map((t) => {
              const isAdded = added.has(t.videoId);
              // Pre-empt over-limit adds (#D5): grey out results whose known length
              // exceeds the host's cap. The host also rejects authoritatively.
              const tooLong =
                maxSongSec != null && t.durationSec != null && t.durationSec > maxSongSec;
              return (
                <div
                  key={t.videoId}
                  className={`flex items-center gap-3 p-2 rounded-xl transition ${
                    tooLong ? "opacity-45" : "hover:bg-[var(--color-panel-2)]"
                  }`}
                >
                  <Cover src={t.cover} alt={t.title} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{t.title}</p>
                    <p className="truncate text-xs text-[var(--color-faint)]">
                      {t.artist}
                      {t.durationSec ? ` · ${formatTime(t.durationSec)}` : ""}
                      {tooLong && ` · over ${Math.round(maxSongSec! / 60)} min limit`}
                    </p>
                  </div>
                  <button
                    className={`btn btn-icon shrink-0 ${isAdded ? "btn-ghost" : "btn-primary"}`}
                    onClick={() => doAdd(t)}
                    disabled={tooLong}
                    aria-label={tooLong ? "Too long to add" : "Add"}
                    title={tooLong ? `Over the ${Math.round(maxSongSec! / 60)} min limit` : undefined}
                  >
                    <Plus size={18} weight="bold" />
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
