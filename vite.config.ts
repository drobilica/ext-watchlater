import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  base: "./",
  plugins: [
    webExtension({
      manifest: "src/manifest.json",
      browser: "firefox",
      disableAutoLaunch: true,
    }),
  ],
  build: {
    outDir: "build/extension",
    emptyOutDir: true,
    sourcemap: false,
  },
});
