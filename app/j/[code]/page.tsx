"use client";

import { use, useEffect, useState } from "react";
import { getName, setName as persistName } from "@/lib/client-id";
import { GuestRoom } from "@/components/GuestRoom";
import { MusicNotesSimple } from "@phosphor-icons/react";

export default function GuestPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = (rawCode || "").toUpperCase();
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const existing = getName();
    if (existing) setName(existing);
  }, []);

  if (name) return <GuestRoom code={code} name={name} />;

  const submit = () => {
    const n = draft.trim().slice(0, 32);
    if (!n) return;
    persistName(n);
    setName(n);
  };

  return (
    <main className="min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <MusicNotesSimple size={30} weight="fill" className="text-[var(--color-neon)] mb-3" />
          <h1 className="text-2xl font-extrabold mb-1">
            Joining room <span className="neon-text tracking-widest">{code}</span>
          </h1>
          <p className="text-[var(--color-muted)] text-sm">What should everyone call you?</p>
        </div>
        <div className="card p-5">
          <input
            className="input mb-3"
            placeholder="Your name"
            maxLength={32}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn btn-primary w-full" onClick={submit} disabled={!draft.trim()}>
            Join the jam
          </button>
        </div>
      </div>
    </main>
  );
}
