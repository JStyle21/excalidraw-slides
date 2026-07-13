import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBasePath =
  process.env.VITE_BASE_PATH ??
  (process.env.GITHUB_ACTIONS === "true" && repoName ? `/${repoName}/` : "/");

export default defineConfig({
  base: pagesBasePath,
  plugins: [react()],
  server: {
    port: 4173,
    watch: {
      ignored: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/playwright.config.ts",
        "**/vitest.config.ts",
        "**/coverage/**",
      ],
      usePolling: true,
      interval: 250,
    },
  },
});
