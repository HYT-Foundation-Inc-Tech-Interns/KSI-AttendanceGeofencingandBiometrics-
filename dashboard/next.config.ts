import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Static export.
   *
   * Every route in this app is already prerendered static (see
   * .next/prerender-manifest.json: all 8 routes report "compute": "static"),
   * and there are no route handlers, server actions or middleware. Emitting
   * plain files lets this deploy to Cloudflare Pages, whose free tier allows
   * commercial use and unmetered bandwidth -- unlike Vercel's Hobby tier,
   * which forbids commercial use.
   *
   * Build output lands in `out/`.
   */
  output: "export",

  /*
   * `next dev` and `next build` both write to `.next`, and the build starts by
   * deleting it -- which yanks the files out from under a running dev server
   * and, in this sandbox, trips the bulk-delete guard. Set NEXT_DIST_DIR to
   * build the export into its own directory so the two can run side by side:
   *
   *   NEXT_DIST_DIR=.next-export NEXT_PUBLIC_API_URL=... npx next build
   *
   * Both still emit the static export to `out/`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /*
   * `next/image` optimisation needs a server, which a static export does not
   * have. The app uses plain <img> tags everywhere, so this only guards
   * against a future <Image> silently breaking the export.
   */
  images: { unoptimized: true },

  allowedDevOrigins: ['172.16.0.2', 'localhost', '127.0.0.1'],
};

export default nextConfig;
