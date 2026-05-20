import type { EventBus } from "../bus/eventBus";
import type { A2AEvent, MeshState } from "../bus/types";
import type { AnimationRegistry } from "../bus/animations";
import { useBusVersion } from "./useBusVersion";
import { useAnimations } from "./useAnimations";

interface Props {
  bus: EventBus;
  animations: AnimationRegistry;
  limit?: number;
  onClear?: () => void;
  onRewind?: () => void;
  rewindEnabled?: boolean;
  /** When set, a Replay button appears in the header. */
  onReplay?: () => void;
  replayEnabled?: boolean;
  /** True while a replay is actively in progress. */
  replaying?: boolean;
  /** True when an in-progress replay has reached the moment it started. */
  caughtUp?: boolean;
  showDiscovery: boolean;
  setShowDiscovery: (b: boolean) => void;
  /** Root task id currently in spotlight, if any. */
  spotlightTask?: string | null;
  /** Click on a timeline row resolves the event's task to its root and asks
   * the parent to spotlight it (or clear if it's the same task). */
  onSpotlight?: (rootTaskId: string | null) => void;
}

function rootTaskOf(state: MeshState, taskId: string): string {
  const visited = new Set<string>();
  let id = taskId;
  while (!visited.has(id)) {
    visited.add(id);
    const t = state.tasks.get(id);
    if (!t || !t.parentTask) return id;
    id = t.parentTask;
  }
  return id;
}

function eventRoot(state: MeshState, e: A2AEvent): string | null {
  const tid = e.taskId ?? e.subTaskId;
  if (!tid) return null;
  return rootTaskOf(state, tid);
}

const LABEL: Record<A2AEvent["kind"], string> = {
  discovery: "DISCOVERY",
  request: "REQUEST",
  status: "STATUS",
  response: "RESPONSE",
  "delegation-status": "DELEGATE-S",
  "delegation-response": "DELEGATE-R",
};

const COLOR: Record<A2AEvent["kind"], string> = {
  discovery: "#aab3c0",
  request: "#3b82f6",
  status: "#00C895",
  response: "#22c55e",
  "delegation-status": "#f59e0b",
  "delegation-response": "#fbbf24",
};

function describe(e: A2AEvent): string {
  switch (e.kind) {
    case "discovery":
      return "AgentCard published";
    case "request":
      return `→ ${e.agentName ?? "?"}`;
    case "status":
      return `${e.taskId ?? "?"} → gw:${e.gatewayId ?? "?"}`;
    case "response":
      return `${e.taskId ?? "?"} → gw:${e.gatewayId ?? "?"}`;
    case "delegation-status":
    case "delegation-response":
      return `${e.subTaskId ?? "?"} → ${e.delegatingAgent ?? "?"}`;
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function Timeline({
  bus,
  animations,
  limit = 80,
  onClear,
  onRewind,
  rewindEnabled = false,
  onReplay,
  replayEnabled = false,
  replaying = false,
  caughtUp = false,
  showDiscovery,
  setShowDiscovery,
  spotlightTask,
  onSpotlight,
}: Props) {
  useBusVersion(bus);
  const active = useAnimations(animations);
  const history = bus.getHistory();
  const total = history.length;
  const filtered = showDiscovery
    ? history
    : history.filter((e) => e.kind !== "discovery");
  const hiddenDiscoveries = total - filtered.length;
  const recent = filtered.slice(-limit).reverse();
  const latestSeq = total > 0 ? history[total - 1].seq : undefined;

  return (
    <div style={wrap}>
      <div style={header}>
        <span>EVENTS</span>
        <span
          style={count}
          title={
            hiddenDiscoveries > 0
              ? `${filtered.length} shown · ${hiddenDiscoveries} discovery hidden · ${total} total`
              : `${filtered.length} of ${total}`
          }
        >
          {showDiscovery || hiddenDiscoveries === 0
            ? total
            : `${filtered.length}/${total}`}
        </span>
        <label style={checkbox} title="Show or hide AgentCard discovery heartbeats in the list">
          <input
            type="checkbox"
            checked={showDiscovery}
            onChange={(e) => setShowDiscovery((e.target as HTMLInputElement).checked)}
            style={{ marginRight: 4 }}
          />
          Discovery
        </label>
        <div style={spacer} />
        {replaying && (
          <span style={caughtUp ? caughtUpBadge : replayBadge}>
            {caughtUp ? "● caught up" : "● replaying"}
          </span>
        )}
        {onReplay && (
          <button
            style={btn(replayEnabled && !replaying)}
            onClick={onReplay}
            disabled={!replayEnabled || replaying}
            title="Replay the captured event history from the beginning"
          >
            Replay
          </button>
        )}
        {onRewind && (
          <button
            style={btn(rewindEnabled)}
            onClick={onRewind}
            disabled={!rewindEnabled}
            title="Restart current scenario from the beginning"
          >
            Rewind
          </button>
        )}
        {onClear && (
          <button
            style={btn(total > 0)}
            onClick={onClear}
            disabled={total === 0}
            title="Clear events and reset the canvas"
          >
            Clear
          </button>
        )}
      </div>
      <div style={list}>
        {recent.map((e) => {
          const fresh = e.seq === latestSeq;
          const playing = active.has(e.seq ?? -1);
          const root = eventRoot(bus.getState(), e);
          const inSpotlight = spotlightTask !== null && spotlightTask === root;
          const dimmed = spotlightTask != null && !inSpotlight;
          const classes = ["timeline-row"];
          if (fresh) classes.push("timeline-row-fresh");
          if (playing) classes.push("timeline-row-playing");
          return (
            <div
              key={e.seq}
              className={classes.join(" ")}
              style={{
                ...row,
                cursor: onSpotlight && root ? "pointer" : "default",
                background: inSpotlight ? "var(--bg-hover)" : undefined,
                opacity: dimmed ? 0.45 : 1,
              }}
              onClick={() => {
                if (!onSpotlight || !root) return;
                onSpotlight(spotlightTask === root ? null : root);
              }}
              title={root ? `Spotlight task ${root}` : describe(e)}
            >
              <span style={timeCell}>{fmtTime(e.ts)}</span>
              <span style={{ ...kindCell, color: COLOR[e.kind] }}>
                {LABEL[e.kind]}
              </span>
              <span style={descCell} title={describe(e)}>{describe(e)}</span>
            </div>
          );
        })}
        {recent.length === 0 && (
          <div style={empty}>
            {total > 0
              ? "All events filtered. Toggle Discovery on to see them."
              : "No events yet — start a simulation or connect to a broker."}
          </div>
        )}
      </div>
    </div>
  );
}

const wrap: preact.JSX.CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
};

const header: preact.JSX.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-muted)",
  letterSpacing: 2,
  fontSize: 11,
};

const count: preact.JSX.CSSProperties = {
  color: "var(--text-dim)",
  letterSpacing: 0,
  fontSize: 11,
  whiteSpace: "nowrap",
};

const spacer: preact.JSX.CSSProperties = { flex: 1 };

const checkbox: preact.JSX.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  color: "var(--text-secondary)",
  fontSize: 11,
  letterSpacing: 0,
  textTransform: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const replayBadge: preact.JSX.CSSProperties = {
  color: "var(--accent-amber)",
  letterSpacing: 1,
  fontSize: 11,
  textTransform: "uppercase",
};

const caughtUpBadge: preact.JSX.CSSProperties = {
  color: "var(--accent-teal)",
  letterSpacing: 1,
  fontSize: 11,
  textTransform: "uppercase",
};

const list: preact.JSX.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "4px 0",
  minWidth: 0,
};

const row: preact.JSX.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "3px 10px",
  minWidth: 0,
};

const timeCell: preact.JSX.CSSProperties = {
  color: "var(--text-muted)",
  flex: "0 0 96px",
  whiteSpace: "nowrap",
};

const kindCell: preact.JSX.CSSProperties = {
  flex: "0 0 84px",
  whiteSpace: "nowrap",
  fontWeight: 600,
};

const descCell: preact.JSX.CSSProperties = {
  color: "var(--text-secondary)",
  flex: "1 1 auto",
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const empty: preact.JSX.CSSProperties = {
  color: "var(--text-muted)",
  padding: 12,
  lineHeight: 1.5,
};

function btn(enabled: boolean): preact.JSX.CSSProperties {
  return {
    background: enabled ? "var(--bg-hover)" : "transparent",
    color: enabled ? "var(--text-primary)" : "var(--text-dim)",
    border: `1px solid ${enabled ? "var(--border)" : "var(--border-subtle)"}`,
    borderRadius: 6,
    padding: "3px 9px",
    fontSize: 11,
    letterSpacing: 1,
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "inherit",
  };
}
