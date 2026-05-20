import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "path";

// Embedded build for the Solace Architect WebUI entrypoint.
//   base       — every asset URL inside index.html becomes /visualizer/<asset>,
//                matching the route the entrypoint mounts the app under.
//   outDir     — writes the build straight into the Python plugin's static
//                folder, so a single `npm run build` is all that's needed
//                before committing.
//   emptyOutDir — wipes the previous build first so stale hashed bundles
//                don't accumulate.
export default defineConfig({
  base: "/visualizer/",
  plugins: [preact()],
  resolve: {
    // Legacy `.js` files shadowed the `.ts`/`.tsx` rewrites in upstream
    // sam-visualizer. We stripped them on fork, so this is belt-and-braces.
    extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"],
  },
  build: {
    outDir: resolve(
      __dirname,
      "../src/solace_architect_webui_entrypoint/webui/visualizer",
    ),
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
