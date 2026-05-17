"use client";
import { useEffect, useState } from "react";

type Item = { rank: number; kind: string; title: string; why?: string };
type Brief = {
  date: string;
  generatedAt: number;
  inputs: { eventsCount: number; mailsCount: number; overdueCount: number };
  brief: {
    headline: string;
    top5: Item[];
    watchouts?: string;
  };
};

const KIND_META: Record<string, { emoji: string; label: string; color: string }> = {
  meeting: { emoji: "📅", label: "meeting", color: "text-cyan-300" },
  mail: { emoji: "📧", label: "mail", color: "text-amber-300" },
  people: { emoji: "👥", label: "people", color: "text-violet-300" },
  task: { emoji: "✅", label: "task", color: "text-emerald-300" },
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function MorningBrief() {
  const [data, setData] = useState<Brief | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/morning_brief.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); else setErr(true); })
      .catch(() => setErr(true));
  }, []);

  if (err || !data) return null;

  return (
    <section className="mb-6 rounded-xl border border-sky-900/50 bg-gradient-to-br from-sky-950/40 via-zinc-900/30 to-zinc-950/30 p-5">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl">🌅</span>
        <div>
          <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">
            모닝 브리프
          </h2>
          <p className="text-xs text-zinc-500 font-mono">
            {data.date} · {ago(data.generatedAt)} 전 생성 · Gemini 2.5 Flash
          </p>
        </div>
      </div>

      <p className="text-base text-zinc-100 font-medium mb-4 leading-relaxed">
        {data.brief.headline}
      </p>

      <ol className="space-y-2">
        {data.brief.top5.map((item) => {
          const meta = KIND_META[item.kind] || KIND_META.task;
          return (
            <li
              key={item.rank}
              className="flex items-baseline gap-3 py-1.5 border-t border-zinc-800/60 first:border-t-0"
            >
              <span className="text-2xl font-bold text-zinc-600 w-7 text-right shrink-0">
                {item.rank}
              </span>
              <span className="text-lg shrink-0">{meta.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">{item.title}</p>
                {item.why && (
                  <p className="text-xs text-zinc-500 mt-0.5">{item.why}</p>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider font-mono shrink-0 ${meta.color}`}>
                {meta.label}
              </span>
            </li>
          );
        })}
      </ol>

      {data.brief.watchouts && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-xs text-amber-300/80">
          ⚠️ {data.brief.watchouts}
        </div>
      )}

      <p className="mt-3 text-[10px] text-zinc-600 font-mono">
        based on {data.inputs.eventsCount} events · {data.inputs.mailsCount} mails · {data.inputs.overdueCount} overdue people
      </p>
    </section>
  );
}
