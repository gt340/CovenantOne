"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountStatusResponse } from "@/lib/onboarding/steps";
import { SignOutButton } from "@/components/SignOutButton";

export default function AccountPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountStatusResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/status")
      .then((res) => {
        if (res.status === 401) {
          router.push("/login");
          throw new Error("not signed in");
        }
        return res.json();
      })
      .then(setData)
      .catch(() => {});
  }, [router]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const res = await fetch("/api/account/delete", { method: "POST" });
    const body = await res.json();
    setDeleting(false);

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }

    router.push("/login");
  }

  if (!data) {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Account</h1>
      <dl>
        <dt>Status</dt>
        <dd>{data.status}</dd>
        <dt>Email verified</dt>
        <dd>{data.emailVerified ? "Yes" : "No"}</dd>
        <dt>Phone verified</dt>
        <dd>{data.phoneVerified ? "Yes" : "No"}</dd>
      </dl>

      <SignOutButton />

      <section style={{ marginTop: "3rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
        <h2>Delete account</h2>
        <p>
          This deactivates your account and removes your profile from
          discovery. It does not happen instantly-and-irreversibly on this
          click alone in the way a full data purge would — see your
          platform&apos;s data retention policy for details.
        </p>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <div>
            <p>
              <strong>Are you sure?</strong> This will sign you out
              everywhere and deactivate your account.
            </p>
            <button type="button" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Yes, delete my account"}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
        {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      </section>
    </main>
  );
}
