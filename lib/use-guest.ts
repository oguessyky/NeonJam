// Guest remote controller (decisions #2, #7, #21). Guests are thin remotes: they
// send intents to the host (via relay) and render the PublicState the host pushes
// back. No audio, no authority.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState, Track } from "./types";
import { RelayClient } from "./relay-client";
import type { GuestIntent } from "./protocol";
import { getClientId, getName, setName as persistName } from "./client-id";

export type GuestStatus =
  | "connecting"
  | "joined"
  | "reconnecting"
  | "kicked"
  | "ended"
  | "error";

export type GuestView = {
  status: GuestStatus;
  error?: string;
  code: string;
  clientId: string;
  name: string;
  hostConnected: boolean;
  state: PublicState | null;
};

export function useGuest(code: string, name: string) {
  const [view, setView] = useState<GuestView>({
    status: "connecting",
    code,
    clientId: "",
    name,
    hostConnected: true,
    state: null,
  });
  const relayRef = useRef<RelayClient | null>(null);
  const toastRef = useRef<((level: string, text: string) => void) | null>(null);

  const sendIntent = useCallback((intent: GuestIntent) => {
    relayRef.current?.send({ t: "intent", intent });
  }, []);

  useEffect(() => {
    const clientId = getClientId();
    setView((v) => ({ ...v, clientId }));

    const relay = new RelayClient({
      onOpen: () => {
        relay.send({ t: "guest_join", code, clientId, name });
      },
      onMessage: (msg) => {
        switch (msg.t) {
          case "join_ok":
            setView((v) => ({ ...v, status: "joined" }));
            break;
          case "join_fail":
            setView((v) => ({ ...v, status: "error", error: msg.reason }));
            relay.close();
            break;
          case "host_msg":
            if (msg.msg.kind === "state") {
              setView((v) => ({ ...v, state: msg.msg.kind === "state" ? msg.msg.state : v.state }));
            } else if (msg.msg.kind === "toast") {
              toastRef.current?.(msg.msg.level, msg.msg.text);
            }
            break;
          case "host_status":
            if (msg.status === "ended") {
              setView((v) => ({ ...v, status: "ended" }));
              relay.close();
            } else {
              setView((v) => ({ ...v, hostConnected: msg.status === "connected" }));
            }
            break;
          case "kicked":
            setView((v) => ({ ...v, status: "kicked" }));
            relay.close();
            break;
        }
      },
      onClose: () => {
        setView((v) =>
          v.status === "kicked" || v.status === "ended" || v.status === "error"
            ? v
            : { ...v, status: "reconnecting" },
        );
      },
    });
    relayRef.current = relay;
    relay.connect();

    return () => relay.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, name]);

  const setToastHandler = useCallback((fn: (level: string, text: string) => void) => {
    toastRef.current = fn;
  }, []);

  // --- actions -------------------------------------------------------------
  const actions = {
    search: useCallback(async (q: string): Promise<Track[]> => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results ?? []) as Track[];
    }, []),
    resolveUrl: useCallback(async (url: string): Promise<Track | null> => {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.track ?? null) as Track | null;
    }, []),
    add: useCallback((track: Track) => sendIntent({ kind: "add", track }), [sendIntent]),
    vote: useCallback((itemId: string) => sendIntent({ kind: "vote", itemId }), [sendIntent]),
    unvote: useCallback((itemId: string) => sendIntent({ kind: "unvote", itemId }), [sendIntent]),
    remove: useCallback((itemId: string) => sendIntent({ kind: "remove", itemId }), [sendIntent]),
    rename: useCallback(
      (newName: string) => {
        persistName(newName);
        setView((v) => ({ ...v, name: newName }));
        sendIntent({ kind: "rename", name: newName });
      },
      [sendIntent],
    ),
  };

  return { view, actions, setToastHandler };
}
