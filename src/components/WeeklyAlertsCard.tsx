"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Celeb = { label: string; when: string; importance: "high" | "med" | "low"; why?: string };
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
  inputs: { events: number; mails: number; overdue: number };
  celebrate: Celeb[];
  crisis: Crisis[];
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

const IMPORTANCE_COLOR: Record<string, string> = {
  high: "bg-emerald-700/50 text-emerald-100 border-emerald-700",
  med: "bg-emerald-900/40 text-emerald-300 border-emerald-900/60",
  low: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const SEVERITY_COLOR: Record<string, string> = {
  urgent: "bg-rose-700/50 text-rose-100 border-rose-700",
  important: "bg-amber-800/40 text-amber-200 border-amber-800/60",
  watch: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const KIND_LABEL: Record<string, string> = {
  calendar: "일정",
  mail: "메일",
  people: "인맥",
};

function crisisHref(c: Crisis): string | undefined {
  if (c.kind === "mail" && c.ref) return `/mail?id=${encodeURIComponent(c.ref)}`;
  if (c.kind === "mail") return "/mail";
  if (c.kind === "calendar") return "/calendar";
  if (c.kind === "people") return "/people";
  return undefined;
}

export default function WeeklyAlertsCard() {
  const [data, setData] = useState<AlertsFile | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/weekly_alerts.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? setData(d) : setErr(true)))
      .catch(() => setErr(true));
  }, []);

  if (err || !data) return null;
  if (data.celebrate.length === 0 && data.crisis.length === 0) return null;

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* 축하 */}
      <div className="rounded-xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/30 to-zinc-900/30 p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-base">🎉</span>
          <h2 className="text-sm font-semibold text-emerald-200 uppercase tracking-wider">
            축하할 일 (AI 1차 분류)
          </h2>
          <span className="ml-auto text-[10px] text-zinc-600 font-mono">
            {data.celebrate.length}건 · {ago(data.generatedAt)} 전
          </span>
        </div>
        {data.celebrate.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">이번 주 자동 선별된 항목 없음</p>
        ) : (
          <ul className="space-y-2">
            {data.celebrate.map((c, i) => (
              <li key={i}>
                <Link
                  href="/calendar"
                  className="flex items-baseline gap-2 text-sm py-1 px-1 -mx-1 rounded hover:bg-zinc-800/40 transition"
                >
                  <span
                    className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded shrink-0 ${IMPORTANCE_COLOR[c.importance] || IMPORTANCE_COLOR.med}`}
                  >
                    {c.importance}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 w-12 shrink-0">
                    {c.when.slice(5)}
                  </span>
                  <span className="text-zinc-200 flex-1 truncate hover:text-emerald-300">
                    {c.label}
                  </span>
                </Link>
                {c.why && (
                  <p className="text-[10px] text-zinc-500 italic ml-16">{c.why}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 위기상황 */}
      <div className="rounded-xl border border-rose-900/40 bg-gradient-to-br from-rose-950/30 to-zinc-900/30 p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-base">🚨</span>
          <Link href="/focus" className="text-sm font-semibold text-rose-200 uppercase tracking-wider hover:text-rose-100">
            위기상황 (AI 1차 분류) →
          </Link>
          <span className="ml-auto text-[10px] text-zinc-600 font-mono">
            {data.crisis.length}건 · {ago(data.generatedAt)} 전
          </span>
        </div>
        {data.crisis.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">현재 위기 신호 없음 ✓</p>
        ) : (
          <ul className="space-y-2">
            {data.crisis.map((c, i) => {
              const href = crisisHref(c);
              const content = (
                <>
                  <span
                    className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_COLOR[c.severity] || SEVERITY_COLOR.watch}`}
                  >
                    {c.severity}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 w-8 shrink-0">
                    {KIND_LABEL[c.kind] || c.kind}
                  </span>
                  <span className="text-zinc-200 flex-1 truncate">{c.label}</span>
                </>
              );
              return (
                <li key={i}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex items-baseline gap-2 text-sm py-1 px-1 -mx-1 rounded hover:bg-zinc-800/40 transition"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-baseline gap-2 text-sm py-1 px-1">{content}</div>
                  )}
                  {c.action && (
                    <p className="text-[10px] text-zinc-500 italic ml-16">→ {c.action}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
