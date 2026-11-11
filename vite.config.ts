import { defineConfig } from "vite";

// Settings follow the Tauri v2 guide. The web build goes to web-build/,
// which Tauri packs inside the EXE.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**"] } },
  build: { outDir: "web-build", emptyOutDir: true, target: "es2021", minify: "esbuild" },
});
