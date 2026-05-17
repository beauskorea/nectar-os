"use client";
import { useEffect, useMemo, useState } from "react";

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};

type Person = {
  name: string;
  matchKeywords?: string[];
};

const ROUTINE_RE = /주간회의|데일리|스탠드업|스크럼|정기|체크인|위클리|주례|추가PT|운동/;
const SPECIAL_RE = /워크샵|워크숍|세미나|컨퍼런스|기자간담|런칭|오픈|발표|프레젠테이션|마감|제출|발송|촬영|인터뷰|출장|투어|방문|이벤트|행사/;
const MEETING_RE = /미팅|회의|면담|1on1|1:1|약속|콜|통화|런치|디너|회식|식사/;

function normalize(t: string): string {
  return (t || "").replace(/[(\[].*?[)\]]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export default function HomeMeetingPulse() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/events", { cache: "default" })
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => null);
    fetch("/people.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPeople(j.people || []))
      .catch(() => null);
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + monOffset, 0, 0, 0, 0);
    const nextMon = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    const inWeek = events.filter((e) => {
      const t = new Date(e.start).getTime();
      return !Number.isNaN(t) && t >= monday.getTime() && t < nextMon.getTime();
    });
    const freq: Record<string, number> = {};
    for (const e of inWeek) {
      const k = normalize(e.title);
      if (k) freq[k] = (freq[k] || 0) + 1;
    }
    let routine = 0, special = 0, meeting = 0, other = 0;
    const dayBuckets = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    for (const e of inWeek) {
      if (!e.allDay) {
        const t = new Date(e.start);
        const jd = t.getDay();
        dayBuckets[(jd + 6) % 7]++;
      } else {
        const t = new Date(e.start);
        const jd = t.getDay();
        dayBuckets[(jd + 6) % 7]++;
      }
      const n = normalize(e.title);
      if (ROUTINE_RE.test(e.title) || (freq[n] || 0) >= 3) routine++;
      else if (SPECIAL_RE.test(e.title) || e.allDay) special++;
      else if (MEETING_RE.test(e.title)) meeting++;
      else other++;
    }
    const total = inWeek.length;
    const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
    const maxDay = Math.max(...dayBuckets);
    const busiestIdx = dayBuckets.indexOf(maxDay);
    const busiestDay = total > 0 ? `${dayLabels[busiestIdx]} (${maxDay})` : "—";

    // people
    const peopleCount = (people || [])
      .map((p) => {
        const kws = p.matchKeywords || [];
        let n = 0;
        for (const e of inWeek) {
          if (kws.some((kw) => kw && e.title.includes(kw))) n++;
        }
        return { name: p.name, count: n };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      total,
      routine,
      special,
      meeting,
      other,
      busiestDay,
      topPerson: peopleCount[0],
      dayBuckets,
      monday,
    };
  }, [events, people]);

  // AI comment (this week pulse)
  useEffect(() => {
    if (stats.total === 0) {
      setAiText(null);
      return;
    }
    const payload = {
      window: "이번 주",
      total: stats.total,
      categories: {
        "정기 회의": stats.routine,
        "특별 일정": stats.special,
        "일반 미팅": stats.meeting,
        "기타": stats.other,
      },
      busiestDay: stats.busiestDay,
      topPerson: stats.topPerson,
      dayBuckets: stats.dayBuckets,
    };
    const key = `pulse:${JSON.stringify(payload)}`;
    try {
      const c = sessionStorage.getItem(key);
      if (c) {
        setAiText(c);
        return;
      }
    } catch {}
    setAiBusy(true);
    fetch("/api/calendar/insight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        window: "이번 주",
        total: stats.total,
        categories: payload.categories,
        calendars: {},
        busiestDay: { day: stats.busiestDay.split(" ")[0], count: Math.max(...stats.dayBuckets) },
        busiestSlot: { slot: "", count: 0 },
        topPeople: stats.topPerson ? [stats.topPerson] : [],
        specialPct: stats.total > 0 ? Math.round((stats.special / stats.total) * 100) : 0,
        weekendCount: stats.dayBuckets[5] + stats.dayBuckets[6],
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.text) {
          setAiText(d.text);
          try {
            sessionStorage.setItem(key, d.text);
          } catch {}
        }
      })
      .catch(() => null)
      .finally(() => setAiBusy(false));
  }, [stats]);

  if (stats.total === 0) {
    return (
      <a
        href="/calendar"
        className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-600 transition"
      >
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-medium text-zinc-300">📊 미팅 펄스 (이번 주)</h2>
          <span className="text-[10px] text-zinc-600 font-mono">→ /calendar</span>
        </div>
        <p className="text-sm text-zinc-500 italic">이번 주 일정 없음</p>
      </a>
    );
  }

  return (
    <a
      href="/calendar"
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-600 transition"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">📊 미팅 펄스 (이번 주)</h2>
        <span className="text-[10px] text-zinc-600 font-mono">{stats.total} events → /calendar</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs mb-3">
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-600 text-[10px]">바쁜 요일</span>
          <span className="font-medium text-emerald-400">{stats.busiestDay}</span>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-600 text-[10px]">정기</span>
          <span className="font-medium text-zinc-300">{stats.routine}</span>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-600 text-[10px]">특별</span>
          <span className="font-medium text-violet-400">{stats.special}</span>
        </div>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-600 text-[10px]">미팅</span>
          <span className="font-medium text-blue-400">{stats.meeting}</span>
        </div>
        {stats.topPerson && (
          <div className="inline-flex items-baseline gap-1.5">
            <span className="text-zinc-600 text-[10px]">Top 인맥</span>
            <span className="font-medium text-cyan-400">
              {stats.topPerson.name} ({stats.topPerson.count}회)
            </span>
          </div>
        )}
      </div>
      <div className="pt-3 border-t border-zinc-800/80 text-xs leading-relaxed">
        <span className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mr-2">
          AI 코멘트
        </span>
        {aiBusy && <span className="text-zinc-500 italic">분석 중...</span>}
        {!aiBusy && aiText && <span className="text-zinc-300 whitespace-pre-wrap">{aiText}</span>}
        {!aiBusy && !aiText && <span className="text-zinc-500 italic">코멘트 로드 실패</span>}
      </div>
    </a>
  );
}
