import * as solace from "solclientjs";
import type { EventBus } from "../bus/eventBus";
import { parseTopic } from "../parse/topic";

export interface BrokerConfig {
  url: string;
  vpnName: string;
  userName: string;
  password: string;
  namespace: string;
  subscribeFeedback?: boolean;
  /**
   * Optional client-side filter. When set, only messages whose payload
   * (or Solace user-property map) carries a **non-matching** engagement_id
   * are dropped — messages without any engagement tag pass through. This
   * is deliberate: cross-cutting traffic (agentcards discovery, gateway
   * heartbeats, peer registration) doesn't carry engagement context, and
   * filtering them out would blank the visualizer instead of just scoping
   * its view. We subscribe broadly to `{namespace}/a2a/v1/>`; filtering
   * is per message, not at the broker.
   */
  engagementId?: string;
}

function extractEngagementId(payload: unknown, msg?: solace.Message): string | undefined {
  // Most A2A traffic carries engagement_id inside the JSON payload under
  // either `metadata.engagement_id` or a top-level `engagement_id`. Some
  // SAM versions put it in the message user-property map instead. Probe
  // all three; first non-empty value wins.
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, any>;
    const metaId = p?.metadata?.engagement_id;
    if (typeof metaId === "string" && metaId) return metaId;
    const flatId = p?.engagement_id;
    if (typeof flatId === "string" && flatId) return flatId;
  }
  try {
    const props = msg?.getUserPropertyMap?.();
    const field = props?.getField?.("engagement_id");
    const value = field?.getValue?.();
    if (typeof value === "string" && value) return value;
  } catch { /* ignore */ }
  return undefined;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface BrokerHandle {
  disconnect: () => void;
  status: () => ConnectionStatus;
  onStatus: (cb: (s: ConnectionStatus, info?: string) => void) => () => void;
}

let factoryInitialised = false;
function initFactoryOnce() {
  if (factoryInitialised) return;
  const props = new solace.SolclientFactoryProperties();
  props.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(props);
  factoryInitialised = true;
}

/**
 * Connect to a Solace broker over WebSocket using solclientjs (npm).
 * Subscribes to {namespace}/a2a/v1/> and routes every message into the
 * supplied EventBus via parseTopic, so live and simulated traffic share
 * the same downstream pipeline.
 */
export function connectBroker(bus: EventBus, cfg: BrokerConfig): BrokerHandle {
  initFactoryOnce();

  const listeners = new Set<(s: ConnectionStatus, info?: string) => void>();
  let status: ConnectionStatus = "connecting";
  const setStatus = (s: ConnectionStatus, info?: string) => {
    status = s;
    listeners.forEach((fn) => fn(s, info));
  };

  const session = solace.SolclientFactory.createSession({
    url: cfg.url,
    vpnName: cfg.vpnName,
    userName: cfg.userName,
    password: cfg.password,
  });

  // Strip trailing slashes from the namespace before composing topic strings.
  // A `NAMESPACE=sa/` in .env (easy mistake) would otherwise produce
  // `sa//a2a/v1/>` — solclientjs rejects that with "Empty level(s)" and the
  // subscribe throws inside the UP_NOTICE handler, flipping the session to
  // error and silently breaking every downstream consumer. Normalising once
  // here makes the visualizer robust regardless of how the env is shaped.
  const ns = cfg.namespace.replace(/\/+$/, "");

  session.on(solace.SessionEventCode.UP_NOTICE, () => {
    setStatus("connected");
    const topic = `${ns}/a2a/v1/>`;
    session.subscribe(
      solace.SolclientFactory.createTopicDestination(topic),
      true,
      topic,
      10_000,
    );
    if (cfg.subscribeFeedback) {
      const fb = `${ns}/sam/feedback/v1`;
      session.subscribe(
        solace.SolclientFactory.createTopicDestination(fb),
        true,
        fb,
        10_000,
      );
    }
  });

  session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e: solace.SessionEvent) => {
    setStatus("error", String(e?.infoStr ?? "connect failed"));
  });

  session.on(solace.SessionEventCode.DISCONNECTED, () => {
    setStatus("disconnected");
  });

  session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (e: solace.SessionEvent) => {
    setStatus("error", String(e?.infoStr ?? "subscription error"));
  });

  session.on(solace.SessionEventCode.MESSAGE, (msg: solace.Message) => {
    try {
      const dest = msg.getDestination();
      if (!dest) return;
      const topic: string = dest.getName();
      const payload = parsePayload(msg);
      if (cfg.engagementId) {
        const msgEngagement = extractEngagementId(payload, msg);
        // Drop only when the message *explicitly* belongs to a different
        // engagement; pass-through messages without engagement context
        // (discovery, heartbeats, etc.) so the visualizer stays useful.
        if (msgEngagement && msgEngagement !== cfg.engagementId) return;
      }
      const event = parseTopic(topic, cfg.namespace, Date.now(), payload);
      if (event) bus.dispatch(event);
    } catch (err) {
      console.warn("Failed to handle broker message", err);
    }
  });

  try {
    session.connect();
  } catch (e: unknown) {
    setStatus("error", e instanceof Error ? e.message : String(e));
  }

  return {
    disconnect: () => {
      try { session.disconnect(); } catch { /* ignore */ }
    },
    status: () => status,
    onStatus: (cb) => {
      listeners.add(cb);
      cb(status);
      return () => { listeners.delete(cb); };
    },
  };
}

function parsePayload(msg: solace.Message): unknown {
  // Prefer string attachment when present.
  let text: string | undefined;
  try {
    const s = msg.getSdtContainer?.()?.getValue?.();
    if (typeof s === "string") text = s;
  } catch { /* ignore */ }

  if (text == null) {
    try {
      const bin: unknown = msg.getBinaryAttachment();
      if (bin == null) return undefined;
      if (typeof bin === "string") {
        text = bin;
      } else if (bin instanceof Uint8Array) {
        text = new TextDecoder().decode(bin);
      } else if (typeof ArrayBuffer !== "undefined" && bin instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array(bin));
      }
    } catch { /* ignore */ }
  }

  if (text == null) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}
