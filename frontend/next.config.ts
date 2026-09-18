import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: __dirname },
  output: "standalone",
};
export default config;
