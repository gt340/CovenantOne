/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Applies to every route. CSP is deliberately conservative — this is
        // a Next.js app with no inline third-party scripts, so 'self' plus
        // Supabase covers real usage.
        //
        // script-src needs 'unsafe-inline': Next.js App Router injects small
        // inline <script> tags for hydration/streaming on every page load —
        // without this, those get silently blocked and client components
        // (including sign-in) stop working with no visible error. Confirmed
        // this was breaking password/OAuth sign-in in production after the
        // CSP first shipped. Tighten this to a nonce-based policy later if
        // it's worth the effort; until then, this is correct over broken.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
