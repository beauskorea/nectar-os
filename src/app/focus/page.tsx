"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Crisis = {
  label: string;
  kind: "calendar" | "mail" | "people";
  severity: "urgent" | "important" | "watch";
  reason?: string;
  action?: string;
  ref?: string;
};

type AlertsFile = {
  generatedAt: number;
  date: string;
  celebrate: any[];
  crisis: Crisis[];
};

type Msg = {
  id: string;
  ts: number;
  date: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  snippet: string;
  body: string;
  unread: boolean;
  priority: string | null;
  category: string | null;
  aiSummary: string | null;
};
type MailFile = { messages: Msg[] };

const SEV_COLOR: Record<string, string> = {
  urgent: "border-rose-700 bg-rose-950/30",
  important: "border-amber-800/60 bg-amber-950/20",
  watch: "border-zinc-800 bg-zinc-900/40",
};
const SEV_BADGE: Record<string, string> = {
  urgent: "bg-rose-700/50 text-rose-100 border-rose-700",
  important: "bg-amber-800/40 text-amber-200 border-amber-800/60",
  watch: "bg-zinc-800 text-zinc-400 border-zinc-700",
};
const KIND_LABEL: Record<string, { label: string; emoji: string }> = {
  calendar: { label: "일정", emoji: "📅" },
  mail: { label: "메일", emoji: "📧" },
  people: { label: "인맥", emoji: "👥" },
};

const DONE_KEY = "jinho-focus-done-v1";

function loadDone(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveDone(set: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DONE_KEY, JSON.stringify(Array.from(set)));
}

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function FocusPage() {
  const [alerts, setAlerts] = useState<AlertsFile | null>(null);
  const [mailMap, setMailMap] = useState<Record<string, Msg>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    fetch("/weekly_alerts.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setAlerts)
      .catch(() => {});
    fetch("/mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: MailFile) => {
        const map: Record<string, Msg> = {};
        for (const m of d.messages) map[m.id] = m;
        setMailMap(map);
      })
      .catch(() => {});
    setDone(loadDone());
  }, []);

  function toggleDone(key: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveDone(next);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!alerts) return [];
    const list = alerts.crisis.map((c, i) => ({ ...c, _key: `${c.kind}-${c.ref || c.label}-${i}` }));
    if (showDone) return list;
    return list.filter((c) => !done.has(c._key));
  }, [alerts, done, showDone]);

  if (!alerts) {
    return <div className="px-6 py-8 text-zinc-500">로딩…</div>;
  }

  const totalCrisis = alerts.crisis.length;
  const doneCount = alerts.crisis.filter((c, i) =>
    done.has(`${c.kind}-${c.ref || c.label}-${i}`),
  ).length;

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <header className="mb-5 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">focus mode</p>
          <h1 className="text-2xl font-semibold mt-1">🎯 집중 처리</h1>
          <p className="text-zinc-500 text-xs mt-1">
            AI 1차 분류된 위기상황을 1건씩 처리 · {ago(alerts.generatedAt)} 전 갱신
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">
            {totalCrisis - doneCount} / {totalCrisis} 남음
          </span>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600"
          >
            {showDone ? "처리한 거 숨기기" : "처리한 거 보기"}
          </button>
        </div>
      </header>

      {totalCrisis === 0 ? (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-8 text-center">
          <p className="text-3xl mb-2">✓</p>
          <p className="text-sm text-emerald-200">처리할 위기상황 없음 — 클린 상태</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-8 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm text-emerald-200">오늘 위기 모두 처리 완료</p>
          <button
            onClick={() => setShowDone(true)}
            className="text-xs text-zinc-400 hover:text-zinc-100 mt-3"
          >
            처리한 거 다시 보기
          </button>
        </div>
      ) : (
        <ul className="space-y-4">
          {filtered.map((c) => {
            const km = KIND_LABEL[c.kind] || { label: c.kind, emoji: "•" };
            const isDone = done.has(c._key);
            const msg = c.kind === "mail" && c.ref ? mailMap[c.ref] : null;
            return (
              <li
                key={c._key}
                className={`rounded-xl border p-5 ${SEV_COLOR[c.severity] || SEV_COLOR.watch} ${isDone ? "opacity-50" : ""}`}
              >
                {/* Header */}
                <div className="flex items-baseline gap-3 mb-3">
                  <span
                    className={`text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded ${SEV_BADGE[c.severity] || SEV_BADGE.watch}`}
                  >
                    {c.severity}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    {km.emoji} {km.label}
                  </span>
                  <button
                    onClick={() => toggleDone(c._key)}
                    className={`ml-auto text-xs px-3 py-1.5 rounded transition ${
                      isDone
                        ? "bg-emerald-700/40 text-emerald-200 hover:bg-emerald-700/60"
                        : "bg-zinc-800 text-zinc-300 hover:bg-emerald-700/60 hover:text-emerald-100 border border-zinc-700"
                    }`}
                  >
                    {isDone ? "✓ 처리됨 (취소)" : "✓ 처리 완료"}
                  </button>
                </div>

                {/* Label */}
                <h2 className="text-lg text-zinc-100 font-medium mb-2 leading-snug">
                  {c.label}
                </h2>

                {/* AI reason / action */}
                {c.reason && (
                  <p className="text-sm text-zinc-400 mb-2">📌 {c.reason}</p>
                )}
                {c.action && (
                  <p className="text-sm text-amber-300/90 mb-3">→ {c.action}</p>
                )}

                {/* Context: mail body inline */}
                {msg && (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="flex items-baseline gap-2 mb-2 text-xs text-zinc-500">
                      <span className="text-zinc-300">{msg.fromName}</span>
                      <span>&lt;{msg.fromAddr}&gt;</span>
                      <span className="ml-auto">{msg.date}</span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-2 italic">{msg.subject}</p>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-6">
                      {msg.snippet || msg.body?.slice(0, 600)}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-4">
                  {c.kind === "mail" && c.ref && (
                    <Link
                      href={`/mail?id=${encodeURIComponent(c.ref)}`}
                      className="text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white"
                    >
                      📧 메일 열기 (답장)
                    </Link>
                  )}
                  {c.kind === "calendar" && (
                    <Link
                      href="/calendar"
                      className="text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white"
                    >
                      📅 캘린더 열기
                    </Link>
                  )}
                  {c.kind === "people" && (
                    <Link
                      href="/people"
                      className="text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white"
                    >
                      👥 인맥 카드 열기
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-[10px] text-zinc-600 font-mono">
        Source: /weekly_alerts.json (Gemini Flash, 4h cron) · 처리 상태 localStorage 저장
      </p>
    </div>
  );
}
