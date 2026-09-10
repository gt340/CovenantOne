"use client";

import { useState, useEffect, useCallback } from "react";

type Member = {
  id: string;
  displayName: string;
  email: string;
  accountStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  communityVerified: boolean;
  identityVerified: boolean;
  createdAt: string;
};

type ApiResponse = {
  members: Member[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 25;

export default function CommunityVerificationAdminPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "unverified">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // reason-prompt modal state
  const [pendingAction, setPendingAction] = useState<{
    userId: string;
    displayName: string;
    nextValue: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("communityVerified", String(statusFilter === "verified"));

      const res = await fetch(`/api/admin/members?${params.toString()}`, {
        credentials: "include",
      });

      if (res.status === 401 || res.status === 403) {
        setError("You don't have permission to view this page.");
        setMembers([]);
        setTotal(0);
        return;
      }
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      const data: ApiResponse = await res.json();
      setMembers(data.members ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members.");
      setMembers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  function openConfirm(member: Member) {
    setPendingAction({
      userId: member.id,
      displayName: member.displayName,
      nextValue: !member.communityVerified,
    });
    setReason("");
    setActionError(null);
  }

  function closeConfirm() {
    setPendingAction(null);
    setReason("");
    setActionError(null);
  }

  async function submitVerification() {
    if (!pendingAction) return;
    if (!reason.trim()) {
      setActionError("A reason is required for the audit log.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/members/${pendingAction.userId}/verify`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          communityVerified: pendingAction.nextValue,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      // Optimistically update local state instead of a full refetch
      setMembers((prev) =>
        prev.map((m) =>
          m.id === pendingAction.userId
            ? { ...m, communityVerified: pendingAction.nextValue }
            : m
        )
      );
      closeConfirm();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update verification.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Community Verification</h1>
      <p className="text-sm text-gray-500 mb-6">
        Grant or revoke the Community Verified badge. Every change is written to the audit log.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value as typeof statusFilter);
          }}
          className="border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All members</option>
          <option value="verified">Community verified</option>
          <option value="unverified">Not yet verified</option>
        </select>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Account status</th>
              <th className="px-4 py-2 font-medium">Verifications</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 font-medium text-right">Community badge</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Loading members...
                </td>
              </tr>
            )}
            {!loading && members.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No members match this filter.
                </td>
              </tr>
            )}
            {!loading &&
              members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="text-gray-400 text-xs">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                        m.accountStatus === "ACTIVE"
                          ? "bg-green-100 text-green-700"
                          : m.accountStatus === "SUSPENDED" || m.accountStatus === "BANNED"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {m.accountStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-x-1">
                    <Badge label="Email" active={m.emailVerified} />
                    <Badge label="Phone" active={m.phoneVerified} />
                    <Badge label="ID" active={m.identityVerified} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openConfirm(m)}
                      className={`text-xs px-3 py-1.5 rounded-md border font-medium ${
                        m.communityVerified
                          ? "border-gray-300 text-gray-600 hover:bg-gray-50"
                          : "border-blue-600 text-blue-600 hover:bg-blue-50"
                      }`}
                    >
                      {m.communityVerified ? "Revoke" : "Grant"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <span>
          Page {page} of {totalPages} &middot; {total} member{total === 1 ? "" : "s"}
        </span>
        <div className="space-x-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 border rounded-md disabled:opacity-40"
          >
            Prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded-md disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {pendingAction && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
          <div className="bg-white rounded-lg max-w-sm w-full p-5">
            <h2 className="font-semibold mb-1">
              {pendingAction.nextValue ? "Grant" : "Revoke"} Community Verified
            </h2>
            <p className="text-sm text-gray-500 mb-3">
              {pendingAction.nextValue ? "Granting" : "Revoking"} this badge for{" "}
              <span className="font-medium">{pendingAction.displayName}</span>. This is recorded
              in the audit log.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)..."
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm mb-2"
            />
            {actionError && (
              <div className="text-red-600 text-xs mb-2">{actionError}</div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={closeConfirm}
                disabled={submitting}
                className="px-3 py-1.5 text-sm rounded-md border"
              >
                Cancel
              </button>
              <button
                onClick={submitVerification}
                disabled={submitting}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-block text-xs px-1.5 py-0.5 rounded ${
        active ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-400"
      }`}
    >
      {label}
    </span>
  );
}
