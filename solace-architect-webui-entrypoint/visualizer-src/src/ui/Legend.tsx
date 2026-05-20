/**
 * Small persistent guide rendered inside the canvas explaining the visual
 * encoding so viewers don't have to guess what solid vs dashed means.
 */
export function Legend() {
  return (
    <aside style={panel} aria-label="Edge legend">
      <div style={title}>LEGEND</div>

      <Row>
        <Line dashed={false} thickness={2.5} />
        <Label>Request / Response</Label>
      </Row>
      <Row>
        <Line dashed thickness={1.8} />
        <Label>Status updates (in flight)</Label>
      </Row>

      <div style={hint}>
        Each task gets its own color — sub-tasks inherit the parent's hue.
      </div>
    </aside>
  );
}

function Row({ children }: { children: preact.ComponentChildren }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>{children}</div>;
}

function Label({ children }: { children: preact.ComponentChildren }) {
  return <span style={{ color: "var(--text-secondary)" }}>{children}</span>;
}

function Line({ dashed, thickness }: { dashed: boolean; thickness: number }) {
  return (
    <svg width={52} height={10} style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
      <line
        x1={1}
        y1={5}
        x2={51}
        y2={5}
        style={{
          stroke: "currentColor",
          strokeWidth: thickness,
          strokeLinecap: dashed ? "butt" : "round",
          strokeDasharray: dashed ? "5 4" : "none",
        }}
      />
    </svg>
  );
}

const panel: preact.JSX.CSSProperties = {
  position: "absolute",
  left: 14,
  bottom: 14,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  fontFamily: "system-ui, sans-serif",
  fontSize: 12,
  color: "var(--text-muted)",
  boxShadow: "var(--shadow)",
  pointerEvents: "none",
  maxWidth: 280,
};

const title: preact.JSX.CSSProperties = {
  fontSize: 10,
  letterSpacing: 2,
  color: "var(--text-muted)",
  marginBottom: 4,
};

const hint: preact.JSX.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "var(--text-muted)",
  lineHeight: 1.4,
};
