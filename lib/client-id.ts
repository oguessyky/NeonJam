// Anonymous guest identity (decision #7): a stable per-browser clientId plus a
// display name, both in localStorage. No accounts. The clientId also powers the
// guest reconnect grace (#21) — reconnecting with the same id restores ownership.

"use client";

const ID_KEY = "neonjam.clientId";
const NAME_KEY = "neonjam.name";

function rid(): string {
  // short, url-safe, no crypto dependency needed for a party id
  return "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = rid();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return rid();
  }
}

export function getName(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 32));
  } catch {
    /* ignore */
  }
}
