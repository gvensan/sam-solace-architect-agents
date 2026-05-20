import { SCENARIOS } from "../sim/scenarios";
import type { RenderMode } from "./App";
import type { ThemeName } from "./theme";

interface Props {
  mode: "sim" | "live";
  setMode: (m: "sim" | "live") => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  speed: number;
  setSpeed: (n: number) => void;
  loop: boolean;
  setLoop: (b: boolean) => void;
  onOpenConnect: () => void;
  liveStatus: string;
  renderMode: RenderMode;
  setRenderMode: (m: RenderMode) => void;
  themeName: ThemeName;
  setThemeName: (t: ThemeName) => void;
  showLabels: boolean;
  setShowLabels: (b: boolean) => void;
  showLegend: boolean;
  setShowLegend: (b: boolean) => void;
  historyCap: number;
  setHistoryCap: (n: number) => void;
}

const CAP_PRESETS: Array<{ value: number; label: string }> = [
  { value: 1000, label: "1k" },
  { value: 5000, label: "5k" },
  { value: 10000, label: "10k" },
  { value: Number.POSITIVE_INFINITY, label: "∞" },
];

export function Controls(p: Props) {
  return (
    <header style={bar}>
      <span style={{ fontWeight: 700, letterSpacing: 1 }}>SAM VISUALIZER</span>

      <div style={group}>
        <button
          style={tabBtn(p.mode === "sim")}
          onClick={() => p.setMode("sim")}
        >
          Simulation
        </button>
        <button
          style={tabBtn(p.mode === "live")}
          onClick={() => p.setMode("live")}
        >
          Live broker
        </button>
      </div>

      {p.mode === "sim" ? (
        <div style={group}>
          <select
            value={p.scenarioId}
            onChange={(e) => p.setScenarioId((e.target as HTMLSelectElement).value)}
            style={select}
            disabled={p.running}
          >
            {SCENARIOS.map((s) => (
              <option value={s.id} key={s.id}>{s.name}</option>
            ))}
          </select>
          <label style={lbl}>
            Speed
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={p.speed}
              onInput={(e) => p.setSpeed(Number((e.target as HTMLInputElement).value))}
              style={{ marginLeft: 6 }}
            />
            <span style={{ marginLeft: 6, width: 28, display: "inline-block" }}>{p.speed}x</span>
          </label>
          <label style={lbl}>
            <input
              type="checkbox"
              checked={p.loop}
              onChange={(e) => p.setLoop((e.target as HTMLInputElement).checked)}
              style={{ marginRight: 4 }}
            />
            Loop
          </label>
          {p.running ? (
            <button style={primary} onClick={p.onStop}>Stop</button>
          ) : (
            <button style={primary} onClick={p.onStart}>Play</button>
          )}
        </div>
      ) : (
        <div style={group}>
          <span style={statusStyle(p.liveStatus)}>{p.liveStatus}</span>
          <button style={primary} onClick={p.onOpenConnect}>Configure broker</button>
        </div>
      )}

      <div style={spacer} />

      <div style={group} title="How animations on the canvas are paced">
        <span style={lblMuted}>Render</span>
        <button
          style={tabBtn(p.renderMode === "sequence")}
          onClick={() => p.setRenderMode("sequence")}
          title="Play one animation at a time so each interaction is readable"
        >
          Sequence
        </button>
        <button
          style={tabBtn(p.renderMode === "realtime")}
          onClick={() => p.setRenderMode("realtime")}
          title="Animate every event the instant it arrives (may overlap)"
        >
          Real-time
        </button>
      </div>

      <div style={group}>
        <button
          style={tabBtn(true)}
          onClick={() => p.setThemeName(p.themeName === "dark" ? "light" : "dark")}
          title={`Switch to ${p.themeName === "dark" ? "light" : "dark"} theme`}
        >
          Theme: {p.themeName === "dark" ? "Dark" : "Light"}
        </button>

        <button
          style={tabBtn(p.showLabels)}
          onClick={() => p.setShowLabels(!p.showLabels)}
          title={p.showLabels ? "Hide task ids on edges" : "Show task ids on edges"}
        >
          Labels: {p.showLabels ? "On" : "Off"}
        </button>

        <button
          style={tabBtn(p.showLegend)}
          onClick={() => p.setShowLegend(!p.showLegend)}
          title={p.showLegend ? "Hide canvas legend" : "Show canvas legend"}
        >
          Legend
        </button>

        <label style={lblMuted} title="Maximum number of events retained for replay">
          Capture
          <select
            value={String(p.historyCap)}
            onChange={(e) => p.setHistoryCap(Number((e.target as HTMLSelectElement).value))}
            style={{ ...select, marginLeft: 6 }}
          >
            {CAP_PRESETS.map((c) => (
              <option value={String(c.value)} key={c.label}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

const bar: preact.JSX.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "10px 16px",
  background: "var(--bg-panel-header)",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
};

const group: preact.JSX.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const lbl: preact.JSX.CSSProperties = { color: "var(--text-secondary)", fontSize: 12, display: "inline-flex", alignItems: "center" };
const lblMuted: preact.JSX.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 11,
  letterSpacing: 1,
  textTransform: "uppercase",
};
const spacer: preact.JSX.CSSProperties = { flex: 1 };
const select: preact.JSX.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 6px",
};
const primary: preact.JSX.CSSProperties = {
  background: "var(--accent-teal)",
  color: "#031312",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  fontWeight: 600,
  cursor: "pointer",
};
function tabBtn(active: boolean): preact.JSX.CSSProperties {
  return {
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    border: `1px solid ${active ? "var(--border)" : "transparent"}`,
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 12,
  };
}
function statusStyle(s: string): preact.JSX.CSSProperties {
  const color = s === "connected" ? "var(--accent-teal)" : s === "connecting" ? "var(--accent-amber)" : "var(--text-muted)";
  return { color, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 };
}
