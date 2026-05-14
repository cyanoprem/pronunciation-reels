import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sn-main.b-cdn.net",
      },
    ],
  },
};

export default nextConfig;
