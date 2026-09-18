"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Article = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  body: string;
  publishedAt: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  PREPARING_FOR_MARRIAGE: "Preparing for Marriage",
  CHOOSING_A_SPOUSE: "Choosing a Spouse",
  COMMUNICATION: "Communication",
  CONFLICT_RESOLUTION: "Conflict Resolution",
  FAITH_AND_MARRIAGE: "Faith and Marriage",
  FAMILY: "Family",
  FINANCIAL_PLANNING: "Financial Planning",
  BUSINESS_AND_MARRIAGE: "Business and Marriage",
  EMOTIONAL_MATURITY: "Emotional Maturity",
  RESPONSIBLE_COURTSHIP: "Responsible Courtship",
  MARRIAGE_PREPARATION: "Marriage Preparation",
  LIFE_AFTER_MARRIAGE: "Life After Marriage",
};

export default function GuidanceArticlePage() {
  const params = useParams();
  const id = params?.id as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/guidance/articles/${id}`, { credentials: "include" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        setArticle(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load this article.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">Loading...</div>;
  if (error || !article) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-4 py-3">{error ?? "Article not found."}</div>
        <Link href="/guidance" className="text-sm text-blue-600 mt-4 inline-block">
          ← Back to Guidance Center
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/guidance" className="text-sm text-blue-600 mb-3 inline-block">
        ← Back to Guidance Center
      </Link>
      <div className="text-xs text-blue-600 mb-1">{CATEGORY_LABELS[article.category] ?? article.category}</div>
      <h1 className="text-2xl font-semibold mb-4">{article.title}</h1>
      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">{article.body}</div>
    </div>
  );
}
