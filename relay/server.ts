// NeonJam relay — a dumb WebSocket router (decision #5).
//
// It holds ONLY ephemeral routing state: which sockets belong to which room, and
// a short host-reconnect grace timer. No queue, no votes, no persistence, no DB.
// All authoritative state lives in the host browser.

import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import {
  safeParse,
  type ClientToRelay,
  type RelayToClient,
} from "../lib/protocol";
import { ROOM_CAPACITY, HOST_RECONNECT_GRACE_MS } from "../lib/types";

// Hosts like Render/Railway/Fly inject PORT; fall back to RELAY_PORT for local dev.
const PORT = Number(process.env.PORT ?? process.env.RELAY_PORT ?? 3061);

// Unambiguous room codes (no 0/O/1/I).
const makeCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
const makeToken = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 24);

type GuestConn = { ws: WebSocket; name: string; ip?: string };

type Room = {
  code: string;
  hostToken: string;
  host: WebSocket | null;
  hostGraceTimer: NodeJS.Timeout | null;
  guests: Map<string, GuestConn>; // clientId -> conn
  locked: boolean;
  /**
   * clientIds that have EVER successfully joined this room. A known device may
   * rejoin even when the room is locked (fixes mobile-background drop-outs) —
   * clientId is the identity, not IP. Cleared only by kick/end.
   */
  known: Set<string>;
  /** clientIds blocked from rejoining (kick = remove + ban, decision #18). */
  banned: Set<string>;
  /** Optional network-level block (opt-in per kick; may catch same-WiFi guests). */
  bannedIps: Set<string>;
};

const rooms = new Map<string, Room>();

// Per-socket metadata so we can clean up on close.
type SockMeta =
  | { role: "host"; code: string }
  | { role: "guest"; code: string; clientId: string }
  | { role: "pending" };
const meta = new WeakMap<WebSocket, SockMeta>();
const alive = new WeakMap<WebSocket, boolean>();
// Coarse per-socket network address, captured at connect. Used only as a weak
// moderation signal (opt-in IP ban) + a visibility hint for the host — never as
// device identity (party guests typically share one WiFi/public IP).
const ipOf = new WeakMap<WebSocket, string>();

/** Best-effort client IP: first x-forwarded-for hop (proxied hosts) or socket. */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff?.split(",")[0];
  return (first?.trim() || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function send(ws: WebSocket, msg: RelayToClient) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function fanoutGuests(room: Room, msg: RelayToClient, only?: string) {
  for (const [cid, g] of room.guests) {
    if (only && cid !== only) continue;
    send(g.ws, msg);
  }
}

function newCode(): string {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  return code;
}

function endRoom(room: Room, notify: boolean) {
  if (notify) fanoutGuests(room, { t: "host_status", status: "ended" });
  for (const [, g] of room.guests) {
    try {
      g.ws.close();
    } catch {}
  }
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  rooms.delete(room.code);
  console.log(`[room ${room.code}] ended (guests notified=${notify})`);
}

// ---------------------------------------------------------------- server

// A small HTTP server so managed hosts (Render/Railway/Fly) get a 200 health
// check; WebSocket upgrades share the same port.
const httpServer = createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "neonjam-relay", rooms: rooms.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`NeonJam relay listening on port ${PORT}`);
});

wss.on("connection", (ws, req) => {
  meta.set(ws, { role: "pending" });
  alive.set(ws, true);
  ipOf.set(ws, clientIp(req));
  ws.on("pong", () => alive.set(ws, true));

  ws.on("message", (data) => {
    const msg = safeParse(data.toString());
    if (!msg) return send(ws, { t: "error", reason: "bad_message" });
    handle(ws, msg as ClientToRelay);
  });

  ws.on("close", () => handleClose(ws));
  ws.on("error", () => {});
});

function handle(ws: WebSocket, msg: ClientToRelay) {
  switch (msg.t) {
    case "host_create": {
      const code = newCode();
      const hostToken = makeToken();
      const room: Room = {
        code,
        hostToken,
        host: ws,
        hostGraceTimer: null,
        guests: new Map(),
        locked: false,
        known: new Set(),
        banned: new Set(),
        bannedIps: new Set(),
      };
      rooms.set(code, room);
      meta.set(ws, { role: "host", code });
      send(ws, { t: "room_created", code, hostToken });
      console.log(`[room ${code}] created`);
      return;
    }

    case "host_reclaim": {
      // The relay lost this room (restart/sleep) but the host is alive with full
      // authoritative state. Re-create the room under its ORIGINAL code + token so
      // guests reconverge. If that code is now held by a DIFFERENT live room, never
      // hijack it — mint a fresh code + token; the host detects the mismatch and
      // prompts to re-share. (No stored token to verify against — the room is gone.)
      const collision = rooms.has(msg.code);
      const code = collision ? newCode() : msg.code;
      const hostToken = collision ? makeToken() : msg.hostToken;
      const room: Room = {
        code,
        hostToken,
        host: ws,
        hostGraceTimer: null,
        guests: new Map(),
        locked: false,
        known: new Set(),
        banned: new Set(),
        bannedIps: new Set(),
      };
      rooms.set(code, room);
      meta.set(ws, { role: "host", code });
      send(ws, { t: "room_created", code, hostToken, reclaimed: true });
      console.log(`[room ${code}] reclaimed${collision ? ` (collision on ${msg.code} → new code)` : ""}`);
      return;
    }

    case "host_reconnect": {
      const room = rooms.get(msg.code);
      if (!room || room.hostToken !== msg.hostToken) {
        return send(ws, { t: "reconnect_fail", reason: "not_found" });
      }
      if (room.hostGraceTimer) {
        clearTimeout(room.hostGraceTimer);
        room.hostGraceTimer = null;
      }
      room.host = ws;
      meta.set(ws, { role: "host", code: room.code });
      send(ws, { t: "reconnect_ok", code: room.code });
      // Re-tell the host who is currently connected so it can rebuild presence.
      for (const [cid, g] of room.guests) {
        send(ws, { t: "guest_joined", clientId: cid, name: g.name, ip: g.ip });
      }
      fanoutGuests(room, { t: "host_status", status: "connected" });
      console.log(`[room ${room.code}] host reconnected`);
      return;
    }

    case "guest_join": {
      const room = rooms.get(msg.code);
      if (!room) return send(ws, { t: "join_fail", reason: "not_found" });
      const name = (msg.name ?? "").trim().slice(0, 32);
      if (!name) return send(ws, { t: "join_fail", reason: "bad_name" });
      const ip = ipOf.get(ws) || "";

      // Kicked/banned devices can never rejoin (decision #18) — clientId is the
      // primary block; opt-in IP block is a coarse secondary net.
      if (room.banned.has(msg.clientId) || (ip && room.bannedIps.has(ip))) {
        return send(ws, { t: "join_fail", reason: "banned" });
      }

      // A "known" device (ever joined this room) may return anytime — including
      // when the room is locked and after a mobile-background socket drop that
      // removed it from `guests`. New devices are gated by lock + capacity.
      const isKnown = room.known.has(msg.clientId);
      if (!isKnown) {
        if (room.locked) return send(ws, { t: "join_fail", reason: "locked" });
        if (room.guests.size >= ROOM_CAPACITY) {
          return send(ws, { t: "join_fail", reason: "full" });
        }
      }
      const wasConnected = room.guests.has(msg.clientId);
      room.known.add(msg.clientId);
      room.guests.set(msg.clientId, { ws, name, ip });
      meta.set(ws, { role: "guest", code: room.code, clientId: msg.clientId });
      send(ws, { t: "join_ok", code: room.code });
      // Host treats a repeat guest_joined for a known clientId as a reconnect.
      if (room.host) send(room.host, { t: "guest_joined", clientId: msg.clientId, name, ip });
      console.log(`[room ${room.code}] guest ${wasConnected ? "re" : ""}joined: ${name}`);
      return;
    }

    case "intent": {
      const m = meta.get(ws);
      if (!m || m.role !== "guest") return;
      const room = rooms.get(m.code);
      if (!room?.host) return; // host away (grace) — drop; host resyncs on return
      const g = room.guests.get(m.clientId);
      send(room.host, {
        t: "guest_intent",
        from: m.clientId,
        name: g?.name ?? "?",
        intent: msg.intent,
      });
      // keep relay's cached name in sync on rename
      if (msg.intent.kind === "rename" && g) g.name = msg.intent.name;
      return;
    }

    case "host_msg": {
      const m = meta.get(ws);
      if (!m || m.role !== "host") return;
      const room = rooms.get(m.code);
      if (!room) return;
      fanoutGuests(room, { t: "host_msg", msg: msg.msg }, msg.to);
      return;
    }

    case "host_action": {
      const m = meta.get(ws);
      if (!m || m.role !== "host") return;
      const room = rooms.get(m.code);
      if (!room) return;
      if (msg.action.kind === "lock") {
        room.locked = msg.action.locked;
      } else if (msg.action.kind === "kick") {
        // Kick = remove + block rejoin (decision #18). Ban by clientId always;
        // by IP only when the host opted in.
        room.banned.add(msg.action.clientId);
        room.known.delete(msg.action.clientId);
        const g = room.guests.get(msg.action.clientId);
        if (g) {
          if (msg.action.alsoIp && g.ip) room.bannedIps.add(g.ip);
          send(g.ws, { t: "kicked" });
          try {
            g.ws.close();
          } catch {}
          room.guests.delete(msg.action.clientId);
        }
      } else if (msg.action.kind === "end") {
        endRoom(room, true);
      }
      return;
    }
  }
}

function handleClose(ws: WebSocket) {
  const m = meta.get(ws);
  if (!m || m.role === "pending") return;
  const room = rooms.get(m.code);
  if (!room) return;

  if (m.role === "host" && room.host === ws) {
    room.host = null;
    fanoutGuests(room, { t: "host_status", status: "disconnected" });
    console.log(`[room ${room.code}] host dropped — ${HOST_RECONNECT_GRACE_MS}ms grace`);
    room.hostGraceTimer = setTimeout(() => endRoom(room, true), HOST_RECONNECT_GRACE_MS);
  } else if (m.role === "guest") {
    const g = room.guests.get(m.clientId);
    if (g && g.ws === ws) {
      room.guests.delete(m.clientId);
      if (room.host) send(room.host, { t: "guest_left", clientId: m.clientId });
      console.log(`[room ${room.code}] guest left: ${m.clientId}`);
    }
  }
}

// Heartbeat: drop sockets that stop responding.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      try {
        ws.terminate();
      } catch {}
      continue;
    }
    alive.set(ws, false);
    try {
      ws.ping();
    } catch {}
  }
}, 30_000);

wss.on("close", () => clearInterval(heartbeat));

process.on("SIGINT", () => {
  wss.close();
  process.exit(0);
});
