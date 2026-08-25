export const metadata = {
  title: "Platform — Phase 1 Infrastructure Check",
  description: "Minimal deploy used to verify env vars and Supabase connectivity on Vercel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "3rem" }}>
        {children}
      </body>
    </html>
  );
}
