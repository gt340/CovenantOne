"use client";

import { useState, useEffect, useCallback } from "react";

type LogEntry = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
};

const PAGE_SIZE = 25;

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (action.trim()) params.set("action", action.trim());
      if (targetType.trim()) params.set("targetType", targetType.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());

      const res = await fetch(`/api/admin/audit-logs?${params}`, { credentials: "include" });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [page, action, targetType, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Audit Logs</h1>
      <p className="text-sm text-gray-500 mb-6">Every sensitive action recorded across the platform.</p>

      <div className="grid sm:grid-cols-4 gap-2 mb-4">
        <input
          type="text"
          placeholder="Action contains..."
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Target type"
          value={targetType}
          onChange={(e) => {
            setPage(1);
            setTargetType(e.target.value);
          }}
          className="border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1);
            setFrom(e.target.value);
          }}
          className="border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1);
            setTo(e.target.value);
          }}
          className="border rounded-md px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}

      <div className="space-y-1">
        {!loading && logs.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">No matching log entries.</div>}
        {logs.map((l) => (
          <div key={l.id} className="border rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">{l.actorName}</span>
                <span className="text-gray-400"> · {l.action}</span>
                {l.targetType && (
                  <span className="text-gray-400">
                    {" "}
                    · {l.targetType}
                    {l.targetId ? `:${l.targetId.slice(0, 8)}` : ""}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400">{new Date(l.createdAt).toLocaleString()}</div>
            </div>
            {l.metadata && (
              <button
                onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                className="text-xs text-blue-600 mt-1"
              >
                {expanded === l.id ? "Hide details" : "Show details"}
              </button>
            )}
            {expanded === l.id && l.metadata && (
              <pre className="text-xs bg-gray-50 rounded p-2 mt-2 overflow-x-auto">{JSON.stringify(l.metadata, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <span>
          Page {page} of {totalPages} · {total} entries
        </span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded-md disabled:opacity-40">
            Prev
          </button>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded-md disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
