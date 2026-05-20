import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EventBus } from "../bus/eventBus";
import { AnimationRegistry } from "../bus/animations";
import { initialState } from "../bus/types";
import { THEMES, applyThemeVars, type ThemeName } from "./theme";
import { Legend } from "./Legend";
import { SCENARIOS } from "../sim/scenarios";
import { runScenario, type SimulationHandle } from "../sim/runner";
import { Canvas } from "./Canvas";
import { Controls } from "./Controls";
import { DetailPanel } from "./DetailPanel";
import { Timeline } from "./Timeline";
import { ConfigPanel } from "./ConfigPanel";
import { runReplay, type ReplayHandle } from "../sim/replay";
import {
  connectBroker,
  type BrokerConfig,
  type BrokerHandle,
  type ConnectionStatus,
} from "../broker/solaceClient";
import type { PositionedNode } from "../layout/zones";

const CFG_KEY = "sam-viz.broker-cfg";
const RENDER_KEY = "sam-viz.render-mode";
const THEME_KEY = "sam-viz.theme";
const LABELS_KEY = "sam-viz.show-labels";
const DISCOVERY_KEY = "sam-viz.show-discovery";
const HISTORY_CAP_KEY = "sam-viz.history-cap";
const DEFAULT_HISTORY_CAP = 5000;

const loadHistoryCap = (): number => {
  try {
    const v = localStorage.getItem(HISTORY_CAP_KEY);
    if (v === "Infinity") return Number.POSITIVE_INFINITY;
    const n = v ? Number(v) : DEFAULT_HISTORY_CAP;
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* ignore */ }
  return DEFAULT_HISTORY_CAP;
};

export type RenderMode = "sequence" | "realtime";

const loadRenderMode = (): RenderMode => {
  try {
    const v = localStorage.getItem(RENDER_KEY);
    if (v === "realtime" || v === "sequence") return v;
  } catch { /* ignore */ }
  return "sequence";
};

const loadTheme = (): ThemeName => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch { /* ignore */ }
  return "dark";
};

const defaultBrokerCfg = (): BrokerConfig => {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw) as BrokerConfig;
  } catch { /* ignore */ }
  return {
    url: "ws://localhost:8008",
    vpnName: "default",
    userName: "",
    password: "",
    namespace: "default",
    subscribeFeedback: false,
  };
};

/**
 * Server config returned by `/api/visualizer/config` when the visualizer
 * is embedded under the Solace Architect WebUI entrypoint. Standalone dev
 * builds (no entrypoint) get a 404 and fall back to the manual modal flow.
 */
interface ServerConfig {
  user: { id: string; display_name: string };
  broker: { url: string; vpn: string; username: string; password: string };
  namespace: string;
  engagement: { id: string | null; name: string | null } | null;
}

async function fetchServerConfig(): Promise<ServerConfig | null> {
  try {
    const res = await fetch("/api/visualizer/config", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ServerConfig;
  } catch {
    return null;
  }
}

export function App() {
  const [historyCap, setHistoryCap] = useState<number>(loadHistoryCap);
  const bus = useMemo(
    () => new EventBus(initialState(), { historyCap: loadHistoryCap() }),
    [],
  );
  const animations = useMemo(() => new AnimationRegistry(), []);
  useEffect(() => {
    bus.setHistoryCap(historyCap);
    try {
      localStorage.setItem(
        HISTORY_CAP_KEY,
        historyCap === Number.POSITIVE_INFINITY ? "Infinity" : String(historyCap),
      );
    } catch { /* ignore */ }
  }, [bus, historyCap]);
  const [renderMode, setRenderMode] = useState<RenderMode>(loadRenderMode);
  const [themeName, setThemeName] = useState<ThemeName>(loadTheme);
  const [showLabels, setShowLabels] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(LABELS_KEY);
      if (v === "0") return false;
      if (v === "1") return true;
    } catch { /* ignore */ }
    return true; // default on so newcomers see the encoding immediately
  });
  const [showLegend, setShowLegend] = useState<boolean>(() => {
    try { return localStorage.getItem("sam-viz.show-legend") !== "0"; } catch { return true; }
  });
  const [showDiscovery, setShowDiscovery] = useState<boolean>(() => {
    try { return localStorage.getItem(DISCOVERY_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(DISCOVERY_KEY, showDiscovery ? "1" : "0"); } catch { /* ignore */ }
  }, [showDiscovery]);

  useEffect(() => {
    try { localStorage.setItem("sam-viz.show-legend", showLegend ? "1" : "0"); } catch { /* ignore */ }
  }, [showLegend]);
  const theme = THEMES[themeName];

  useEffect(() => {
    try { localStorage.setItem(RENDER_KEY, renderMode); } catch { /* ignore */ }
  }, [renderMode]);

  useEffect(() => {
    applyThemeVars(theme);
    try { localStorage.setItem(THEME_KEY, themeName); } catch { /* ignore */ }
  }, [theme, themeName]);

  useEffect(() => {
    try { localStorage.setItem(LABELS_KEY, showLabels ? "1" : "0"); } catch { /* ignore */ }
  }, [showLabels]);
  const [mode, setMode] = useState<"sim" | "live">("sim");
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [running, setRunning] = useState(false);
  const simHandleRef = useRef<SimulationHandle | null>(null);

  const [selected, setSelected] = useState<PositionedNode | null>(null);

  const [showConfig, setShowConfig] = useState(false);
  const [brokerCfg, setBrokerCfg] = useState<BrokerConfig>(defaultBrokerCfg);
  const brokerRef = useRef<BrokerHandle | null>(null);
  const [liveStatus, setLiveStatus] = useState<ConnectionStatus>("disconnected");

  const replayRef = useRef<ReplayHandle | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);

  const [spotlightTask, setSpotlightTask] = useState<string | null>(null);
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSpotlightTask(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Cross-tab "is the visualizer open?" signal. The dashboard at / reads this
  // key to disable its sidebar "Live View" link while a visualizer tab is
  // alive. Heartbeat every 3s; dashboard considers stale after ~8s. Cleared on
  // beforeunload (best-effort — browser may throttle) so the dashboard
  // re-enables quickly when the tab closes.
  useEffect(() => {
    const KEY = "solace-architect.visualizer-alive";
    const writeBeat = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ts: Date.now() }));
      } catch { /* ignore quota / private-mode errors */ }
    };
    writeBeat();
    const id = window.setInterval(writeBeat, 3000);
    const clear = () => {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", clear);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("beforeunload", clear);
      clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      simHandleRef.current?.stop();
      brokerRef.current?.disconnect();
      replayRef.current?.stop();
    };
  }, []);

  const startReplay = () => {
    if (bus.getHistory().length === 0) return;
    replayRef.current?.stop();
    setReplaying(true);
    setCaughtUp(false);
    replayRef.current = runReplay(bus, {
      onCaughtUp: () => setCaughtUp(true),
      onDone: () => {
        setReplaying(false);
        replayRef.current = null;
        // Leave the caught-up badge on briefly so the viewer notices the
        // transition; clear it after a short fade.
        window.setTimeout(() => setCaughtUp(false), 1800);
      },
    });
  };

  const startSim = () => {
    simHandleRef.current?.stop();
    const sc = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    simHandleRef.current = runScenario(bus, sc, { speed, loop });
    setRunning(true);
  };
  const stopSim = () => {
    simHandleRef.current?.stop();
    simHandleRef.current = null;
    setRunning(false);
  };
  const clearAll = () => {
    stopSim();
    replayRef.current?.stop();
    replayRef.current = null;
    setReplaying(false);
    setCaughtUp(false);
    setSpotlightTask(null);
    bus.clear();
    animations.clear();
    setSelected(null);
  };
  const rewind = () => {
    stopSim();
    bus.clear();
    animations.clear();
    setSelected(null);
    startSim();
  };

  const handleConnect = (cfg: BrokerConfig) => {
    setBrokerCfg(cfg);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
    brokerRef.current?.disconnect();
    setShowConfig(false);
    try {
      const handle = connectBroker(bus, cfg);
      brokerRef.current = handle;
      handle.onStatus((s) => setLiveStatus(s));
    } catch (e: any) {
      console.error(e);
      setLiveStatus("error");
    }
  };

  // Embedded-mode auto-connect: when running under the Solace Architect WebUI
  // entrypoint, `/api/visualizer/config` returns the broker creds + namespace
  // + current engagement from the server's session. We auto-switch to live
  // mode and connect — no modal, no localStorage broker URL to maintain.
  // Standalone dev (`npm run dev` with no entrypoint behind it) gets a 404
  // here and falls through to today's manual flow.
  // Runs exactly once on mount; the empty dep array is deliberate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchServerConfig();
      if (cancelled || !remote) return;
      const urlParams = new URLSearchParams(window.location.search);
      const engagementId =
        urlParams.get("engagement") ?? remote.engagement?.id ?? undefined;
      const next: BrokerConfig = {
        url: remote.broker.url,
        vpnName: remote.broker.vpn,
        userName: remote.broker.username,
        password: remote.broker.password,
        namespace: remote.namespace,
        subscribeFeedback: false,
        engagementId: engagementId || undefined,
      };
      setMode("live");
      handleConnect(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={shell}>
      <Controls
        mode={mode}
        setMode={(m) => {
          if (m === "sim") {
            brokerRef.current?.disconnect();
            brokerRef.current = null;
            setLiveStatus("disconnected");
          } else {
            stopSim();
          }
          setMode(m);
        }}
        scenarioId={scenarioId}
        setScenarioId={setScenarioId}
        running={running}
        onStart={startSim}
        onStop={stopSim}
        speed={speed}
        setSpeed={setSpeed}
        loop={loop}
        setLoop={setLoop}
        onOpenConnect={() => setShowConfig(true)}
        liveStatus={liveStatus}
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        themeName={themeName}
        setThemeName={setThemeName}
        showLabels={showLabels}
        setShowLabels={setShowLabels}
        showLegend={showLegend}
        setShowLegend={setShowLegend}
        historyCap={historyCap}
        setHistoryCap={setHistoryCap}
      />

      <main style={main}>
        <section style={canvasWrap}>
          <Canvas
            bus={bus}
            animations={animations}
            renderMode={renderMode}
            theme={theme}
            showLabels={showLabels}
            selectedId={selected?.id ?? null}
            onSelectNode={(n) => setSelected(n)}
            spotlightTask={spotlightTask}
          />
          <DetailPanel bus={bus} selected={selected} onClose={() => setSelected(null)} />
          {showLegend && <Legend />}
        </section>
        <aside style={timelineWrap}>
          <Timeline
            bus={bus}
            animations={animations}
            onClear={clearAll}
            onRewind={mode === "sim" ? rewind : undefined}
            rewindEnabled={mode === "sim"}
            onReplay={mode === "live" ? startReplay : undefined}
            replayEnabled={mode === "live" && bus.getHistory().length > 0}
            replaying={replaying}
            caughtUp={caughtUp}
            showDiscovery={showDiscovery}
            setShowDiscovery={setShowDiscovery}
            spotlightTask={spotlightTask}
            onSpotlight={setSpotlightTask}
          />
        </aside>
      </main>

      {showConfig && (
        <ConfigPanel
          initial={brokerCfg}
          onConnect={handleConnect}
          onCancel={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

const shell: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "var(--bg-page)",
  color: "var(--text-primary)",
};
const main: preact.JSX.CSSProperties = {
  flex: 1,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)",
  minHeight: 0,
  minWidth: 0,
  gap: 12,
  padding: 12,
};
const canvasWrap: preact.JSX.CSSProperties = {
  position: "relative",
  background: "var(--bg-canvas)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  overflow: "hidden",
  minHeight: 0,
};
const timelineWrap: preact.JSX.CSSProperties = {
  display: "flex",
  minHeight: 0,
  minWidth: 0,
};
