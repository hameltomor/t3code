import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  checks: {
    legacyCjs: false,
    pluginTimings: false,
  },
});
