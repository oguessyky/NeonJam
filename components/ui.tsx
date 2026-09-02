"use client";

import { MusicNote } from "@phosphor-icons/react";

export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function Cover({
  src,
  alt,
  size = 48,
}: {
  src: string | null | undefined;
  alt: string;
  size?: number;
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line)] grid place-items-center"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <MusicNote size={size * 0.4} className="text-[var(--color-faint)]" />
      )}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  onSeek,
}: {
  value: number;
  max: number;
  onSeek?: (sec: number) => void;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className={`group relative h-2 w-full rounded-full bg-[var(--color-line)] ${onSeek ? "cursor-pointer" : ""}`}
      onClick={
        onSeek
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              onSeek(Math.max(0, Math.min(1, ratio)) * max);
            }
          : undefined
      }
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${pct}%`,
          background: "linear-gradient(90deg, var(--color-neon), var(--color-neon-2))",
        }}
      />
    </div>
  );
}

export function EqBars() {
  return (
    <span className="eq inline-flex items-end h-4" aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
