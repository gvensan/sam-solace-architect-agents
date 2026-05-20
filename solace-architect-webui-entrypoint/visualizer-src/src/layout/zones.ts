import type { AgentRecord, GatewayRecord, MeshState } from "../bus/types";

export type ZoneId = "external" | "gateway" | "mesh" | "orchestrator" | "agent" | "service";

export interface Zone {
  id: ZoneId;
  label: string;
  xRatio: number;
  color: string;
}

export const ZONES: Zone[] = [
  { id: "external", label: "External", xRatio: 0.06, color: "#8a8f99" },
  { id: "gateway", label: "Gateways", xRatio: 0.22, color: "#00b3c8" },
  { id: "mesh", label: "Event Mesh", xRatio: 0.42, color: "#00C895" },
  { id: "orchestrator", label: "Orchestrator", xRatio: 0.62, color: "#f59e0b" },
  { id: "agent", label: "Agents", xRatio: 0.80, color: "#00C895" },
  { id: "service", label: "Services", xRatio: 0.95, color: "#8a8f99" },
];

export interface PositionedNode {
  id: string;
  kind: "gateway" | "orchestrator" | "agent" | "external" | "service" | "broker";
  label: string;
  zone: ZoneId;
  x: number;
  y: number;
  width: number;
  height: number;
  stale?: boolean;
}

/** Stable id for the singleton broker node placed in the mesh lane. */
export const BROKER_NODE_ID = "broker:mesh";

export interface LayoutConfig {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  rowGap: number;
  topMargin: number;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  width: 1280,
  height: 720,
  nodeWidth: 140,
  nodeHeight: 56,
  rowGap: 22,
  topMargin: 120,
};

export type ZoneAnchor = "top" | "upper" | "middle" | "lower" | "bottom";

const ANCHOR_RATIO: Record<ZoneAnchor, number> = {
  top: 0.08,
  upper: 0.28,
  middle: 0.5,
  lower: 0.62,
  bottom: 0.85,
};

const COLUMN_GAP = 12;

/** How wide a node should be when its lane has been split into N columns. */
function nodeWidthForCols(cols: number, full: number): number {
  if (cols <= 1) return full;
  if (cols === 2) return Math.round(full * 0.68);
  if (cols === 3) return Math.round(full * 0.54);
  return Math.max(60, Math.round(full * 0.92 / cols));
}

/** How many rows fit between the lane label and the canvas floor. */
function maxRowsForBand(cfg: LayoutConfig): number {
  const stride = cfg.nodeHeight + cfg.rowGap;
  const usable = cfg.height - 40 - cfg.topMargin;
  return Math.max(1, Math.floor((usable + cfg.rowGap) / stride));
}

interface GridSlot {
  x: number;
  y: number;
  w: number;
}

/**
 * Place `count` nodes inside a single lane, wrapping into multiple columns when
 * the count exceeds what fits vertically. The grid is centered on `centerX`
 * horizontally and around the anchor band vertically; node width shrinks as
 * the column count grows so neighboring zones aren't crowded out.
 */
function distributeGrid(
  count: number,
  cfg: LayoutConfig,
  anchor: ZoneAnchor,
  centerX: number,
): GridSlot[] {
  if (count === 0) return [];
  const fitRows = maxRowsForBand(cfg);
  const cols = Math.max(1, Math.ceil(count / fitRows));
  // Balance the grid: use the minimum number of rows that still fits all nodes
  // in `cols` columns, so a 10-agent lane becomes 5x2 rather than 7x2.
  const rows = Math.min(fitRows, Math.ceil(count / cols));

  const w = nodeWidthForCols(cols, cfg.nodeWidth);
  const totalW = cols * w + (cols - 1) * COLUMN_GAP;
  const startX = centerX - totalW / 2;

  const stride = cfg.nodeHeight + cfg.rowGap;
  const usableTop = cfg.topMargin;
  const usableBottom = cfg.height - 40;
  const usable = usableBottom - usableTop;
  const totalH = rows * stride - cfg.rowGap;
  const anchorY = usableTop + usable * ANCHOR_RATIO[anchor];
  let startY = anchorY - totalH / 2;
  if (startY < usableTop) startY = usableTop;
  if (startY + totalH > usableBottom) startY = usableBottom - totalH;

  const out: GridSlot[] = [];
  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    out.push({
      x: startX + col * (w + COLUMN_GAP),
      y: startY + row * stride,
      w,
    });
  }
  return out;
}

/**
 * Map a gateway id to an inferred external system label by name pattern.
 * The visualizer cannot observe upstream clients directly (they live above
 * the broker), so this is a best-effort label based on how SAM projects
 * tend to name gateway components.
 */
const EXTERNAL_HEURISTICS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|[_-])webui/i, label: "Web UI" },
  { pattern: /(?:^|[_-])sse/i, label: "Web UI" },
  { pattern: /^slack/i, label: "Slack" },
  { pattern: /^teams/i, label: "Teams" },
  { pattern: /^rest/i, label: "REST" },
  { pattern: /^cli/i, label: "CLI" },
  { pattern: /^github/i, label: "GitHub" },
  { pattern: /^webhook/i, label: "Webhook" },
  { pattern: /^event[-_]?mesh/i, label: "Event Mesh" },
];

export function inferExternalLabel(gatewayId: string): string {
  for (const h of EXTERNAL_HEURISTICS) {
    if (h.pattern.test(gatewayId)) return h.label;
  }
  return "Client";
}

const STATIC_SERVICES = [
  { id: "svc:llm", label: "LLMs" },
  { id: "svc:data", label: "Data" },
];

export interface BuildLayoutArgs {
  state: MeshState;
  stale?: Set<string>;
  cfg?: LayoutConfig;
}

export function buildLayout({ state, stale, cfg = DEFAULT_LAYOUT }: BuildLayoutArgs): PositionedNode[] {
  const out: PositionedNode[] = [];
  const zoneCenterX = (z: ZoneId) => {
    const ratio = ZONES.find((zz) => zz.id === z)?.xRatio ?? 0.5;
    return ratio * cfg.width;
  };

  const gateways: GatewayRecord[] = [...state.gateways.values()].sort((a, b) => a.id.localeCompare(b.id));

  // Externals are derived from the gateways the visualizer actually observes.
  // One external box per distinct inferred label.
  const externalLabels: string[] = [];
  const seenExternal = new Set<string>();
  for (const g of gateways) {
    const label = inferExternalLabel(g.id);
    if (!seenExternal.has(label)) {
      seenExternal.add(label);
      externalLabels.push(label);
    }
  }
  const externals = distributeGrid(externalLabels.length, cfg, "top", zoneCenterX("external"));
  externalLabels.forEach((label, i) => {
    out.push({
      id: `ext:${label}`,
      kind: "external",
      label,
      zone: "external",
      x: externals[i].x,
      y: externals[i].y,
      width: externals[i].w,
      height: cfg.nodeHeight,
    });
  });

  // The broker is always present — every A2A interaction in SAM flows through it,
  // so we keep it in the diagram even when no agents have been discovered yet.
  // Rendered as a square so the circular logo can be the visual anchor.
  const brokerSize = 120;
  const brokerCenterY =
    cfg.topMargin + (cfg.height - 40 - cfg.topMargin) * ANCHOR_RATIO.middle;
  out.push({
    id: BROKER_NODE_ID,
    kind: "broker",
    label: "Event Broker",
    zone: "mesh",
    x: zoneCenterX("mesh") - brokerSize / 2,
    y: brokerCenterY - brokerSize / 2,
    width: brokerSize,
    height: brokerSize,
  });

  const gws = distributeGrid(gateways.length, cfg, "top", zoneCenterX("gateway"));
  gateways.forEach((g, i) => {
    out.push({
      id: `gw:${g.id}`,
      kind: "gateway",
      label: g.id,
      zone: "gateway",
      x: gws[i].x,
      y: gws[i].y,
      width: gws[i].w,
      height: cfg.nodeHeight,
    });
  });

  const agents = [...state.agents.values()];
  const orchestrators = agents.filter((a) => a.isOrchestrator).sort(byName);
  const others = agents.filter((a) => !a.isOrchestrator).sort(byName);

  const orchs = distributeGrid(orchestrators.length, cfg, "upper", zoneCenterX("orchestrator"));
  orchestrators.forEach((a, i) => {
    out.push({
      id: `ag:${a.name}`,
      kind: "orchestrator",
      label: a.name,
      zone: "orchestrator",
      x: orchs[i].x,
      y: orchs[i].y,
      width: orchs[i].w,
      height: cfg.nodeHeight,
      stale: stale?.has(a.name),
    });
  });

  const othersG = distributeGrid(others.length, cfg, "lower", zoneCenterX("agent"));
  others.forEach((a, i) => {
    out.push({
      id: `ag:${a.name}`,
      kind: "agent",
      label: a.name,
      zone: "agent",
      x: othersG[i].x,
      y: othersG[i].y,
      width: othersG[i].w,
      height: cfg.nodeHeight,
      stale: stale?.has(a.name),
    });
  });

  const svcs = distributeGrid(STATIC_SERVICES.length, cfg, "middle", zoneCenterX("service"));
  STATIC_SERVICES.forEach((s, i) => {
    out.push({
      id: s.id,
      kind: "service",
      label: s.label,
      zone: "service",
      x: svcs[i].x,
      y: svcs[i].y,
      width: svcs[i].w,
      height: cfg.nodeHeight,
    });
  });

  return out;
}

function byName(a: AgentRecord, b: AgentRecord) {
  return a.name.localeCompare(b.name);
}

export function findNode(nodes: PositionedNode[], id: string): PositionedNode | undefined {
  return nodes.find((n) => n.id === id);
}
