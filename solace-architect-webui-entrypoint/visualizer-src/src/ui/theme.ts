export type ThemeName = "dark" | "light";

export interface Theme {
  name: ThemeName;
  bgPage: string;
  bgCanvas: string;
  bgPanel: string;
  bgPanelHeader: string;
  bgInput: string;
  bgHover: string;
  border: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  zoneDivider: string;
  zoneLabel: string;
  nodeFillExternal: string;
  nodeFillGateway: string;
  nodeFillOrchestrator: string;
  nodeFillAgent: string;
  nodeFillService: string;
  nodeFillSelected: string;
  nodeStrokeNeutral: string;
  shadow: string;
  accentTeal: string;
  accentAmber: string;
  accentBlue: string;
  accentGreen: string;
  accentGray: string;
}

export const DARK_THEME: Theme = {
  name: "dark",
  bgPage: "#070b15",
  bgCanvas: "#0b1220",
  bgPanel: "#101828",
  bgPanelHeader: "#0a1220",
  bgInput: "#0a1220",
  bgHover: "#142033",
  border: "#1f2937",
  borderSubtle: "#1a2230",
  textPrimary: "#e6e9ef",
  textSecondary: "#cfd5e0",
  textMuted: "#7c8595",
  textDim: "#5b6573",
  zoneDivider: "#1a2230",
  zoneLabel: "#8a8f99",
  nodeFillExternal: "#0f1726",
  nodeFillGateway: "#0d1f24",
  nodeFillOrchestrator: "#1f1608",
  nodeFillAgent: "#0c1c14",
  nodeFillService: "#0f1726",
  nodeFillSelected: "#142033",
  nodeStrokeNeutral: "#3a4252",
  shadow: "0 4px 24px rgba(0,0,0,0.4)",
  accentTeal: "#00C895",
  accentAmber: "#f59e0b",
  accentBlue: "#3b82f6",
  accentGreen: "#22c55e",
  accentGray: "#8a8f99",
};

export const LIGHT_THEME: Theme = {
  name: "light",
  bgPage: "#f5f7fa",
  bgCanvas: "#ffffff",
  bgPanel: "#ffffff",
  bgPanelHeader: "#f1f4f8",
  bgInput: "#ffffff",
  bgHover: "#eef1f6",
  border: "#dde2ea",
  borderSubtle: "#e7ebf1",
  textPrimary: "#0f172a",
  textSecondary: "#3b4555",
  textMuted: "#6b7280",
  textDim: "#a0aab8",
  zoneDivider: "#d4dae4",
  zoneLabel: "#64748b",
  nodeFillExternal: "#f8fafc",
  nodeFillGateway: "#ecfeff",
  nodeFillOrchestrator: "#fff7ed",
  nodeFillAgent: "#ecfdf5",
  nodeFillService: "#f8fafc",
  nodeFillSelected: "#eef1f6",
  nodeStrokeNeutral: "#cbd5e1",
  shadow: "0 4px 20px rgba(15, 23, 42, 0.10)",
  accentTeal: "#00a679",
  accentAmber: "#d97706",
  accentBlue: "#2563eb",
  accentGreen: "#16a34a",
  accentGray: "#64748b",
};

export const THEMES: Record<ThemeName, Theme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

/**
 * Push every token from the theme onto :root as a CSS variable so inline
 * styles in components can reference `var(--text-primary)` etc. without
 * caring about which theme is active.
 */
export function applyThemeVars(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value !== "string") continue;
    const cssVar = "--" + key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    root.style.setProperty(cssVar, value);
  }
  root.setAttribute("data-theme", theme.name);
}
