"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Article = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  publishedAt: string | null;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "PREPARING_FOR_MARRIAGE", label: "Preparing for Marriage" },
  { value: "CHOOSING_A_SPOUSE", label: "Choosing a Spouse" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "CONFLICT_RESOLUTION", label: "Conflict Resolution" },
  { value: "FAITH_AND_MARRIAGE", label: "Faith and Marriage" },
  { value: "FAMILY", label: "Family" },
  { value: "FINANCIAL_PLANNING", label: "Financial Planning" },
  { value: "BUSINESS_AND_MARRIAGE", label: "Business and Marriage" },
  { value: "EMOTIONAL_MATURITY", label: "Emotional Maturity" },
  { value: "RESPONSIBLE_COURTSHIP", label: "Responsible Courtship" },
  { value: "MARRIAGE_PREPARATION", label: "Marriage Preparation" },
  { value: "LIFE_AFTER_MARRIAGE", label: "Life After Marriage" },
];

export default function GuidanceCenterPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      const res = await fetch(`/api/guidance/articles?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setArticles(data.articles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load articles.");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Marriage Guidance Center</h1>
        <Link href="/mentors" className="text-sm text-blue-600">
          ← Mentors
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Guidance to help you prepare well, courtship through life after marriage.</p>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setCategory("")}
          className={`text-xs px-3 py-1.5 rounded-full border ${category === "" ? "bg-blue-600 text-white border-blue-600" : "text-gray-600"}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`text-xs px-3 py-1.5 rounded-full border ${category === c.value ? "bg-blue-600 text-white border-blue-600" : "text-gray-600"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3 mb-4">{error}</div>}
      {loading && <div className="text-center text-gray-400 py-12">Loading...</div>}
      {!loading && articles.length === 0 && <div className="text-center text-gray-400 py-12">No articles in this category yet.</div>}

      <div className="space-y-3">
        {articles.map((a) => (
          <Link key={a.id} href={`/guidance/${a.id}`} className="block border rounded-lg p-4 bg-white hover:bg-gray-50">
            <div className="text-xs text-blue-600 mb-1">{categoryLabel(a.category)}</div>
            <div className="font-medium mb-1">{a.title}</div>
            {a.summary && <p className="text-sm text-gray-600 line-clamp-2">{a.summary}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
