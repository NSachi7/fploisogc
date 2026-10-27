import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Every route here is per-user and backed by live Supabase data (auth cookies,
     realtime scores), so there is nothing worth statically prerendering —
     Cache Components' static-by-default model just forces Suspense
     boilerplate everywhere for no benefit. Keep fully dynamic rendering. */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
