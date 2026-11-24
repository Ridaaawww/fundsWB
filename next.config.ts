import type { NextConfig } from "next";

// Static export for GitHub Pages. In CI the site lives under /<repo>, so the
// deploy workflow sets NEXT_PUBLIC_BASE_PATH (e.g. "/fundsWB"); locally it's "".
const config: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
  trailingSlash: true, // /india/ -> india/index.html, which GitHub Pages serves directly
};

export default config;
