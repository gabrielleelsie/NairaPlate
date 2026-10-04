// Connection state for the Till. Three states, never two, so a brief Wi-Fi blip does not flip the Charge button.
// All stored times are ISO-8601 UTC. Convert to Nigeria time (WAT) only when displaying.
import { useEffect, useRef, useState } from "react";
import { logOutage } from "./offline-store";

export type ConnStatus = "online" | "checking" | "offline";
export type ConnEvent = "ping_ok" | "ping_fail" | "request_fail" | "browser_offline" | "browser_online";

export type ConnState = {
  status: ConnStatus;
  consecutiveFails: number;
  browserOffline: boolean;
  outageStartedAtUtc: string | null;
  lastSuccessfulHeartbeatAtUtc: string | null;
  lastFailedHeartbeatAtUtc: string | null;
  connectivityStateChangedAtUtc: string;
};

export function initialConnState(nowIso: string, browserOffline = false): ConnState {
  return {
    status: "checking", consecutiveFails: 0, browserOffline, outageStartedAtUtc: null,
    lastSuccessfulHeartbeatAtUtc: null, lastFailedHeartbeatAtUtc: null, connectivityStateChangedAtUtc: nowIso,
  };
}

/** Pure transition rules (see the approved Phase 0 plan, section 4). */
export function nextConnState(s: ConnState, ev: ConnEvent, nowIso: string): ConnState {
  let n: ConnState = { ...s };
  switch (ev) {
    case "ping_ok":
      // Only a successful check against NairaPlate ever makes the Till "online".
      n = { ...n, status: "online", consecutiveFails: 0, browserOffline: false, outageStartedAtUtc: null, lastSuccessfulHeartbeatAtUtc: nowIso };
      break;
    case "ping_fail": {
      const fails = s.consecutiveFails + 1;
      const status: ConnStatus = s.status === "offline" ? "offline"
        : fails >= 2 || s.browserOffline ? "offline" : "checking";
      n = { ...n, consecutiveFails: fails, lastFailedHeartbeatAtUtc: nowIso, status };
      break;
    }
    case "request_fail":
      if (s.status === "online") n = { ...n, status: "checking" };
      break;
    case "browser_offline":
      n = { ...n, browserOffline: true, status: s.status === "online" ? "checking" : s.status };
      if (s.consecutiveFails >= 1) n.status = "offline";
      break;
    case "browser_online":
      n = { ...n, browserOffline: false, status: s.status === "offline" ? "checking" : s.status };
      break;
  }
  if (n.status === "offline" && !n.outageStartedAtUtc) n.outageStartedAtUtc = nowIso;
  if (n.status !== s.status) n.connectivityStateChangedAtUtc = nowIso;
  return n;
}

/** How long to wait before the next check. */
export function heartbeatDelayMs(status: ConnStatus, hidden: boolean, consecutiveFails: number): number {
  if (hidden) return 90_000;
  if (status === "online") return 25_000;
  // After a failure: 5s, 10s, 20s, then capped at 30s.
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, consecutiveFails - 1));
}

const PING_URL = "/api/public/ping";
const PING_TIMEOUT_MS = 6_000;

async function ping(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch(`${PING_URL}?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

/** Runs the checks only while `active` (the Till screen is open). */
export function useConnectivity(active = true) {
  const [state, setState] = useState<ConnState>(() => initialConnState(new Date().toISOString()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (ev: ConnEvent) => setState((s) => {
    const n = nextConnState(s, ev, new Date().toISOString());
    if (s.status !== "offline" && n.status === "offline") void logOutage({ kind: "start", atUtc: n.outageStartedAtUtc! });
    if (s.status === "offline" && n.status === "online") void logOutage({ kind: "end", atUtc: n.lastSuccessfulHeartbeatAtUtc!, startedAtUtc: s.outageStartedAtUtc });
    return n;
  });

  const checkNow = async () => {
    const ok = await ping();
    apply(ok ? "ping_ok" : "ping_fail");
    return ok;
  };

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const loop = async () => {
      await checkNow();
      if (stopped) return;
      const s = stateRef.current;
      timer.current = setTimeout(loop, heartbeatDelayMs(s.status, document.hidden, s.consecutiveFails));
    };
    const restart = () => { if (timer.current) clearTimeout(timer.current); void loop(); };
    const onOff = () => apply("browser_offline");
    const onOn = () => { apply("browser_online"); restart(); };
    const onVis = () => { if (!document.hidden) restart(); };
    if (!navigator.onLine) apply("browser_offline");
    void loop();
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOn);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, isOnline: state.status === "online", reportRequestFailure: () => apply("request_fail"), checkNow };
}

/** "14:32 WAT" for a stored UTC time. */
export function watTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " WAT";
}

export function durationLabel(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return "";
  const s = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m} min ${s % 60} s` : `${s} s`;
}
