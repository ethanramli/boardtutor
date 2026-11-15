import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

cpSync(resolve("node_modules/@excalidraw/excalidraw/dist/prod/fonts"), resolve("public/fonts"), {
  recursive: true,
});

export default defineConfig({
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
});
