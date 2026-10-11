import type { NextConfig } from "next";

/**
 * Deliberately plain. WaveCenter uses only standard Next.js features that
 * run on any host (Dane's condition, 2026-10-11: the stack must stay
 * replaceable). Before adding an option here, ask whether it would only
 * work on Vercel.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
