"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type MemberPreview = {
  id: string;
  displayName: string;
  age: number | null;
  headlinePhotoUrl: string | null;
  location: { country: string | null; region: string | null; city: string | null };
  occupation?: { jobTitle: string | null; employer: string | null; industry?: string | null };
  business?: { ownsBusiness: boolean; businessName: string | null };
  compatibility: { score: number; breakdown?: any[] } | null;
};

type Tab = "recommended" | "search" | "saved";

export default function DiscoverPage() {
  const [tab, setTab] = useState<Tab>("recommended");
  const [members, setMembers] = useState<MemberPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [pendingSentIds, setPendingSentIds] = useState<Set<string>>(new Set());

  // Filters (search tab only)
  const [search, setSearch] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [country, setCountry] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [requestModalFor, setRequestModalFor] = useState<MemberPreview | null>(null);
  const [introMessage, setIntroMessage] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const loadSavedAndPending = useCallback(async () => {
    try {
      const [savedRes, sentRes] = await Promise.all([
        fetch("/api/discovery/saved", { credentials: "include" }),
        fetch("/api/introductions?direction=sent&status=PENDING", { credentials: "include" }),
      ]);
      if (savedRes.ok) {
        const data = await savedRes.json();
        setSavedIds(new Set((data.members ?? []).map((m: any) => m.id)));
      }
      if (sentRes.ok) {
        const data = await sentRes.json();
        setPendingSentIds(new Set((data.requests ?? []).map((r: any) => r.otherMember.id)));
      }
    } catch {
      // non-critical — buttons just fall back to default state
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = "";
      if (tab === "recommended") {
        url = "/api/discovery/recommended?limit=12";
      } else if (tab === "saved") {
        url = "/api/discovery/saved";
      } else {
        const params = new URLSearchParams({ pageSize: "20" });
        if (search.trim()) params.set("search", search.trim());
        if (ageMin) params.set("ageMin", ageMin);
        if (ageMax) params.set("ageMax", ageMax);
        if (country.trim()) params.set("country", country.trim());
        url = `/api/discovery/search?${params.toString()}`;
      }

      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        setError("Please complete your profile and sign in to browse Find a Life Partner.");
        setMembers([]);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles.");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [tab, search, ageMin, ageMax, country]);

  useEffect(() => {
    loadSavedAndPending();
  }, [loadSavedAndPending]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function toggleSave(member: MemberPreview) {
    const isSaved = savedIds.has(member.id);
    const method = isSaved ? "DELETE" : "POST";
    // optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(member.id);
      else next.add(member.id);
      return next;
    });
    try {
      const res = await fetch(`/api/discovery/saved/${member.id}`, { method, credentials: "include" });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(member.id);
        else next.delete(member.id);
        return next;
      });
    }
  }

  async function sendRequest() {
    if (!requestModalFor) return;
    setSendingRequest(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/introductions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: requestModalFor.id, introMessage: introMessage.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setPendingSentIds((prev) => new Set(prev).add(requestModalFor.id));
      setRequestModalFor(null);
      setIntroMessage("");
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setSendingRequest(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Find a Life Partner</h1>
      <p className="text-sm text-gray-500 mb-6">
        Discover members seriously seeking marriage. Compatibility is guidance, not a guarantee —
        weigh it alongside everything else you learn about someone.
      </p>

      <div className="flex gap-2 mb-4 border-b">
        {(["recommended", "search", "saved"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
            }`}
          >
            {t === "recommended" ? "Recommended" : t === "search" ? "Search" : "Saved"}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="mb-6">
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border rounded-md px-3 py-2 text-sm"
            />
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="px-3 py-2 text-sm border rounded-md text-gray-600"
            >
              Filters
            </button>
            <button onClick={loadMembers} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white">
              Search
            </button>
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-gray-50">
              <input
                type="number"
                placeholder="Min age"
                value={ageMin}
                onChange={(e) => setAgeMin(e.target.value)}
                className="w-24 border rounded-md px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                placeholder="Max age"
                value={ageMax}
                onChange={(e) => setAgeMax(e.target.value)}
                className="w-24 border rounded-md px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                placeholder="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-40 border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {loading && <div className="text-center text-gray-400 py-12">Loading profiles...</div>}
      {!loading && !error && members.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          {tab === "saved" ? "No saved profiles yet." : "No profiles match right now — try adjusting filters."}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {members.map((m) => {
          const isSaved = savedIds.has(m.id);
          const isPending = pendingSentIds.has(m.id);
          return (
            <div key={m.id} className="border rounded-lg overflow-hidden bg-white">
              <Link href={`/discover/${m.id}`} className="block">
                <div className="aspect-square bg-gray-100">
                  {m.headlinePhotoUrl ? (
                    <img src={m.headlinePhotoUrl} alt={m.displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">
                      {m.displayName?.[0] ?? "?"}
                    </div>
                  )}
                </div>
              </Link>
              <div className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/discover/${m.id}`} className="font-medium hover:underline">
                      {m.displayName}
                      {m.age !== null && <span className="text-gray-400 font-normal">, {m.age}</span>}
                    </Link>
                    <div className="text-xs text-gray-500">
                      {[m.location.city, m.location.region, m.location.country].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                  {m.compatibility && (
                    <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                      {m.compatibility.score}%
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setRequestModalFor(m)}
                    disabled={isPending}
                    className="flex-1 text-xs px-2 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-50 disabled:bg-gray-300"
                  >
                    {isPending ? "Request Sent" : "Request Friendship"}
                  </button>
                  <button
                    onClick={() => toggleSave(m)}
                    className={`text-xs px-2 py-1.5 rounded-md border ${
                      isSaved ? "border-pink-400 text-pink-500" : "border-gray-300 text-gray-500"
                    }`}
                  >
                    {isSaved ? "♥" : "♡"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {requestModalFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-lg max-w-sm w-full p-5">
            <h2 className="font-semibold mb-1">Request Friendship</h2>
            <p className="text-sm text-gray-500 mb-3">
              Send a friendship request to <span className="font-medium">{requestModalFor.displayName}</span>.
              They'll need to accept before you can begin a conversation.
            </p>
            <textarea
              value={introMessage}
              onChange={(e) => setIntroMessage(e.target.value)}
              placeholder="Optional: introduce yourself..."
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm mb-2"
            />
            {requestError && <div className="text-red-600 text-xs mb-2">{requestError}</div>}
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setRequestModalFor(null);
                  setRequestError(null);
                }}
                disabled={sendingRequest}
                className="px-3 py-1.5 text-sm rounded-md border"
              >
                Cancel
              </button>
              <button
                onClick={sendRequest}
                disabled={sendingRequest}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                {sendingRequest ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
