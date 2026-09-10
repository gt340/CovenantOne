"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type FullProfile = {
  id: string;
  displayName: string;
  age: number | null;
  headlinePhotoUrl: string | null;
  lifeGoals: string | null;
  familyValues: string | null;
  location: { country: string | null; region: string | null; city: string | null };
  willingToRelocate: boolean;
  faith: { importance: string | null; denomination: string | null };
  education: { level: string | null; fieldOfStudy: string | null };
  occupation: { jobTitle: string | null; employer: string | null; industry?: string | null };
  business: { ownsBusiness: boolean; businessName: string | null };
  marriageIntentions: {
    seriouslySeekingMarriage: boolean | null;
    timeframe: string | null;
    wantsChildren: boolean | null;
    hasChildrenAlready: boolean | null;
  };
  interests: string[];
  compatibility: { score: number; breakdown: { factor: string; label: string; weight: number; contribution: number; note: string }[] } | null;
  isSaved: boolean;
  connection: { id: string; currentStage: string } | null;
  introductionRequest: { id: string; status: string; direction: "sent" | "received" } | null;
  disclaimer: string;
};

function formatLabel(value: string | null): string {
  if (!value) return "Not specified";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export default function FullProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.userId as string;

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [introMessage, setIntroMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/discovery/profile/${userId}`, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        const data: FullProfile = await res.json();
        setProfile(data);
        setIsSaved(data.isSaved);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load this profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  async function toggleSave() {
    if (!profile) return;
    const method = isSaved ? "DELETE" : "POST";
    setIsSaved(!isSaved);
    try {
      const res = await fetch(`/api/discovery/saved/${profile.id}`, { method, credentials: "include" });
      if (!res.ok) throw new Error();
    } catch {
      setIsSaved(isSaved);
    }
  }

  async function sendRequest() {
    if (!profile) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/introductions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: profile.id, introMessage: introMessage.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setProfile({ ...profile, introductionRequest: { id: "pending", status: "PENDING", direction: "sent" } });
      setShowRequestModal(false);
      setIntroMessage("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">Loading profile...</div>;
  }
  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3">
          {error ?? "Profile not found."}
        </div>
        <Link href="/discover" className="text-sm text-blue-600 mt-4 inline-block">
          ← Back to Find a Life Partner
        </Link>
      </div>
    );
  }

  const canRequest = !profile.connection && !profile.introductionRequest;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/discover" className="text-sm text-blue-600 mb-4 inline-block">
        ← Back to Find a Life Partner
      </Link>

      <div className="border rounded-lg overflow-hidden bg-white">
        <div className="aspect-[4/3] bg-gray-100">
          {profile.headlinePhotoUrl ? (
            <img src={profile.headlinePhotoUrl} alt={profile.displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-6xl">
              {profile.displayName?.[0] ?? "?"}
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold">
                {profile.displayName}
                {profile.age !== null && <span className="text-gray-400 font-normal">, {profile.age}</span>}
              </h1>
              <div className="text-sm text-gray-500">
                {[profile.location.city, profile.location.region, profile.location.country].filter(Boolean).join(", ") || "Location not shared"}
                {profile.willingToRelocate && " · Open to relocating"}
              </div>
            </div>
            {profile.compatibility && (
              <span className="text-sm font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
                {profile.compatibility.score}% match
              </span>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            {profile.connection ? (
              <span className="flex-1 text-center text-sm px-3 py-2 rounded-md bg-green-50 text-green-700">
                Connected · {formatLabel(profile.connection.currentStage)}
              </span>
            ) : profile.introductionRequest ? (
              <span className="flex-1 text-center text-sm px-3 py-2 rounded-md bg-gray-100 text-gray-600">
                {profile.introductionRequest.direction === "sent"
                  ? `Request ${profile.introductionRequest.status.toLowerCase()}`
                  : "They've requested friendship with you"}
              </span>
            ) : (
              <button
                onClick={() => setShowRequestModal(true)}
                className="flex-1 text-sm px-3 py-2 rounded-md bg-blue-600 text-white"
              >
                Request Friendship
              </button>
            )}
            <button
              onClick={toggleSave}
              className={`text-sm px-3 py-2 rounded-md border ${
                isSaved ? "border-pink-400 text-pink-500" : "border-gray-300 text-gray-500"
              }`}
            >
              {isSaved ? "♥ Saved" : "♡ Save"}
            </button>
          </div>

          {profile.lifeGoals && (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Life goals</h2>
              <p className="text-sm text-gray-600">{profile.lifeGoals}</p>
            </div>
          )}
          {profile.familyValues && (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Family values</h2>
              <p className="text-sm text-gray-600">{profile.familyValues}</p>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Detail label="Faith importance" value={formatLabel(profile.faith.importance)} />
            <Detail label="Denomination" value={profile.faith.denomination ?? "Not specified"} />
            <Detail label="Education" value={formatLabel(profile.education.level)} />
            <Detail label="Field of study" value={profile.education.fieldOfStudy ?? "Not specified"} />
            <Detail
              label="Occupation"
              value={profile.occupation.jobTitle ?? profile.occupation.industry ?? "Not shared"}
            />
            <Detail
              label="Business"
              value={profile.business.ownsBusiness ? profile.business.businessName ?? "Business owner" : "—"}
            />
            <Detail label="Marriage timeframe" value={formatLabel(profile.marriageIntentions.timeframe)} />
            <Detail
              label="Children"
              value={
                profile.marriageIntentions.wantsChildren === null
                  ? "Not specified"
                  : profile.marriageIntentions.wantsChildren
                  ? "Wants children"
                  : "Does not want children"
              }
            />
          </div>

          {profile.interests.length > 0 && (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Interests</h2>
              <div className="flex flex-wrap gap-1.5">
                {profile.interests.map((name) => (
                  <span key={name} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {profile.compatibility && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Compatibility breakdown</h2>
              <div className="space-y-2">
                {profile.compatibility.breakdown.map((b) => (
                  <div key={b.factor}>
                    <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                      <span>{b.label}</span>
                      <span>
                        {b.contribution}/{b.weight}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${(b.contribution / b.weight) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{b.note}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">{profile.disclaimer}</p>
            </div>
          )}
        </div>
      </div>

      {showRequestModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-lg max-w-sm w-full p-5">
            <h2 className="font-semibold mb-1">Request Friendship</h2>
            <p className="text-sm text-gray-500 mb-3">
              Send a friendship request to <span className="font-medium">{profile.displayName}</span>. They'll
              need to accept before you can begin a conversation.
            </p>
            <textarea
              value={introMessage}
              onChange={(e) => setIntroMessage(e.target.value)}
              placeholder="Optional: introduce yourself..."
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm mb-2"
            />
            {sendError && <div className="text-red-600 text-xs mb-2">{sendError}</div>}
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setShowRequestModal(false);
                  setSendError(null);
                }}
                disabled={sending}
                className="px-3 py-1.5 text-sm rounded-md border"
              >
                Cancel
              </button>
              <button
                onClick={sendRequest}
                disabled={sending}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-gray-700">{value}</div>
    </div>
  );
}
