// Thin browser WebSocket wrapper for the relay, with auto-reconnect.
// Used by both host and guest hooks. Knows nothing about queue semantics.

"use client";

import type { ClientToRelay, RelayToClient } from "./protocol";
import { safeParse } from "./protocol";

export function relayUrl(): string {
  const env = process.env.NEXT_PUBLIC_RELAY_URL;
  if (env) return env;
  if (typeof window !== "undefined") {
    // default: same host, relay port 3061
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3061`;
  }
  return "ws://localhost:3061";
}

export type RelayHandlers = {
  onOpen?: () => void;
  onMessage: (msg: RelayToClient) => void;
  onClose?: () => void;
};

export class RelayClient {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private reconnectAttempts = 0;
  private handlers: RelayHandlers;
  private url: string;

  constructor(handlers: RelayHandlers) {
    this.handlers = handlers;
    this.url = relayUrl();
  }

  connect() {
    this.closedByUs = false;
    this.open();
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.handlers.onOpen?.();
    };
    ws.onmessage = (ev) => {
      const msg = safeParse(typeof ev.data === "string" ? ev.data : "");
      if (msg) this.handlers.onMessage(msg as RelayToClient);
    };
    ws.onclose = () => {
      this.handlers.onClose?.();
      if (!this.closedByUs) this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 8000);
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.closedByUs) this.open();
    }, delay);
  }

  send(msg: ClientToRelay) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close() {
    this.closedByUs = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
