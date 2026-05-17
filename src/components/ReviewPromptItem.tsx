"use client";
import { useEffect, useRef, useState } from "react";

type Prompt = { id: string; q: string; helper: string };

// 자동 저장 회고 인풋 — localStorage key: jinho-os:review:<kind>:<period>:<prompt.id>:v1
// kind: weekly | monthly
// period: weekly = 2026-W20, monthly = 2026-05

export default function ReviewPromptItem({
  kind,
  period,
  prompt,
  rows = 2,
}: {
  kind: "weekly" | "monthly";
  period: string;
  prompt: Prompt;
  rows?: number;
}) {
  const storageKey = `jinho-os:review:${kind}:${period}:${prompt.id}:v1`;
  const [value, setValue] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const obj = JSON.parse(raw);
        setValue(obj.text || "");
        if (obj.updatedAt) setSavedAt(obj.updatedAt);
      }
    } catch {}
    setMounted(true);
  }, [storageKey]);

  function onChange(next: string) {
    setValue(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const trimmed = next.trim();
      try {
        if (trimmed) {
          const now = Date.now();
          localStorage.setItem(storageKey, JSON.stringify({ text: trimmed, updatedAt: now }));
          setSavedAt(now);
        } else {
          localStorage.removeItem(storageKey);
          setSavedAt(null);
        }
      } catch {}
    }, 600);
  }

  const savedLabel = (() => {
    if (!savedAt) return null;
    const diff = (Date.now() - savedAt) / 1000;
    if (diff < 5) return "방금 저장";
    if (diff < 60) return `${Math.floor(diff)}초 전 저장`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전 저장`;
    return `${Math.floor(diff / 3600)}시간 전 저장`;
  })();

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-100">{prompt.q}</p>
        {mounted && savedLabel && (
          <span className="text-[10px] text-emerald-500 font-mono shrink-0">✓ {savedLabel}</span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mt-1">{prompt.helper}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={mounted ? "여기에 입력 — 자동 저장" : ""}
        className="mt-3 w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-sm text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-violet-700 resize-y"
      />
    </li>
  );
}
