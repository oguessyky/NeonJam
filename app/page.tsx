"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MusicNotesSimple, DesktopTower, DeviceMobile, ArrowRight } from "@phosphor-icons/react";

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const touch = navigator.maxTouchPoints > 1;
    setMobile(/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touch && window.innerWidth < 900));
  }, []);
  return mobile;
}

export default function Home() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [code, setCode] = useState("");

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length >= 4) router.push(`/j/${c}`);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="flex items-center gap-2 mb-5">
            <MusicNotesSimple size={34} weight="fill" className="text-[var(--color-neon)]" />
            <h1 className="text-4xl font-extrabold tracking-tight">
              Neon<span className="neon-text">Jam</span>
            </h1>
          </div>
          <p className="text-[var(--color-muted)] leading-relaxed">
            A party jukebox for YouTube Music. One screen plays, everyone queues from their phone.
            Nothing stored, nothing downloaded.
          </p>
        </div>

        {/* Host */}
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <DesktopTower size={20} weight="fill" className="text-[var(--color-neon-2)]" />
            <h2 className="font-bold text-lg">Host a room</h2>
          </div>
          <p className="text-sm text-[var(--color-faint)] mb-4">
            Run it on the computer at the speakers. It plays the music and shows a join code.
          </p>
          {isMobile ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3 text-sm text-[var(--color-warn)] flex gap-2 items-start">
              <DeviceMobile size={18} className="mt-0.5 shrink-0" />
              <span>
                Hosting needs a computer — phones pause audio when the screen locks. Open this on a
                laptop to host, or join a room below.
              </span>
            </div>
          ) : (
            <button className="btn btn-primary w-full" onClick={() => router.push("/host")}>
              Start a jam <ArrowRight size={18} weight="bold" />
            </button>
          )}
        </div>

        {/* Join */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <DeviceMobile size={20} weight="fill" className="text-[var(--color-neon-3)]" />
            <h2 className="font-bold text-lg">Join a room</h2>
          </div>
          <p className="text-sm text-[var(--color-faint)] mb-4">
            Enter the 4-letter code shown on the host&apos;s screen.
          </p>
          <div className="flex gap-2">
            <input
              className="input tracking-[0.35em] uppercase font-bold text-center"
              placeholder="CODE"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <button className="btn btn-ghost shrink-0" onClick={join} disabled={code.trim().length < 4}>
              Join
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--color-faint)] mt-8">
          Plays via YouTube&apos;s embedded player · no accounts · no downloads
        </p>
      </div>
    </main>
  );
}
