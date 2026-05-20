import type { EventBus } from "../bus/eventBus";
import type { PositionedNode } from "../layout/zones";
import { useBusVersion } from "./useBusVersion";

interface Props {
  bus: EventBus;
  selected: PositionedNode | null;
  onClose: () => void;
}

export function DetailPanel({ bus, selected, onClose }: Props) {
  useBusVersion(bus);
  if (!selected) return null;
  const state = bus.getState();

  let body: preact.JSX.Element;
  if (selected.kind === "agent" || selected.kind === "orchestrator") {
    const agent = state.agents.get(selected.label);
    body = agent ? (
      <>
        <Row label="Type" value={agent.isOrchestrator ? "Orchestrator" : "Agent"} />
        <Row label="Description" value={agent.description ?? "—"} />
        <Row label="Last seen" value={fmtAge(agent.lastSeen)} />
        <Row
          label={`Skills (${agent.skills.length})`}
          value={agent.skills.length ? agent.skills.map((s) => s.name).join(", ") : "—"}
        />
      </>
    ) : (
      <Empty />
    );
  } else if (selected.kind === "gateway") {
    const gw = state.gateways.get(selected.label);
    body = gw ? (
      <>
        <Row label="Gateway ID" value={gw.id} />
        <Row label="Active tasks" value={String(gw.activeTasks)} />
        <Row label="First seen" value={fmtAge(gw.firstSeen)} />
        <Row label="Last seen" value={fmtAge(gw.lastSeen)} />
      </>
    ) : (
      <Empty />
    );
  } else {
    body = (
      <>
        <Row label="Type" value={selected.kind} />
        <Row label="Note" value="Decorative node, not bound to live A2A traffic." />
      </>
    );
  }

  return (
    <aside style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>{selected.label}</span>
        <button onClick={onClose} style={closeBtn} title="Close">×</button>
      </div>
      <div style={{ padding: 12, fontSize: 13, lineHeight: 1.6 }}>{body}</div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function Empty() {
  return <div style={{ color: "var(--text-muted)" }}>No data yet.</div>;
}

function fmtAge(ts: number): string {
  const dt = Date.now() - ts;
  if (dt < 1000) return "just now";
  if (dt < 60_000) return `${Math.round(dt / 1000)}s ago`;
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`;
  return `${Math.round(dt / 3_600_000)}h ago`;
}

const panelStyle: preact.JSX.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 280,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontFamily: "system-ui, sans-serif",
  boxShadow: "var(--shadow)",
};

const headerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};

const closeBtn: preact.JSX.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 18,
  cursor: "pointer",
};
