import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@leash/contracts", "@leash/sdk"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
