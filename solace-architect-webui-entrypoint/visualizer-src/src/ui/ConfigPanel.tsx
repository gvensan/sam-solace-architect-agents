import { useState } from "preact/hooks";
import type { BrokerConfig } from "../broker/solaceClient";

interface Props {
  initial: BrokerConfig;
  onConnect: (cfg: BrokerConfig) => void;
  onCancel: () => void;
}

export function ConfigPanel({ initial, onConnect, onCancel }: Props) {
  const [cfg, setCfg] = useState<BrokerConfig>(initial);

  const upd = (k: keyof BrokerConfig) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    const v = t.type === "checkbox" ? t.checked : t.value;
    setCfg({ ...cfg, [k]: v as any });
  };

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>Connect to Solace broker</div>
        <div style={body}>
          <Field label="WebSocket URL" hint="ws://localhost:8008 or wss://broker.example.com:8443">
            <input style={input} value={cfg.url} onInput={upd("url")} placeholder="wss://broker:8443" />
          </Field>
          <Field label="Message VPN">
            <input style={input} value={cfg.vpnName} onInput={upd("vpnName")} placeholder="default" />
          </Field>
          <Field label="Username">
            <input style={input} value={cfg.userName} onInput={upd("userName")} />
          </Field>
          <Field label="Password">
            <input style={input} type="password" value={cfg.password} onInput={upd("password")} />
          </Field>
          <Field label="SAM namespace" hint="Maps to {namespace}/a2a/v1/>">
            <input style={input} value={cfg.namespace} onInput={upd("namespace")} placeholder="my-sam-project" />
          </Field>
        </div>
        <div style={footer}>
          <button style={ghost} onClick={onCancel}>Cancel</button>
          <button style={primary} onClick={() => onConnect(cfg)}>Connect</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const overlay: preact.JSX.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const modal: preact.JSX.CSSProperties = {
  width: 420,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontFamily: "system-ui, sans-serif",
  boxShadow: "var(--shadow)",
};
const header: preact.JSX.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
};
const body: preact.JSX.CSSProperties = { padding: 16 };
const footer: preact.JSX.CSSProperties = {
  padding: 12,
  borderTop: "1px solid var(--border)",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};
const input: preact.JSX.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  boxSizing: "border-box",
};
const primary: preact.JSX.CSSProperties = {
  background: "var(--accent-teal)",
  color: "#031312",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  fontWeight: 600,
  cursor: "pointer",
};
const ghost: preact.JSX.CSSProperties = {
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
};
