export default function Home() {
  return (
    <main>
      <h1>Platform — Phase 1</h1>
      <p>
        This deploy exists to verify infrastructure only: environment
        variables and Supabase connectivity on Vercel. It is not the product
        UI — that comes in a later phase.
      </p>
      <p>
        Check <code>/api/health</code> for a live connectivity test against
        the Supabase project.
      </p>
    </main>
  );
}
