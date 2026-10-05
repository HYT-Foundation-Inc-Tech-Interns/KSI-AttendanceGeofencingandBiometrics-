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
   * Emit `route/index.html` rather than `route.html`.
   *
   * Without this, a static export writes `/dashboard/attendance.html` while
   * the app links to `/dashboard/attendance`. A host with clean-URL handling
   * (Cloudflare Pages) maps one to the other, but a plain static server --
   * `python3 -m http.server`, which is what the built-in publisher uses --
   * looks for a directory or an exact file and returns 404. Client-side
   * navigation still works, so the failure only shows up on a hard refresh or
   * a bookmarked deep link, which is exactly when it is most annoying.
   *
   * With trailing slashes the export writes `/dashboard/attendance/index.html`,
   * which every static host serves correctly.
   */
  trailingSlash: true,

  /*
   * `next/image` optimisation needs a server, which a static export does not
   * have. The app uses plain <img> tags everywhere, so this only guards
   * against a future <Image> silently breaking the export.
   */
  images: { unoptimized: true },

  allowedDevOrigins: ['172.16.0.2', 'localhost', '127.0.0.1'],
};

export default nextConfig;
