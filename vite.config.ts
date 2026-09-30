// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Tailwind 4 writes screen-size rules as `@media (width<=1023px)`. Safari before iOS 16.4
// (for example an iPhone 14 still on iOS 16.0 to 16.3) ignores that form, so the desktop layout
// shows on phones. This turns those rules back into the classic `min-width` / `max-width` form
// that every Safari understands. It only rewrites the built CSS files.
const classicMediaQueries = {
  name: "classic-media-queries",
  enforce: "post" as const,
  generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string; source?: unknown }>) {
    for (const file of Object.values(bundle)) {
      if (file.type !== "asset" || !file.fileName.endsWith(".css") || typeof file.source !== "string") continue;
      file.source = file.source
        .replace(/\(width<=([^)]+)\)/g, "(max-width:$1)")
        .replace(/\(width>=([^)]+)\)/g, "(min-width:$1)")
        .replace(/\(width<([^)]+)\)/g, "(max-width:calc($1 - 0.02px))")
        .replace(/\(width>([^)]+)\)/g, "(min-width:calc($1 + 0.02px))");
    }
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [classicMediaQueries],
    // Pre-bundle UI deps up front so a mid-session re-optimize can't load two copies of React.
    optimizeDeps: {
      include: [
        "@radix-ui/react-slider", "@radix-ui/react-switch", "@radix-ui/react-select",
        "@radix-ui/react-label", "lucide-react",
      ],
    },
  },
});
