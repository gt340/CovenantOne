"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function publicImageUrl(key: string | null) {
  if (!key) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/listing-images/${key}`;
}

type Offering = { id: string; name: string; description: string | null };
type BusinessDetail = {
  id: string;
  ownerId: string;
  businessName: string;
  description: string | null;
  website: string | null;
  openToPartnership: boolean;
  partnershipNotes: string | null;
  bannerImageKey: string | null;
  offerings: Offering[];
};

export default function BusinessDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [purpose, setPurpose] = useState("GENERAL");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offeringName, setOfferingName] = useState("");
  const [offeringDesc, setOfferingDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/business-profiles/${id}`, { credentials: "include" });
    if (res.ok) setBusiness(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCurrentUserId(d?.id ?? null))
      .catch(() => setCurrentUserId(null))
      .finally(() => setAuthChecked(true));
  }, []);

  async function sendContact() {
    if (!message.trim()) {
      setError("Please add a message.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/business-profiles/${id}/contact`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, message: message.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setSending(false);
    }
  }

  async function addOffering() {
    if (!offeringName.trim()) return;
    const res = await fetch(`/api/business-profiles/${id}/offerings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: offeringName.trim(), description: offeringDesc.trim() || undefined }),
    });
    if (res.ok) {
      setOfferingName("");
      setOfferingDesc("");
      load();
    }
  }

  async function removeOffering(offeringId: string) {
    const res = await fetch(`/api/business-offerings/${offeringId}`, { method: "DELETE", credentials: "include" });
    if (res.ok) load();
  }

  async function uploadBanner(file: File) {
    if (!currentUserId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${currentUserId}/${id}-${Date.now()}.${ext}`;
      const uploadPromise = supabase.storage.from("listing-images").upload(path, file, { upsert: true });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Upload timed out — check your connection and try again")), 20000)
      );
      const { error: uploadErr } = (await Promise.race([uploadPromise, timeoutPromise])) as any;
      if (uploadErr) throw uploadErr;

      const res = await fetch(`/api/business-profiles/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerImageKey: path }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload image.");
    } finally {
      setUploading(false);
    }
  }

  if (loading || !authChecked) {
    return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>;
  }
  if (!business) {
    return <div className="max-w-2xl mx-auto px-4 py-8">Business not found.</div>;
  }

  const isOwner = business.ownerId === currentUserId;
  const bannerUrl = publicImageUrl(business.bannerImageKey);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/business" className="text-sm text-blue-600 mb-3 inline-block">← Back to Directory</Link>

      {bannerUrl && (
        <img src={bannerUrl} alt={business.businessName} className="w-full h-40 object-cover rounded-md mb-3" />
      )}

      <h1 className="text-xl font-semibold">{business.businessName}</h1>
      {business.description && <p className="text-sm text-gray-600 mb-2">{business.description}</p>}
      {business.website && (
        <a href={business.website} target="_blank" rel="noreferrer" className="text-xs text-blue-600 block mb-3">
          {business.website}
        </a>
      )}
      {business.openToPartnership && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-2 text-xs text-amber-700 mb-4">
          Open to partnership opportunities{business.partnershipNotes ? `: ${business.partnershipNotes}` : ""}
        </div>
      )}

      {isOwner && (
        <div className="border rounded-md p-3 mb-4">
          <div className="text-xs font-medium mb-2">{bannerUrl ? "Change" : "Add"} banner image</div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadBanner(file);
            }}
            className="text-xs"
          />
          {uploading && <div className="text-xs text-gray-400 mt-1">Uploading...</div>}
          {uploadError && <div className="text-red-600 text-xs mt-1">{uploadError}</div>}
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-500 mb-2">Products & Services</h2>
      <div className="space-y-2 mb-4">
        {business.offerings.length === 0 && <div className="text-xs text-gray-400">Nothing listed yet.</div>}
        {business.offerings.map((o) => (
          <div key={o.id} className="border rounded-md p-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{o.name}</div>
              {o.description && <p className="text-xs text-gray-600">{o.description}</p>}
            </div>
            {isOwner && (
              <button onClick={() => removeOffering(o.id)} className="text-xs text-red-500 flex-shrink-0">
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <div className="border rounded-md p-3 mb-6 space-y-2">
          <div className="text-xs font-medium">Add a product or service</div>
          <input type="text" placeholder="Name" value={offeringName} onChange={(e) => setOfferingName(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          <input type="text" placeholder="Description (optional)" value={offeringDesc} onChange={(e) => setOfferingDesc(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm" />
          <button onClick={addOffering} className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white">Add</button>
        </div>
      )}

      {!isOwner && (
        <div className="border rounded-md p-3">
          <div className="text-sm font-medium mb-2">Contact this business</div>
          {sent ? (
            <div className="text-sm text-green-700">Your request has been sent.</div>
          ) : (
            <>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm mb-2">
                <option value="GENERAL">General inquiry</option>
                <option value="SERVICE_INQUIRY">Service inquiry</option>
                <option value="PARTNERSHIP">Partnership</option>
              </select>
              <textarea
                placeholder="Your message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full border rounded-md px-3 py-2 text-sm mb-2"
              />
              {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
              <button onClick={sendContact} disabled={sending} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">
                {sending ? "Sending..." : "Send Request"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
