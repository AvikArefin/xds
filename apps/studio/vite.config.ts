import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const apiPort = process.env.XDS_API_PORT ?? "8765";

/**
 * Serve three's glTF Draco decoder at /draco/ (dev) and emit it into dist/draco/ (build), so
 * models decode offline instead of fetching the decoder from a CDN.
 */
function dracoDecoder(): Plugin {
  // three's "exports" hide package.json; resolve the main entry and walk up to the package root.
  const root = join(dirname(require.resolve("three")), "..");
  const dir = join(root, "examples/jsm/libs/draco/gltf");
  const files = readdirSync(dir).filter((f) => f.startsWith("draco_") && !f.includes("encoder"));
  const types: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm" };
  return {
    name: "xds-draco-decoder",
    configureServer(server) {
      server.middlewares.use("/draco", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0];
        if (!files.includes(name)) return next();
        res.setHeader("Content-Type", types[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream");
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: "asset", fileName: `draco/${name}`, source: new Uint8Array(readFileSync(join(dir, name))) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dracoDecoder()],
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
