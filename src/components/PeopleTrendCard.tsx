"use client";
import { useEffect, useMemo, useState } from "react";

type Person = {
  name: string;
  role: string;
  kind: string;
  matchKeywords?: string[];
};

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  cal: string;
  allDay: boolean;
};

type Row = {
  person: Person;
  cur: number;
  prev: number;
  delta: number;
  trend: "up" | "down" | "flat" | "cold" | "warm";
};

const WINDOW_DAYS = 30;

function countMatches(events: CalEvent[], kws: string[], start: number, end: number): number {
  let n = 0;
  for (const e of events) {
    const t = new Date(e.start).getTime();
    if (Number.isNaN(t) || t < start || t >= end) continue;
    const title = e.title || "";
    if (kws.some((kw) => kw && title.includes(kw))) n++;
  }
  return n;
}

function classify(cur: number, prev: number): Row["trend"] {
  if (prev === 0 && cur > 0) return "warm";
  if (cur === 0 && prev > 0) return "cold";
  if (cur === 0 && prev === 0) return "flat";
  const delta = cur - prev;
  if (delta >= 2) return "up";
  if (delta <= -2) return "down";
  return "flat";
}

export default function PeopleTrendCard() {
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/people.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPeople(j.people || []))
      .catch(() => null);
    fetch("/api/calendar/events", { cache: "default" })
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => null);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const curStart = now - WINDOW_DAYS * 86400 * 1000;
    const prevStart = now - 2 * WINDOW_DAYS * 86400 * 1000;
    return people
      .map((p) => {
        const kws = (p.matchKeywords || []).filter(Boolean);
        if (kws.length === 0) return null;
        const cur = countMatches(events, kws, curStart, now);
        const prev = countMatches(events, kws, prevStart, curStart);
        return {
          person: p,
          cur,
          prev,
          delta: cur - prev,
          trend: classify(cur, prev),
        } as Row;
      })
      .filter((r): r is Row => !!r && (r.cur > 0 || r.prev > 0));
  }, [people, events]);

  const cold = rows.filter((r) => r.trend === "cold").sort((a, b) => b.prev - a.prev);
  const down = rows.filter((r) => r.trend === "down").sort((a, b) => a.delta - b.delta);
  const warm = rows.filter((r) => r.trend === "warm").sort((a, b) => b.cur - a.cur);
  const up = rows.filter((r) => r.trend === "up").sort((a, b) => b.delta - a.delta);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">📈 만남 빈도 추세</h2>
          <span className="text-[10px] text-zinc-600 font-mono">
            최근 {WINDOW_DAYS}일 vs 이전 {WINDOW_DAYS}일 · 캘린더 매칭 기준
          </span>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-[10px] text-zinc-500 hover:text-zinc-100 px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 🥶 사이 멀어짐 (cold) */}
          <div className="rounded-lg border border-sky-900/60 bg-sky-950/20 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-sky-300 font-semibold">
                🥶 멀어짐
              </p>
              <span className="text-[10px] text-sky-500 font-mono">{cold.length}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 italic">이전엔 만났지만 최근 0회</p>
            {cold.length === 0 ? (
              <p className="text-[10px] text-zinc-600">—</p>
            ) : (
              <ul className="space-y-1">
                {cold.slice(0, 8).map((r) => (
                  <li key={r.person.name} className="flex items-baseline justify-between text-xs">
                    <span className="text-zinc-200 truncate" title={r.person.role}>
                      {r.person.name}
                    </span>
                    <span className="text-sky-400 font-mono ml-2 shrink-0">
                      {r.prev}→0
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ⬇ 줄어듦 (down) */}
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
                ⬇ 줄어듦
              </p>
              <span className="text-[10px] text-amber-500 font-mono">{down.length}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 italic">횟수 감소 (-2 이상)</p>
            {down.length === 0 ? (
              <p className="text-[10px] text-zinc-600">—</p>
            ) : (
              <ul className="space-y-1">
                {down.slice(0, 8).map((r) => (
                  <li key={r.person.name} className="flex items-baseline justify-between text-xs">
                    <span className="text-zinc-200 truncate" title={r.person.role}>
                      {r.person.name}
                    </span>
                    <span className="text-amber-400 font-mono ml-2 shrink-0">
                      {r.prev}→{r.cur} ({r.delta})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ⬆ 늘어남 (up) */}
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold">
                ⬆ 늘어남
              </p>
              <span className="text-[10px] text-emerald-500 font-mono">{up.length}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 italic">횟수 증가 (+2 이상)</p>
            {up.length === 0 ? (
              <p className="text-[10px] text-zinc-600">—</p>
            ) : (
              <ul className="space-y-1">
                {up.slice(0, 8).map((r) => (
                  <li key={r.person.name} className="flex items-baseline justify-between text-xs">
                    <span className="text-zinc-200 truncate" title={r.person.role}>
                      {r.person.name}
                    </span>
                    <span className="text-emerald-400 font-mono ml-2 shrink-0">
                      {r.prev}→{r.cur} (+{r.delta})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 🆕 새로 만남 (warm) */}
          <div className="rounded-lg border border-violet-900/60 bg-violet-950/20 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-violet-300 font-semibold">
                🆕 새로 만남
              </p>
              <span className="text-[10px] text-violet-500 font-mono">{warm.length}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 italic">이전 0회 → 최근 처음</p>
            {warm.length === 0 ? (
              <p className="text-[10px] text-zinc-600">—</p>
            ) : (
              <ul className="space-y-1">
                {warm.slice(0, 8).map((r) => (
                  <li key={r.person.name} className="flex items-baseline justify-between text-xs">
                    <span className="text-zinc-200 truncate" title={r.person.role}>
                      {r.person.name}
                    </span>
                    <span className="text-violet-400 font-mono ml-2 shrink-0">
                      0→{r.cur}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
