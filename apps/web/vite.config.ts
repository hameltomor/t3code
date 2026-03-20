import * as fs from "node:fs";
import * as path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const port = Number(process.env.PORT ?? 5733);

/**
 * Replace the `__SW_VERSION__` placeholder in `public/sw.js` with the
 * package version after Vite copies public assets to the output directory.
 * This ensures every release produces a byte-different `sw.js`, so browsers
 * detect the new service worker and show the update banner automatically.
 */
function swVersionPlugin(): Plugin {
  return {
    name: "sw-version",
    apply: "build",
    closeBundle() {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
      const swPath = path.resolve(__dirname, "dist", "sw.js");
      const content = fs.readFileSync(swPath, "utf8");
      fs.writeFileSync(swPath, content.replace('"__SW_VERSION__"', JSON.stringify(pkg.version)));
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    tailwindcss(),
    swVersionPlugin(),
  ],
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    __APP_VERSION__: JSON.stringify(
      JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")).version,
    ),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port,
    strictPort: true,
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The app intentionally ships a large syntax-highlighting surface. Keep the
    // warning budget above the known steady-state bundle while we split this further.
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
});
