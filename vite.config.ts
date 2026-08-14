import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

const root = dirname(fileURLToPath(import.meta.url));

function copyIcons() {
  return {
    name: "copy-icons",
    closeBundle() {
      const dest = resolve(root, "build/extension/icons/icon.svg");
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(resolve(root, "src/icons/icon.svg"), dest);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    webExtension({
      manifest: "src/manifest.json",
      browser: "firefox",
      disableAutoLaunch: true,
    }),
    copyIcons(),
  ],
  build: {
    outDir: "build/extension",
    emptyOutDir: true,
    sourcemap: false,
  },
});

