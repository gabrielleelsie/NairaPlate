import { createFileRoute } from "@tanstack/react-router";

// Connection check for the Till. Read-only, no data, no database work.
export const Route = createFileRoute("/api/public/ping")({
  server: {
    handlers: {
      GET: async () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } }),
    },
  },
});
