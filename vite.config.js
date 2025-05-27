import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

function localPolyfill(name) {
  return path.resolve(
    __dirname,
    "src",
    "polyfills",
    ...name.split("/"),
    "index.ts"
  );
}
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  build: {
    rollupOptions: {
      external: [
        "v8",
        "worker_threads",
        "electron",
        "hadron-ipc",
        "mongodb-client-encryption",
        "kerberos",
        "http",
        "child_process",
      ],
    },
  },
  resolve: {
    alias: {
      "fs/promises": localPolyfill("fs/promises"),
      // "mongodb-client-encryption": localPolyfill("throwError"),
      tr46: localPolyfill("tr46"),
      net: localPolyfill("net"),
      // kerberos: localPolyfill("throwError"),
      // socks: localPolyfill("throwError"),
      // http: localPolyfill("throwError"),
      //crypto: require.resolve("crypto-browserify"),
    },
  },
});
