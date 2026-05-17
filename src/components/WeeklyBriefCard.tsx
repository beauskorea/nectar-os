"use client";
import { useEffect, useState } from "react";

type WeeklyBrief = {
  date: string;
  weekStart: string;
  generatedAt: number;
  inputs: {
    pastEvents: number;
    futureEvents: number;
    mailCatCounts: Record<string, number>;
    highMails: number;
    decisions: number;
    overdueCount: number;
  };
  brief: {
    headline: string;
    thisWeekWins: string[];
    carryOver: string[];
    nextWeekFocus: string[];
    energyNote?: string;
  };
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function WeeklyBriefCard() {
  const [data, setData] = useState<WeeklyBrief | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/weekly_brief.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? setData(d) : setErr(true)))
      .catch(() => setErr(true));
  }, []);

  if (err || !data) return null;

  return (
    <section className="mb-6 rounded-xl border border-violet-900/40 bg-gradient-to-br from-violet-950/30 via-zinc-900/30 to-zinc-950/30 p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl">🗓</span>
        <div>
          <h2 className="text-sm font-semibold text-violet-200 uppercase tracking-wider">
            주간 브리핑
          </h2>
          <p className="text-xs text-zinc-500 font-mono">
            주 시작 {data.weekStart} · {ago(data.generatedAt)} 전 생성 · Gemini 2.5 Flash
          </p>
        </div>
      </div>

      <p className="text-base text-zinc-100 font-medium mb-4 leading-snug">
        {data.brief.headline}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <p className="text-xs uppercase text-emerald-400 mb-2">✓ 이번 주 성과</p>
          <ul className="space-y-1.5">
            {data.brief.thisWeekWins.map((w, i) => (
              <li key={i} className="text-sm text-zinc-200 leading-snug">· {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase text-amber-400 mb-2">… 미해결 이월</p>
          <ul className="space-y-1.5">
            {data.brief.carryOver.map((w, i) => (
              <li key={i} className="text-sm text-zinc-300 leading-snug">· {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase text-cyan-400 mb-2">→ 다음 주 focus</p>
          <ul className="space-y-1.5">
            {data.brief.nextWeekFocus.map((w, i) => (
              <li key={i} className="text-sm text-zinc-200 leading-snug">· {w}</li>
            ))}
          </ul>
        </div>
      </div>

      {data.brief.energyNote && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-sm italic text-zinc-400">
          💭 {data.brief.energyNote}
        </div>
      )}

      <p className="mt-3 text-[10px] text-zinc-600 font-mono">
        지난 7일: 일정 {data.inputs.pastEvents}건 / high 메일 {data.inputs.highMails}건 / 결정 {data.inputs.decisions}건
        · 다음 7일: 일정 {data.inputs.futureEvents}건
      </p>
    </section>
  );
}
