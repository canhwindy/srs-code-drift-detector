import fs from "fs";
import path from "path";
// @ts-expect-error Types are not resolved correctly in this environment but it works
import react from "@vitejs/plugin-react-oxc";
import browserslistToEsbuild from "browserslist-to-esbuild";
import webpackStats from "rollup-plugin-webpack-stats";
import { ServerOptions, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import environment from "./server/utils/environment";

let httpsConfig: ServerOptions["https"] | undefined;
let host: string | undefined;

if (environment.NODE_ENV === "development") {
  host = new URL(environment.URL!).hostname;

  // Disable HTTPS for local development - use HTTP instead
// try {
//   httpsConfig = {
//   key: fs.readFileSync("./server/config/certs/private.key"),
//   cert: fs.readFileSync("./server/config/certs/public.cert"),
//   };
// } catch (_err) {
//  // oxlint-disable-next-line no-console
//   console.warn("No local SSL certs found, HTTPS will not be available");
//  }
}

export default () =>
  defineConfig({
    root: "./",
    publicDir: "./server/static",
    base: (environment.CDN_URL ?? "") + "/static/",
    server: {
      port: 3001,
      host: true,
      https: httpsConfig,
      allowedHosts: host ? [host] : undefined,
      cors: true,
      // Forward reverse-proxy prefixes to their upstream dev servers so the
      // frontend keeps using relative URLs (e.g. `/python-api/...`) regardless
      // of environment. Override targets via env when running containers with
      // non-default host ports.
      proxy: {
        "/python-api": {
          target:
            process.env.VITE_DEV_PYTHON_BACKEND_URL ?? "http://localhost:8000",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/python-api/, ""),
        },
        "/filesplit-api": {
          target:
            process.env.VITE_DEV_FILESPLIT_URL ?? "http://localhost:5000",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/filesplit-api/, ""),
        },
        "/cliproxy": {
          target: process.env.VITE_DEV_CLIPROXY_URL ?? "http://localhost:8317",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/cliproxy/, ""),
        },
        "/gapfinding": {
          target:
            process.env.VITE_DEV_GAPFINDING_URL ?? "http://localhost:8011",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/gapfinding/, ""),
        },
      },
      fs:
        environment.NODE_ENV === "development"
          ? {
            // Allow serving files from one level up to the project root
            allow: [".."],
          }
          : { strict: true },
    },
    plugins: [
      react(),
      // https://vite-pwa-org.netlify.app/
      VitePWA({
        injectRegister: "inline",
        registerType: "autoUpdate",
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ["**/*.{js,css,ico,png,svg}"],
          navigateFallback: null,
          modifyURLPrefix: {
            "": `${environment.CDN_URL ?? ""}/static/`,
          },
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: /api\/urls\.unfurl$/,
              handler: "CacheOnly",
              options: {
                cacheName: "unfurl-cache",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /api\/files\.get/,
              handler: "CacheFirst",
              options: {
                cacheName: "files-cache",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 604800, // 7 days
                },
                cacheableResponse: {
                  statuses: [0, 200, 206], // Include partial content for range requests
                },
                rangeRequests: true, // Allow range requests for partial content
              },
            },
          ],
        },
        manifest: {
          name: "Outline",
          short_name: "Outline",
          theme_color: "#fff",
          background_color: "#fff",
          start_url: "/",
          scope: ".",
          display: "standalone",
          // For Chrome, you must provide at least a 192x192 pixel icon, and a 512x512 pixel icon.
          // If only those two icon sizes are provided, Chrome will automatically scale the icons
          // to fit the device. If you'd prefer to scale your own icons, and adjust them for
          // pixel-perfection, provide icons in increments of 48dp.
          icons: [
            {
              src: "/images/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/images/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            // last one duplicated for purpose: 'any maskable'
            {
              src: "/images/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
      }),
      // Generate a stats.json file for webpack that will be consumed by RelativeCI
      webpackStats(),
    ],
    experimental: {
      enableNativePlugin: true,
    },
    resolve: {
      alias: {
        "~": path.resolve(__dirname, "./app"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
    },
    build: {
      outDir: "./build/app",
      manifest: true,
      sourcemap: process.env.CI ? false : "hidden",
      minify: "oxc",
      // Prevent asset inlining as it does not conform to CSP rules
      assetsInlineLimit: 0,
      target: browserslistToEsbuild(),
      reportCompressedSize: false,
      rollupOptions: {
        onwarn(warning, warn) {
          // Suppress noisy warnings about module-level directives, e.g. "use client"
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
            return;
          }
          warn(warning);
        },
        input: {
          index: "./app/index.tsx",
        },
        output: {
          assetFileNames: "assets/[name].[hash][extname]",
          chunkFileNames: "assets/[name].[hash].js",
          entryFileNames: "assets/[name].[hash].js",
        },
      },
    },
  });
