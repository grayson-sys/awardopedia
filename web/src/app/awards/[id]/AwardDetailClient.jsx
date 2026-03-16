"use client";

import { useState } from "react";
import AiBadge from "@/components/AiBadge";
import { analyzeWithAI } from "@/lib/api";

export default function AwardDetailClient({ awardId }) {
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function handleAnalyze() {
    setAiLoading(true);
    try {
      const res = await analyzeWithAI(awardId);
      setAiResult(res.analysis);
    } catch (err) {
      alert(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <AiBadge onClick={handleAnalyze} loading={aiLoading} />
      {aiResult && (
        <div className="card" style={{ marginTop: "var(--space-4)", whiteSpace: "pre-wrap", fontSize: "var(--font-size-sm)", lineHeight: "var(--line-height-relaxed)" }}>
          {aiResult}
        </div>
      )}
    </div>
  );
}
