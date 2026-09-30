import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /analysis has no page of its own; route it before rendering (the analysis shell
  // withholds page content until an analysis exists, so a render-time redirect
  // would never run).
  async redirects() {
    return [
      { source: "/analysis", destination: "/analysis/overview", permanent: false },
    ];
  },
  // The cached sample is read from disk at runtime; ship it with that function.
  outputFileTracingIncludes: {
    "/api/sample-cache": ["./data/cached-sample.json.gz"],
  },
};

export default nextConfig;
