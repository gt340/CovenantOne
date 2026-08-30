"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountStatusResponse } from "@/lib/onboarding/steps";
import { SignOutButton } from "@/components/SignOutButton";
import { createClient } from "@/lib/supabase/client";

interface PasskeyRecord {
  id: string;
  friendly_name: string | null;
  created_at: string;
}

export default function AccountPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountStatusResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyUnsupported, setPasskeyUnsupported] = useState(false);

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

  useEffect(() => {
    refreshPasskeys();
  }, []);

  async function refreshPasskeys() {
    try {
      const supabase = createClient();
      const { data: list } = await supabase.auth.passkey.list();
      if (list) setPasskeys(list as PasskeyRecord[]);
    } catch {
      // Passkeys are experimental — if the API isn't available for any
      // reason, fail quietly here rather than blocking the rest of the
      // account page.
    }
  }

  async function handleRegisterPasskey() {
    setPasskeyError(null);
    setPasskeyUnsupported(false);

    if (typeof window !== "undefined" && !window.PublicKeyCredential) {
      setPasskeyUnsupported(true);
      return;
    }

    setPasskeyBusy(true);
    const supabase = createClient();
    const { error: registerError } = await supabase.auth.registerPasskey();
    setPasskeyBusy(false);

    if (registerError) {
      setPasskeyError(registerError.message || "Couldn't register a passkey. Please try again.");
      return;
    }

    await refreshPasskeys();
  }

  async function handleDeletePasskey(passkeyId: string) {
    setPasskeyError(null);
    setPasskeyBusy(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId });
    setPasskeyBusy(false);

    if (deleteError) {
      setPasskeyError(deleteError.message || "Couldn't remove that passkey.");
      return;
    }

    await refreshPasskeys();
  }

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

      <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
        <h2>Passkeys</h2>
        <p>
          Sign in without a password using your device&apos;s biometrics
          (Face ID, Touch ID, Windows Hello) or a security key.
        </p>

        {passkeys.length > 0 && (
          <ul>
            {passkeys.map((pk) => (
              <li key={pk.id}>
                {pk.friendly_name || "Unnamed passkey"} — added{" "}
                {new Date(pk.created_at).toLocaleDateString()}{" "}
                <button
                  type="button"
                  onClick={() => handleDeletePasskey(pk.id)}
                  disabled={passkeyBusy}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={handleRegisterPasskey} disabled={passkeyBusy}>
          {passkeyBusy ? "Working..." : "Add a passkey"}
        </button>
        {passkeyUnsupported && (
          <p role="alert" style={{ color: "#b00020" }}>
            This browser or device doesn&apos;t support passkeys.
          </p>
        )}
        {passkeyError && <p role="alert" style={{ color: "#b00020" }}>{passkeyError}</p>}
      </section>

      <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
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

