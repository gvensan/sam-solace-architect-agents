import { useEffect, useMemo, useRef } from "preact/hooks";
import * as d3 from "d3";
import type { EventBus } from "../bus/eventBus";
import type { MeshState } from "../bus/types";
import { AnimationQueue, type AnimationRegistry } from "../bus/animations";
import { extractAgentCard, extractTaskId } from "../parse/payload";
import { shortTaskId } from "../state/colors";
import type { Theme } from "./theme";
import { useBusVersion } from "./useBusVersion";
import {
  BROKER_NODE_ID,
  DEFAULT_LAYOUT,
  ZONES,
  buildLayout,
  findNode,
  type PositionedNode,
} from "../layout/zones";
import type { A2AEvent } from "../bus/types";
import { staleAgents } from "../state/ttl";

interface CanvasProps {
  bus: EventBus;
  animations: AnimationRegistry;
  renderMode: "sequence" | "realtime";
  theme: Theme;
  showLabels: boolean;
  onSelectNode?: (node: PositionedNode | null) => void;
  selectedId?: string | null;
  /** Root task id to spotlight. Nodes not involved in this task lineage are
   * dimmed so the viewer can read just one task's flow. */
  spotlightTask?: string | null;
}

const PARTICLE_COLORS: Record<A2AEvent["kind"], string> = {
  discovery: "#ffffff",
  request: "#3b82f6",
  status: "#00C895",
  response: "#22c55e",
  "delegation-status": "#f59e0b",
  "delegation-response": "#fbbf24",
};

interface ParticlePlan {
  fromId: string;
  toId: string;
  /** Optional waypoint the path must traverse — used so messages visibly pass
   * through the broker, which is how SAM actually delivers A2A traffic. */
  viaId?: string;
  color: string;
  thickness: number;
  duration: number;
  direction: 1 | -1;
  dasharray?: string;
  taskLabel?: string;
  /** When true, emit a small sparkle burst on the target as the dot lands —
   * used to celebrate task completion (response arriving at a gateway). */
  burst?: boolean;
}

/** Walk up the parentTask chain to the root so a delegation edge shows the
 * parent task's id rather than the sub-task's distinct id. */
function rootTaskId(state: MeshState, taskId: string): string {
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

function resolveTaskColor(event: A2AEvent, state: MeshState, fallback: string): { color: string; labelId?: string } {
  const tid = event.taskId ?? event.subTaskId ?? extractTaskId(event.payload) ?? undefined;
  if (!tid) return { color: fallback };
  const task = state.tasks.get(tid);
  const rootId = rootTaskId(state, tid);
  return { color: task?.color ?? fallback, labelId: rootId };
}

function planFromEvent(event: A2AEvent, nodes: PositionedNode[], state: MeshState): ParticlePlan | null {
  const agent = (name?: string) => (name ? findNode(nodes, `ag:${name}`) : undefined);
  const gw = (id?: string) => (id ? findNode(nodes, `gw:${id}`) : undefined);

  switch (event.kind) {
    case "discovery":
      return null;
    case "request": {
      const target = agent(event.agentName);
      if (!target) return null;
      const orch = nodes.find((n) => n.kind === "orchestrator");
      const source = orch && target.kind === "agent" ? orch : nodes.find((n) => n.kind === "gateway");
      if (!source) return null;
      const { color, labelId } = resolveTaskColor(event, state, PARTICLE_COLORS.request);
      return {
        fromId: source.id,
        toId: target.id,
        viaId: BROKER_NODE_ID,
        color,
        thickness: 2,
        duration: 900,
        direction: 1,
        taskLabel: labelId ? shortTaskId(labelId) : undefined,
      };
    }
    case "status": {
      const target = gw(event.gatewayId);
      if (!target) return null;
      const source = nodes.find((n) => n.kind === "agent") ?? nodes.find((n) => n.kind === "orchestrator");
      if (!source) return null;
      const { color, labelId } = resolveTaskColor(event, state, PARTICLE_COLORS.status);
      return {
        fromId: source.id,
        toId: target.id,
        viaId: BROKER_NODE_ID,
        color,
        thickness: 1.5,
        duration: 700,
        direction: -1,
        dasharray: "6 4",
        taskLabel: labelId ? shortTaskId(labelId) : undefined,
      };
    }
    case "response": {
      const target = gw(event.gatewayId);
      if (!target) return null;
      const source = nodes.find((n) => n.kind === "agent") ?? nodes.find((n) => n.kind === "orchestrator");
      if (!source) return null;
      const { color, labelId } = resolveTaskColor(event, state, PARTICLE_COLORS.response);
      return {
        fromId: source.id,
        toId: target.id,
        viaId: BROKER_NODE_ID,
        color,
        thickness: 3,
        duration: 900,
        direction: -1,
        taskLabel: labelId ? shortTaskId(labelId) : undefined,
        burst: true,
      };
    }
    case "delegation-status":
    case "delegation-response": {
      const source = agent(event.delegatingAgent);
      const target = nodes.find((n) => n.kind === "agent" && n.id !== source?.id);
      if (!source || !target) return null;
      const { color, labelId } = resolveTaskColor(event, state, PARTICLE_COLORS[event.kind]);
      return {
        fromId: target.id,
        toId: source.id,
        viaId: BROKER_NODE_ID,
        color,
        thickness: event.kind === "delegation-response" ? 2.5 : 1.5,
        duration: 800,
        direction: event.kind === "delegation-response" ? -1 : 1,
        dasharray: event.kind === "delegation-status" ? "5 3" : undefined,
        taskLabel: labelId ? shortTaskId(labelId) : undefined,
      };
    }
  }
}

/**
 * Orthogonal "step-line" routing from a to b.
 * Exits the side of the source matching the direction (right for forward,
 * left for backward), turns once at a vertical lane in the middle, and
 * enters the target on the opposite side. Forward and backward edges land
 * on different lanes so request and response do not overlap.
 *
 * When source and target share a column (e.g., agent-to-agent delegation),
 * the path bows out to one side instead of trying to route through 0 dx.
 */
const STUB = 18;
const LANE_OFFSET = 28;
const CORNER_R = 10;

/**
 * Pixel-x of the inter-zone gutter that sits on the source side of `target`.
 *
 * Routing through these gutters keeps the vertical legs of every edge in
 * clear space rather than crossing through node columns (orchestrator,
 * agent, etc). The horizontal legs ride each node's own y, which doesn't
 * collide because every zone has a distinct vertical anchor band.
 */
function approachLaneX(target: PositionedNode, sourceCenter: number, canvasWidth: number): number {
  const idx = ZONES.findIndex((z) => z.id === target.zone);
  if (idx < 0) {
    // Shouldn't happen, but fall back to the old midpoint behavior.
    return (target.x + target.width / 2 + sourceCenter) / 2;
  }
  const targetCenter = target.x + target.width / 2;
  const goingRight = targetCenter > sourceCenter;
  // Going right: gutter between the zone left of target and target itself.
  // Going left:  gutter between target and the zone right of target.
  const a = goingRight ? ZONES[Math.max(0, idx - 1)] : ZONES[idx];
  const b = goingRight ? ZONES[idx] : ZONES[Math.min(ZONES.length - 1, idx + 1)];
  return ((a.xRatio + b.xRatio) / 2) * canvasWidth;
}

function stepPath(a: PositionedNode, b: PositionedNode, direction: 1 | -1): string {
  // Exit and entry sides are determined by geometry: always leave the side
  // of the source that faces the target, and arrive at the side of the
  // target that faces the source. `direction` only controls the lane offset
  // so request/response between the same pair don't overlap pixel-for-pixel.
  const aCenter = a.x + a.width / 2;
  const bCenter = b.x + b.width / 2;
  const sameColumn = Math.abs(aCenter - bCenter) < 5;

  if (sameColumn) {
    // Bow out one side. Forward bows right, backward bows left.
    const side = direction === 1 ? 1 : -1;
    const exitX = side > 0 ? a.x + a.width : a.x;
    const enterX = side > 0 ? b.x + b.width : b.x;
    const stubX = exitX + side * (LANE_OFFSET + STUB);
    return roundedSteps([
      { x: exitX, y: a.y + a.height / 2 },
      { x: stubX, y: a.y + a.height / 2 },
      { x: stubX, y: b.y + b.height / 2 },
      { x: enterX, y: b.y + b.height / 2 },
    ]);
  }

  const goingRight = bCenter > aCenter;
  const ax = goingRight ? a.x + a.width : a.x;
  const bx = goingRight ? b.x : b.x + b.width;
  const ay = a.y + a.height / 2;
  const by = b.y + b.height / 2;

  const laneX =
    approachLaneX(b, aCenter, DEFAULT_LAYOUT.width) +
    (direction === 1 ? -LANE_OFFSET / 2 : LANE_OFFSET / 2);

  return roundedSteps([
    { x: ax, y: ay },
    { x: laneX, y: ay },
    { x: laneX, y: by },
    { x: bx, y: by },
  ]);
}

/**
 * Three-leg orthogonal path that detours through `via`. Used so every A2A
 * message visibly traverses the broker: source exits toward the broker, the
 * dot crosses through the broker (entering one side, leaving the other when
 * a and b are on opposite sides), and continues to the target.
 *
 * If source and target are on the same side of the broker, the path approaches
 * and leaves on the same side, producing a "U" that dips into the broker.
 */
function stepPathVia(a: PositionedNode, via: PositionedNode, b: PositionedNode, direction: 1 | -1): string {
  const aCenter = a.x + a.width / 2;
  const bCenter = b.x + b.width / 2;
  const vCenter = via.x + via.width / 2;

  const aGoingRight = vCenter >= aCenter;
  const bGoingRight = bCenter >= vCenter;

  const aExit = aGoingRight ? a.x + a.width : a.x;
  const ay = a.y + a.height / 2;

  const vEntry = aGoingRight ? via.x : via.x + via.width;
  const vExit = bGoingRight ? via.x + via.width : via.x;
  const vy = via.y + via.height / 2;

  const bEntry = bGoingRight ? b.x : b.x + b.width;
  const by = b.y + b.height / 2;

  const laneOffset = direction === 1 ? -LANE_OFFSET / 2 : LANE_OFFSET / 2;
  // Snap each leg's vertical lane to the inter-zone gutter adjacent to its
  // target, so the legs never cut through the orchestrator or agent columns.
  const laneX1 = approachLaneX(via, aCenter, DEFAULT_LAYOUT.width) + laneOffset;
  const laneX2 = approachLaneX(b, vCenter, DEFAULT_LAYOUT.width) + laneOffset;

  // When entry and exit hit the same broker side (same-side source/target),
  // drop the redundant "cross" waypoint so the path doesn't visit one point
  // twice and produce a degenerate corner.
  const pts: Array<{ x: number; y: number }> = [
    { x: aExit, y: ay },
    { x: laneX1, y: ay },
    { x: laneX1, y: vy },
    { x: vEntry, y: vy },
  ];
  if (vEntry !== vExit) pts.push({ x: vExit, y: vy });
  pts.push({ x: laneX2, y: vy }, { x: laneX2, y: by }, { x: bEntry, y: by });

  return roundedSteps(pts);
}

/**
 * Build an SVG path string from a sequence of orthogonal waypoints, inserting
 * a small quadratic at each corner so 90° turns look intentional rather than jagged.
 */
function roundedSteps(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return "";
  const out: string[] = [`M ${pts[0].x},${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const dxIn = Math.sign(curr.x - prev.x);
    const dyIn = Math.sign(curr.y - prev.y);
    const dxOut = Math.sign(next.x - curr.x);
    const dyOut = Math.sign(next.y - curr.y);
    const rIn = Math.min(CORNER_R, Math.hypot(curr.x - prev.x, curr.y - prev.y) / 2);
    const rOut = Math.min(CORNER_R, Math.hypot(next.x - curr.x, next.y - curr.y) / 2);
    out.push(`L ${curr.x - dxIn * rIn},${curr.y - dyIn * rIn}`);
    out.push(`Q ${curr.x},${curr.y} ${curr.x + dxOut * rOut},${curr.y + dyOut * rOut}`);
  }
  const last = pts[pts.length - 1];
  out.push(`L ${last.x},${last.y}`);
  return out.join(" ");
}

export function Canvas({ bus, animations, renderMode, theme, showLabels, onSelectNode, selectedId, spotlightTask }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeRef = useRef<Map<string, number>>(new Map());
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const version = useBusVersion(bus);

  const stale = useMemo(() => new Set(staleAgents(bus.getState(), Date.now())), [version, bus]);
  const nodes = useMemo(
    () => buildLayout({ state: bus.getState(), stale }),
    [version, bus, stale],
  );

  // Compute the set of node ids involved in the spotlighted task lineage.
  // Looking through history (rather than just live state) means the lineage
  // includes nodes that have since gone stale.
  const spotlightIds = useMemo<Set<string> | null>(() => {
    if (!spotlightTask) return null;
    const state = bus.getState();
    const history = bus.getHistory();
    const involved = new Set<string>([BROKER_NODE_ID]);
    for (const e of history) {
      const tid = e.taskId ?? e.subTaskId;
      if (!tid) continue;
      if (rootTaskId(state, tid) !== spotlightTask) continue;
      if (e.gatewayId) involved.add(`gw:${e.gatewayId}`);
      if (e.agentName) involved.add(`ag:${e.agentName}`);
      if (e.delegatingAgent) involved.add(`ag:${e.delegatingAgent}`);
    }
    return involved;
  }, [version, bus, spotlightTask]);

  const queue = useMemo(() => new AnimationQueue(60), []);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const renderModeRef = useRef(renderMode);
  renderModeRef.current = renderMode;
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;

  // Drop any queued work the instant the user flips to real-time so nothing
  // lags behind from the previous mode.
  useEffect(() => {
    if (renderMode === "realtime") queue.clear();
  }, [renderMode, queue]);

  // Set up the zoom/pan behavior once. All visual layers live inside g.viewport
  // so a single transform pans and zooms zones, nodes, particles, and ripples
  // together.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    // Ensure the viewport group exists before zoom events fire.
    if (svg.select("g.viewport").empty()) {
      svg.append("g").attr("class", "viewport");
    }
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3])
      .filter((event: any) => {
        // Allow wheel zoom and primary-button drag; ignore right-click and
        // double-click (double-click is the standard "reset" gesture).
        if (event.type === "dblclick") return false;
        if (event.type === "mousedown" && event.button !== 0) return false;
        return true;
      })
      .on("zoom", (evt) => {
        svg.select<SVGGElement>("g.viewport").attr("transform", evt.transform.toString());
      });
    svg.call(zoom);
    // Disable d3's default double-click-to-zoom; reserve it for fit-to-view.
    svg.on("dblclick.zoom", null);
    svg.on("dblclick", () => {
      svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
    });
    zoomRef.current = zoom;
  }, []);

  // Render zones and nodes
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (svgRef.current === null) return;

    const viewport = svg.selectAll<SVGGElement, null>("g.viewport").data([null]);
    const viewportEnter = viewport.enter().append("g").attr("class", "viewport");
    const viewportAll = viewportEnter.merge(viewport);

    // Zone backgrounds
    const zoneGroup = viewportAll.selectAll<SVGGElement, null>("g.zones").data([null]);
    const zoneEnter = zoneGroup.enter().append("g").attr("class", "zones");
    const zoneAll = zoneEnter.merge(zoneGroup);
    const zoneLabels = zoneAll.selectAll<SVGTextElement, typeof ZONES[number]>("text").data(ZONES, (d) => d.id);
    zoneLabels.exit().remove();
    zoneLabels
      .enter()
      .append("text")
      .attr("class", "zone-label")
      .merge(zoneLabels)
      .attr("x", (d) => d.xRatio * DEFAULT_LAYOUT.width)
      .attr("y", 60)
      .attr("text-anchor", "middle")
      .attr("fill", (d) => zoneAccentFor(d.id, theme))
      .attr("font-family", "system-ui, sans-serif")
      .attr("font-size", 13)
      .attr("letter-spacing", 2)
      .text((d) => d.label.toUpperCase());

    const dividers = zoneAll.selectAll<SVGLineElement, typeof ZONES[number]>("line").data(ZONES, (d) => d.id);
    dividers.exit().remove();
    dividers
      .enter()
      .append("line")
      .merge(dividers)
      .attr("x1", (d) => d.xRatio * DEFAULT_LAYOUT.width)
      .attr("x2", (d) => d.xRatio * DEFAULT_LAYOUT.width)
      .attr("y1", 80)
      .attr("y2", DEFAULT_LAYOUT.height - 20)
      .attr("stroke", theme.zoneDivider)
      .attr("stroke-dasharray", "4 6");

    // Nodes
    const nodeLayer = viewportAll.selectAll<SVGGElement, null>("g.nodes").data([null]);
    const nodeEnter = nodeLayer.enter().append("g").attr("class", "nodes");
    const nodeAll = nodeEnter.merge(nodeLayer);

    const sel = nodeAll
      .selectAll<SVGGElement, PositionedNode>("g.node")
      .data(nodes, (d) => d.id);

    // Exiting nodes fade out so they don't pop off the canvas.
    sel.exit()
      .transition()
      .duration(250)
      .style("opacity", 0)
      .remove();

    const enter = sel
      .enter()
      .append("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .style("opacity", 0)
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("click", (_, d) => onSelectNode?.(d));

    enter
      .append("rect")
      .attr("class", "node-rect")
      .attr("rx", 10)
      .attr("ry", 10);

    // Broker logo: the rect stays as the click/selection target but is
    // visually replaced by an SVG image that hosts the literal "BROKER" mark.
    enter
      .filter((d) => d.kind === "broker")
      .append("image")
      .attr("class", "node-image")
      .attr("href", "/broker.png")
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("pointer-events", "none");

    enter
      .append("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-family", "system-ui, sans-serif")
      .attr("font-size", 12);

    // Newly entered nodes fade in at full size.
    enter.transition().duration(300).style("opacity", 1);

    const merged = enter.merge(sel);

    // Tween position changes on existing nodes (lane wrap, agent reshuffle, etc.)
    // so the layout never visibly snaps. New nodes already have their transform
    // set in the enter block so they don't tween from origin.
    sel
      .transition("layout")
      .duration(400)
      .ease(d3.easeCubicOut)
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    const alphaFor = (d: PositionedNode): number => {
      let a = d.stale ? 0.4 : 1;
      if (spotlightIds && !spotlightIds.has(d.id)) a = Math.min(a, 0.15);
      return a;
    };

    merged
      .select<SVGRectElement>("rect.node-rect")
      .attr("width", (d) => d.width)
      .attr("height", (d) => d.height)
      .attr("fill", (d) => fillFor(d, d.id === selectedId, theme))
      .attr("stroke", (d) => strokeFor(d, d.id === selectedId, theme))
      .attr("stroke-width", (d) =>
        d.kind === "broker" ? 0 : d.id === selectedId ? 2.5 : 1.5,
      )
      .transition("alpha")
      .duration(200)
      .attr("opacity", (d) => (d.kind === "broker" ? 0 : alphaFor(d)));

    merged
      .select<SVGImageElement>("image.node-image")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", (d) => d.width)
      .attr("height", (d) => d.height)
      .transition("alpha")
      .duration(200)
      .attr("opacity", (d) => alphaFor(d));

    merged
      .select<SVGTextElement>("text.node-label")
      .attr("x", (d) => d.width / 2)
      .attr("y", (d) => d.height / 2)
      .attr("fill", theme.textPrimary)
      .attr("font-weight", (d) => (d.kind === "broker" ? 600 : 400))
      .style("display", (d) => (d.kind === "broker" ? "none" : ""))
      .attr("opacity", (d) => alphaFor(d))
      .text((d) => truncateLabel(d.label, d.width));

    // Full label on hover for truncated nodes.
    merged.selectAll("title").remove();
    merged.append<SVGTitleElement>("title").text((d) => d.label);
  }, [nodes, selectedId, onSelectNode, theme, spotlightIds]);

  // Drain animation effects one at a time so the viewer reads each
  // interaction clearly even when events fire back-to-back.
  useEffect(() => {
    const off = bus.on((event, _state, meta) => {
      if (!event) {
        queue.clear();
        animations.clear();
        return;
      }
      // Live events that arrived during a replay are flagged animate=false:
      // they show up in the timeline list but don't animate on the canvas,
      // so the viewer sees only the replay's narrative until it catches up.
      if (meta && !meta.animate) return;

      const seq = event.seq;

      const runHeartbeatWork = async () => {
        const card = extractAgentCard(event.payload);
        if (!card) return;
        const target = findNode(nodesRef.current, `ag:${card.name}`);
        if (!target) return;
        if (seq !== undefined) animations.begin(seq);
        try {
          await runHeartbeat(target);
        } finally {
          if (seq !== undefined) animations.end(seq);
        }
      };

      const runParticleWork = async () => {
        const liveNodes = nodesRef.current;
        const plan = planFromEvent(event, liveNodes, bus.getState());
        if (!plan) return;
        const from = findNode(liveNodes, plan.fromId);
        const to = findNode(liveNodes, plan.toId);
        if (!from || !to) return;
        const via = plan.viaId ? findNode(liveNodes, plan.viaId) : undefined;
        if (seq !== undefined) animations.begin(seq);
        try {
          await runParticle(plan, from, to, via);
        } finally {
          if (seq !== undefined) animations.end(seq);
        }
      };

      const work = event.kind === "discovery" ? runHeartbeatWork : runParticleWork;

      if (renderModeRef.current === "realtime") {
        void work();
      } else {
        queue.enqueue(work);
      }
    });
    return () => off();

    function runParticle(
      plan: ParticlePlan,
      from: PositionedNode,
      to: PositionedNode,
      via?: PositionedNode,
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        const viewport = d3.select(svgRef.current).select<SVGGElement>("g.viewport");
        const layer = viewport.selectAll<SVGGElement, null>("g.particles").data([null]);
        const layerEnter = layer.enter().append("g").attr("class", "particles");
        const layerAll = layerEnter.merge(layer);

        const d = via
          ? stepPathVia(from, via, to, plan.direction)
          : stepPath(from, to, plan.direction);

        const path = layerAll
          .append("path")
          .attr("d", d)
          .attr("fill", "none")
          .attr("stroke", plan.color)
          .attr("stroke-width", plan.thickness)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round")
          .attr("opacity", plan.dasharray ? 0.35 : 0.7);

        const pathNode = path.node();
        if (!pathNode) {
          resolve();
          return;
        }
        const length = pathNode.getTotalLength();

        // Comet-style trail: for solid edges, draw the path progressively in
        // sync with the dot via stroke-dashoffset, so the trail builds up
        // behind the moving particle. Dashed edges keep their dash pattern
        // (the dashes themselves already communicate "in flight").
        if (plan.dasharray) {
          path.attr("stroke-dasharray", plan.dasharray);
        } else {
          path
            .attr("stroke-dasharray", `${length} ${length}`)
            .attr("stroke-dashoffset", length)
            .transition()
            .duration(plan.duration)
            .ease(d3.easeCubicInOut)
            .attr("stroke-dashoffset", 0);
        }

        const dot = layerAll
          .append("circle")
          .attr("r", 5)
          .attr("fill", plan.color)
          .attr("opacity", 0.95);

        // Optional task label at the path midpoint.
        let label: d3.Selection<SVGTextElement, null, SVGGElement | null, unknown> | null = null;
        if (showLabelsRef.current && plan.taskLabel) {
          const mid = pathNode.getPointAtLength(length / 2);
          label = layerAll
            .append<SVGTextElement>("text")
            .attr("x", mid.x)
            .attr("y", mid.y - 6)
            .attr("text-anchor", "middle")
            .attr("font-family", "ui-monospace, SFMono-Regular, Menlo, monospace")
            .attr("font-size", 10)
            .attr("font-weight", 600)
            .attr("fill", plan.color)
            .attr("stroke", theme.bgCanvas)
            .attr("stroke-width", 3)
            .attr("paint-order", "stroke fill")
            .attr("opacity", 0)
            .text(plan.taskLabel);
          label.transition().duration(150).attr("opacity", 0.95);
        }

        pulseNode(plan.toId, plan.color);
        // Light up the broker as the dot transits through it so the
        // pub/sub hop is obvious without slowing the animation.
        if (via) {
          window.setTimeout(() => pulseNode(via.id, plan.color), Math.round(plan.duration * 0.45));
        }

        dot.transition()
          .duration(plan.duration)
          .ease(d3.easeCubicInOut)
          .attrTween("transform", () => (tt: number) => {
            const p = pathNode.getPointAtLength(tt * length);
            return `translate(${p.x},${p.y})`;
          })
          .on("end", () => {
            dot.remove();
            path.transition().duration(300).attr("opacity", 0).remove();
            if (label) {
              // Hold the label briefly after the particle lands so it's readable,
              // then fade. Total visibility ~ animation duration + 700ms.
              label.transition().delay(500).duration(700).attr("opacity", 0).remove();
            }
            // Celebratory sparkle burst when a task completes (response back
            // to gateway) — visual punctuation for "done".
            if (plan.burst) burstAt(to, plan.color);
            resolve();
          });
      });
    }

    /** Six tiny sparks fanning outward from the node centre, fading as they
     * fly. Used as a punctuation mark on task completion. */
    function burstAt(node: PositionedNode, color: string) {
      const viewport = d3.select(svgRef.current).select<SVGGElement>("g.viewport");
      const layer = viewport.selectAll<SVGGElement, null>("g.particles").data([null]);
      const layerEnter = layer.enter().append("g").attr("class", "particles");
      const layerAll = layerEnter.merge(layer);
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const rays = 8;
      for (let i = 0; i < rays; i++) {
        const angle = (Math.PI * 2 * i) / rays;
        const dist = 26 + Math.random() * 8;
        const spark = layerAll
          .append("circle")
          .attr("cx", cx)
          .attr("cy", cy)
          .attr("r", 3)
          .attr("fill", color)
          .attr("opacity", 0.9);
        spark
          .transition()
          .duration(550)
          .ease(d3.easeQuadOut)
          .attr("cx", cx + Math.cos(angle) * dist)
          .attr("cy", cy + Math.sin(angle) * dist)
          .attr("r", 0)
          .attr("opacity", 0)
          .on("end", () => spark.remove());
      }
    }

    function runHeartbeat(node: PositionedNode): Promise<void> {
      return new Promise<void>((resolve) => {
        heartbeatNode(node);
        // Total visual time: 220ms second-ripple delay + 80ms fade-in + 700ms expand
        window.setTimeout(resolve, 1000);
      });
    }

    function pulseNode(nodeId: string, _color: string = "#ffffff") {
      const layer = d3.select(svgRef.current).select<SVGGElement>("g.nodes");
      const target = layer
        .selectAll<SVGGElement, PositionedNode>("g.node")
        .filter((d) => d.id === nodeId);
      const rect = target.select<SVGRectElement>("rect.node-rect");
      if (rect.empty()) return;
      const existingTimer = activeRef.current.get(nodeId);
      if (existingTimer) clearTimeout(existingTimer);
      rect.transition().duration(120).attr("filter", "url(#glow)");
      const handle = window.setTimeout(() => {
        rect.transition().duration(400).attr("filter", null);
        activeRef.current.delete(nodeId);
      }, 700);
      activeRef.current.set(nodeId, handle);
    }

    /**
     * Radiate one or two concentric ripple rings outward from a node.
     * Double-tap creates a lub-dub heartbeat feel for AgentCard heartbeats.
     */
    function heartbeatNode(node: PositionedNode) {
      const viewport = d3.select(svgRef.current).select<SVGGElement>("g.viewport");
      const layer = viewport.selectAll<SVGGElement, null>("g.ripples").data([null]);
      const layerEnter = layer.enter().append("g").attr("class", "ripples");
      const layerAll = layerEnter.merge(layer);
      // Insert ripples below the node layer so the node itself stays on top.
      const ripplesNode = layerAll.node();
      const nodesLayer = viewport.select<SVGGElement>("g.nodes").node();
      if (ripplesNode && nodesLayer && ripplesNode.nextSibling !== nodesLayer) {
        ripplesNode.parentNode?.insertBefore(ripplesNode, nodesLayer);
      }

      const baseColor = node.kind === "orchestrator" ? theme.accentAmber : theme.accentTeal;
      const grow = 28;
      const fire = (delay: number, opacity: number) => {
        const ring = layerAll
          .append("rect")
          .attr("x", node.x - 2)
          .attr("y", node.y - 2)
          .attr("width", node.width + 4)
          .attr("height", node.height + 4)
          .attr("rx", 12)
          .attr("fill", "none")
          .attr("stroke", baseColor)
          .attr("stroke-width", 2)
          .attr("opacity", 0);
        ring.transition()
          .delay(delay)
          .duration(80)
          .attr("opacity", opacity);
        ring.transition()
          .delay(delay + 80)
          .duration(700)
          .ease(d3.easeQuadOut)
          .attr("x", node.x - 2 - grow)
          .attr("y", node.y - 2 - grow)
          .attr("width", node.width + 4 + grow * 2)
          .attr("height", node.height + 4 + grow * 2)
          .attr("rx", 12 + grow / 2)
          .attr("stroke-width", 0.5)
          .attr("opacity", 0)
          .on("end", () => ring.remove());
      };
      fire(0, 0.55);
      fire(220, 0.35);
    }
  }, [bus, animations, queue]);

  // Ambient broker pulse — a slow concentric ring keeps the canvas feeling
  // alive when there's no traffic. Runs on a timer that fires every ~3.2s
  // regardless of activity; the much stronger transit pulses simply overlay
  // it when messages flow.
  useEffect(() => {
    if (!svgRef.current) return;
    const interval = window.setInterval(() => {
      const broker = findNode(nodesRef.current, BROKER_NODE_ID);
      if (!broker) return;
      const viewport = d3.select(svgRef.current).select<SVGGElement>("g.viewport");
      const layer = viewport.selectAll<SVGGElement, null>("g.ambient").data([null]);
      const layerEnter = layer.enter().insert("g", "g.nodes").attr("class", "ambient");
      const layerAll = layerEnter.merge(layer);
      const cx = broker.x + broker.width / 2;
      const cy = broker.y + broker.height / 2;
      const r0 = broker.width / 2 + 4;
      const ring = layerAll
        .append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", r0)
        .attr("fill", "none")
        .attr("stroke", theme.accentTeal)
        .attr("stroke-width", 1.5)
        .attr("opacity", 0);
      ring.transition()
        .duration(150)
        .attr("opacity", 0.35);
      ring.transition()
        .delay(150)
        .duration(2400)
        .ease(d3.easeQuadOut)
        .attr("r", r0 + 60)
        .attr("stroke-width", 0.3)
        .attr("opacity", 0)
        .on("end", () => ring.remove());
    }, 3200);
    return () => window.clearInterval(interval);
  }, [theme]);

  const zoomBy = (factor: number) => {
    const svg = d3.select(svgRef.current);
    const zoom = zoomRef.current;
    if (!zoom || !svgRef.current) return;
    svg.transition().duration(180).call(zoom.scaleBy as any, factor);
  };
  const resetZoom = () => {
    const svg = d3.select(svgRef.current);
    const zoom = zoomRef.current;
    if (!zoom || !svgRef.current) return;
    svg.transition().duration(220).call(zoom.transform as any, d3.zoomIdentity);
  };

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${DEFAULT_LAYOUT.width} ${DEFAULT_LAYOUT.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", background: theme.bgCanvas, cursor: "grab" }}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
      <div style={zoomToolbar}>
        <button style={zoomBtn} onClick={() => zoomBy(1.25)} title="Zoom in (wheel up)">+</button>
        <button style={zoomBtn} onClick={() => zoomBy(0.8)} title="Zoom out (wheel down)">−</button>
        <button style={zoomBtn} onClick={resetZoom} title="Reset view (double-click canvas)">⊙</button>
      </div>
    </>
  );
}

const zoomToolbar: preact.JSX.CSSProperties = {
  // Top-right is taken by the DetailPanel when a node is selected, so anchor
  // the zoom controls to the top-left where the canvas is otherwise empty.
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 4,
  zIndex: 2,
};

const zoomBtn: preact.JSX.CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--text-primary)",
  border: "1px solid transparent",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
};

function fillFor(d: PositionedNode, selected: boolean, theme: Theme): string {
  if (selected) return theme.nodeFillSelected;
  switch (d.kind) {
    case "external": return theme.nodeFillExternal;
    case "service":  return theme.nodeFillService;
    case "gateway":  return theme.nodeFillGateway;
    case "orchestrator": return theme.nodeFillOrchestrator;
    case "agent":    return theme.nodeFillAgent;
    case "broker":   return theme.nodeFillGateway;
  }
}

function strokeFor(d: PositionedNode, selected: boolean, theme: Theme): string {
  if (selected) return theme.textPrimary;
  switch (d.kind) {
    case "external":
    case "service":
      return theme.nodeStrokeNeutral;
    case "gateway":      return theme.accentTeal;
    case "orchestrator": return theme.accentAmber;
    case "agent":        return theme.accentTeal;
    case "broker":       return theme.accentTeal;
  }
}

/** Trim long labels with an ellipsis when the node is too narrow to fit them. */
function truncateLabel(label: string, width: number): string {
  // 12px system font ≈ 6.3px/char average; leave 12px horizontal padding.
  const maxChars = Math.max(4, Math.floor((width - 12) / 6.3));
  if (label.length <= maxChars) return label;
  return label.slice(0, Math.max(1, maxChars - 1)) + "…";
}

function zoneAccentFor(zoneId: PositionedNode["zone"], theme: Theme): string {
  switch (zoneId) {
    case "gateway":      return theme.accentTeal;
    case "mesh":         return theme.accentTeal;
    case "orchestrator": return theme.accentAmber;
    case "agent":        return theme.accentTeal;
    case "external":
    case "service":
      return theme.zoneLabel;
  }
}
