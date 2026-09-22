import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/cli/evaluate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (TypeScript source); keep real npm deps external.
  noExternal: ["@preptrace/shared"],
  // Dev-only embedded database; never bundled into the production server.
  external: ["mongodb-memory-server"],
});
