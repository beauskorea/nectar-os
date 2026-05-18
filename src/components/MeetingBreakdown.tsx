"use client";
import { useEffect, useMemo, useState } from "react";
import { CalEvent } from "@/lib/calendars";

type WindowKey = "week" | "month" | "quarter" | "all";

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: "week", label: "이번 주" },
  { key: "month", label: "이번 달" },
  { key: "quarter", label: "최근 90일" },
  { key: "all", label: "전체" },
];

function windowRange(w: WindowKey): { start: number; end: number; label: string; days: number } {
  const now = new Date();
  const nowTs = now.getTime();
  if (w === "week") {
    const day = now.getDay(); // 0=Sun
    const monOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + monOffset);
    monday.setHours(0, 0, 0, 0);
    const elapsedDays = Math.max(1, Math.ceil((nowTs - monday.getTime()) / 86400000));
    return { start: monday.getTime(), end: nowTs, label: "이번 주", days: elapsedDays };
  }
  if (w === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start: monthStart.getTime(), end: nowTs, label: "이번 달", days: now.getDate() };
  }
  if (w === "quarter") {
    return { start: nowTs - 90 * 86400000, end: nowTs, label: "최근 90일", days: 90 };
  }
  return { start: 0, end: nowTs, label: "전체", days: 365 };
}

type CategoryDef = {
  key: string;
  label: string;
  emoji: string;
  color: string;
  // 키워드 OR 매칭. 위에서부터 순서대로 확인 (먼저 매칭되는 것이 우선)
  match: (e: CalEvent, ctx: { freq: Record<string, number>; norm: string }) => boolean;
};

function normalizeTitle(t: string): string {
  return (t || "")
    .replace(/[(\[].*?[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase()
    .trim();
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "routine",
    label: "정기 회의",
    emoji: "🔄",
    color: "bg-zinc-500",
    match: (e, ctx) => {
      const t = e.title || "";
      if (/주간|데일리|스탠드업|스크럼|정기|체크인|위클리|주례/.test(t)) return true;
      // 빈도 ≥ 3 → 정기로 간주
      return !!ctx.norm && (ctx.freq[ctx.norm] || 0) >= 3;
    },
  },
  {
    key: "1on1",
    label: "1on1 · 면담",
    emoji: "🤝",
    color: "bg-cyan-500",
    match: (e) => /1on1|1:1|면담|일대일|1대1/.test(e.title || ""),
  },
  {
    key: "external",
    label: "외부 미팅",
    emoji: "🌐",
    color: "bg-violet-500",
    match: (e) => /방문|기자|애널리스트|투자자|파트너|클라이언트|대표|이사|상무|전무|미팅\s*\(외부|외부\s*미팅/.test(e.title || ""),
  },
  {
    key: "meal",
    label: "식사 · 회식",
    emoji: "🍽️",
    color: "bg-amber-500",
    match: (e) => /회식|식사|런치|디너|점심|저녁|브렉퍼스트|아침식|커피|티타임/.test(e.title || ""),
  },
  {
    key: "event",
    label: "워크샵 · 이벤트",
    emoji: "🎤",
    color: "bg-pink-500",
    match: (e) => /워크샵|워크숍|세미나|컨퍼런스|기자간담|런칭|오픈|발표|프레젠테이션|이벤트|행사|촬영|인터뷰|간담회/.test(e.title || ""),
  },
  {
    key: "pt",
    label: "PT · 운동",
    emoji: "💪",
    color: "bg-emerald-500",
    match: (e) => /PT|운동|헬스|골프|요가|필라테스|러닝/.test(e.title || ""),
  },
  {
    key: "errand",
    label: "잡무 · 인테리어",
    emoji: "🔧",
    color: "bg-orange-500",
    match: (e) => /청소|도배|인터넷\s*설치|수리|배송|배달|설치|이사|병원|치과|약속\s*없|건강검진|미용|마사지/.test(e.title || ""),
  },
  {
    key: "meeting_general",
    label: "기타 미팅",
    emoji: "💬",
    color: "bg-blue-500",
    match: (e) => /미팅|회의|콜|통화|약속|상담/.test(e.title || ""),
  },
];

function classify(e: CalEvent, ctx: { freq: Record<string, number>; norm: string }): string {
  for (const c of CATEGORIES) {
    if (c.match(e, ctx)) return c.key;
  }
  return "other";
}

type PersonRow = { name: string; role?: string; count: number };
type PeopleFile = {
  people?: Array<{
    name: string;
    role?: string;
    kind?: string;
    matchKeywords?: string[];
  }>;
};

// 팀 분류 — role 텍스트와 이벤트 제목 키워드 기반 휴리스틱
const TEAMS: Array<{
  key: string;
  label: string;
  emoji: string;
  color: string;
  roleKw: string[];
  titleKw: string[];
}> = [
  {
    key: "exec",
    label: "임원·대표",
    emoji: "👔",
    color: "bg-sky-500",
    roleKw: ["대표", "전무", "상무", "이사", "CEO", "COO", "CFO", "CTO"],
    titleKw: ["대표님", "전무", "상무", "이사회", "EVP", "임원"],
  },
  {
    key: "marketing",
    label: "마케팅·콘텐츠",
    emoji: "📣",
    color: "bg-amber-500",
    roleKw: ["마케팅", "콘텐츠", "광고"],
    titleKw: ["마케팅", "콘텐츠", "광고", "캠페인"],
  },
  {
    key: "viral",
    label: "바이럴",
    emoji: "🌊",
    color: "bg-pink-500",
    roleKw: ["바이럴"],
    titleKw: ["바이럴"],
  },
  {
    key: "creator",
    label: "크리에이터·전속",
    emoji: "🎬",
    color: "bg-violet-500",
    roleKw: ["크리에이터", "전속", "MCN"],
    titleKw: ["크리에이터"],
  },
  {
    key: "trainee",
    label: "연습생·트레이닝",
    emoji: "🌱",
    color: "bg-emerald-500",
    roleKw: ["연습생", "트레이닝", "트래킹"],
    titleKw: ["연습생", "트레이닝"],
  },
  {
    key: "ops",
    label: "재무·법무·채용",
    emoji: "⚖️",
    color: "bg-zinc-400",
    roleKw: ["재무", "법무", "채용", "회계", "인사"],
    titleKw: ["재무", "법무", "채용", "회계", "인사", "결재", "정산"],
  },
  {
    key: "scout",
    label: "스카웃·발굴",
    emoji: "🎯",
    color: "bg-orange-500",
    roleKw: ["스카웃", "발굴", "영입"],
    titleKw: ["스카웃", "발굴", "영입"],
  },
  {
    key: "external_press",
    label: "외부 (기자·애널)",
    emoji: "📰",
    color: "bg-rose-500",
    roleKw: ["기자", "애널", "리포터"],
    titleKw: ["기자간담", "취재", "인터뷰"],
  },
  {
    key: "external_brand",
    label: "외부 (브랜드·파트너)",
    emoji: "🤝",
    color: "bg-cyan-500",
    roleKw: ["브랜드", "파트너", "투자자", "클라이언트"],
    titleKw: ["브랜드", "파트너", "투자자", "클라이언트", "방문"],
  },
];

const TARGETS_KEY = "jinho-balance-targets-v1";
const DEFAULT_TARGETS: Record<string, number> = {
  routine: 20,
  "1on1": 20,
  external: 20,
  meal: 10,
  event: 15,
  pt: 5,
  errand: 5,
  meeting_general: 5,
};

export default function MeetingBreakdown({ events }: { events: CalEvent[] }) {
  const [people, setPeople] = useState<PeopleFile["people"]>([]);
  const [win, setWin] = useState<WindowKey>("month");
  const [trendMode, setTrendMode] = useState<"month" | "week">("month");
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>(DEFAULT_TARGETS);
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TARGETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        // merge with defaults so new keys don't break
        setTargets({ ...DEFAULT_TARGETS, ...parsed });
      }
    } catch {}
  }, []);

  const saveTargets = (next: Record<string, number>) => {
    setTargets(next);
    try {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(next));
    } catch {}
  };

  const resetTargets = () => {
    saveTargets(DEFAULT_TARGETS);
  };
  useEffect(() => {
    fetch("/people.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: PeopleFile) => setPeople(j.people || []))
      .catch(() => null);
  }, []);

  const analysis = useMemo(() => {
    const range = windowRange(win);
    // window filter
    const inWindow = events.filter((e) => {
      const t = new Date(e.start).getTime();
      return !Number.isNaN(t) && t >= range.start && t <= range.end;
    });

    // freq table for routine detection
    const freq: Record<string, number> = {};
    for (const e of inWindow) {
      const k = normalizeTitle(e.title);
      if (k) freq[k] = (freq[k] || 0) + 1;
    }

    // category counts
    const catCount: Record<string, number> = {};
    const catSamples: Record<string, string[]> = {};
    for (const e of inWindow) {
      const norm = normalizeTitle(e.title);
      const k = classify(e, { freq, norm });
      catCount[k] = (catCount[k] || 0) + 1;
      (catSamples[k] ||= []).push(e.title);
    }

    // calendar bucket
    const calCount: Record<string, number> = {};
    for (const e of inWindow) {
      calCount[e.cal] = (calCount[e.cal] || 0) + 1;
    }

    // people frequency
    const peopleCount: PersonRow[] = (people || [])
      .map((p) => {
        const kws = p.matchKeywords || [];
        let n = 0;
        for (const e of inWindow) {
          const t = e.title || "";
          if (kws.some((kw) => kw && t.includes(kw))) n++;
        }
        return { name: p.name, role: p.role, count: n };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    type TrendBucket = {
      key: string;
      label: string;
      total: number;
      routine: number;
      special: number;
      isCurrent: boolean;
      isFuture: boolean;
    };

    function bucketize(start: Date, end: Date, label: string, isCurrent: boolean, isFuture: boolean, key: string): TrendBucket {
      const list = events.filter((e) => {
        const t = new Date(e.start).getTime();
        return !Number.isNaN(t) && t >= start.getTime() && t < end.getTime();
      });
      let routine = 0;
      let special = 0;
      for (const ev of list) {
        const norm = normalizeTitle(ev.title);
        const cat = classify(ev, { freq, norm });
        if (cat === "routine") routine++;
        else special++;
      }
      return { key, label, total: list.length, routine, special, isCurrent, isFuture };
    }

    // 월별: 지난 2 + 이번 + 미래 3 = 6개월
    const now = new Date();
    const monthly: TrendBucket[] = [];
    for (let i = -2; i <= 3; i++) {
      const ms = new Date(now.getFullYear(), now.getMonth() + i, 1, 0, 0, 0, 0);
      const me = new Date(now.getFullYear(), now.getMonth() + i + 1, 1, 0, 0, 0, 0);
      monthly.push(
        bucketize(
          ms,
          me,
          `${ms.getMonth() + 1}월`,
          i === 0,
          i > 0,
          `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, "0")}`,
        ),
      );
    }

    // 주별: 지난 4 + 이번 + 미래 4 = 9주 (월요일 시작)
    const weekly: TrendBucket[] = [];
    const day = now.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + monOffset, 0, 0, 0, 0);
    for (let i = -4; i <= 4; i++) {
      const ws = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + i * 7);
      const we = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + (i + 1) * 7);
      const m = ws.getMonth() + 1;
      const d = ws.getDate();
      weekly.push(
        bucketize(
          ws,
          we,
          `${m}/${d}`,
          i === 0,
          i > 0,
          `w-${ws.getFullYear()}-${m}-${d}`,
        ),
      );
    }

    // 팀별 — role / title 키워드 매핑
    const teamCount: Record<string, number> = {};
    const teamPeople: Record<string, Set<string>> = {};
    for (const e of inWindow) {
      const title = e.title || "";
      let assigned: string | null = null;
      // 1) title 키워드 매칭
      for (const team of TEAMS) {
        if (team.titleKw.some((kw) => title.includes(kw))) {
          assigned = team.key;
          break;
        }
      }
      // 2) matchedPerson.role 키워드 매칭
      if (!assigned) {
        for (const p of people || []) {
          const kws = p.matchKeywords || [];
          if (kws.some((kw) => kw && title.includes(kw))) {
            const role = (p as Person & { role?: string }).role || "";
            for (const team of TEAMS) {
              if (team.roleKw.some((kw) => role.includes(kw))) {
                assigned = team.key;
                (teamPeople[team.key] ||= new Set()).add(p.name);
                break;
              }
            }
            if (assigned) break;
          }
        }
      }
      const key = assigned || "other";
      teamCount[key] = (teamCount[key] || 0) + 1;
    }

    // 요일별 (월~일) — 분석 윈도우 기준, 종일 제외
    const dayBuckets = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    // 시간대 (오전 6-12 / 점심 12-14 / 오후 14-18 / 저녁 18-22 / 야간 22-6)
    const slotLabels = ["오전", "점심", "오후", "저녁", "야간"];
    const slotBuckets = [0, 0, 0, 0, 0];
    for (const e of inWindow) {
      if (e.allDay) continue;
      const d = new Date(e.start);
      if (Number.isNaN(d.getTime())) continue;
      // Convert JS day (0=Sun..6=Sat) to (0=Mon..6=Sun)
      const jsDay = d.getDay();
      const dayIdx = (jsDay + 6) % 7;
      dayBuckets[dayIdx]++;
      const h = d.getHours();
      let slot = 4;
      if (h >= 6 && h < 12) slot = 0;
      else if (h >= 12 && h < 14) slot = 1;
      else if (h >= 14 && h < 18) slot = 2;
      else if (h >= 18 && h < 22) slot = 3;
      slotBuckets[slot]++;
    }

    return { total: inWindow.length, catCount, catSamples, calCount, peopleCount, range, monthly, weekly, dayBuckets, slotBuckets, slotLabels, teamCount, teamPeople };
  }, [events, people, win]);

  const total = analysis.total;
  const range = analysis.range;

  // AI 코멘트 — 윈도우 변경 시 자동 fetch (sessionStorage 캐시)
  useEffect(() => {
    if (total === 0) {
      setAiText(null);
      return;
    }
    const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
    const maxDay = Math.max(...analysis.dayBuckets);
    const busiestDay = dayLabels[analysis.dayBuckets.indexOf(maxDay)];
    const slotMax = Math.max(...analysis.slotBuckets);
    const busiestSlot = analysis.slotLabels[analysis.slotBuckets.indexOf(slotMax)];
    const cats: Record<string, number> = {};
    for (const c of CATEGORIES) {
      const n = analysis.catCount[c.key] || 0;
      if (n > 0) cats[c.label] = n;
    }
    const cals: Record<string, number> = {};
    const calLabel: Record<string, string> = {
      beautysketch: "뷰티스케치",
      beauscontents: "콘텐츠",
      holiday: "공휴일",
      quick: "Quick(AI)",
    };
    for (const [k, v] of Object.entries(analysis.calCount)) {
      cals[calLabel[k] || k] = v as number;
    }
    const routine = analysis.catCount.routine || 0;
    const stats = {
      window: range.label,
      total,
      categories: cats,
      calendars: cals,
      busiestDay: { day: busiestDay, count: maxDay },
      busiestSlot: { slot: busiestSlot, count: slotMax },
      topPeople: analysis.peopleCount.slice(0, 5).map((p) => ({ name: p.name, count: p.count })),
      specialPct: Math.round(((total - routine) / total) * 100),
      weekendCount: analysis.dayBuckets[5] + analysis.dayBuckets[6],
      monthly: analysis.monthly.map((m) => ({ label: m.label, total: m.total, isCurrent: m.isCurrent })),
    };
    const cacheKey = `ai-insight:${JSON.stringify(stats)}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        setAiText(cached);
        setAiErr(null);
        return;
      }
    } catch {}
    setAiBusy(true);
    setAiErr(null);
    fetch("/api/calendar/insight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stats),
    })
      .then((r) => r.json())
      .then((d: { text?: string; error?: string }) => {
        if (d.text) {
          setAiText(d.text);
          try {
            sessionStorage.setItem(cacheKey, d.text);
          } catch {}
        } else {
          setAiErr(d.error || "AI 응답 없음");
        }
      })
      .catch((e) => setAiErr(e.message))
      .finally(() => setAiBusy(false));
  }, [analysis, total, range.label]);
  const toggle = (
    <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden text-[10px]">
      {WINDOWS.map((w) => {
        const on = win === w.key;
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => setWin(w.key)}
            className={`px-2.5 py-1 transition border-r border-zinc-800 last:border-r-0 ${
              on
                ? "bg-zinc-700/80 text-zinc-100 font-semibold"
                : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
  if (total === 0) {
    return (
      <section className="mt-8 mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-zinc-400">📊 미팅 패턴 분석</h2>
          {toggle}
        </div>
        <p className="text-xs text-zinc-500 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/30">
          {range.label} 내 이벤트 없음
        </p>
      </section>
    );
  }

  const maxCat = Math.max(1, ...Object.values(analysis.catCount));
  const calLabels: Record<string, { label: string; color: string }> = {
    beautysketch: { label: "뷰티스케치", color: "bg-amber-500" },
    beauscontents: { label: "콘텐츠", color: "bg-cyan-500" },
    holiday: { label: "공휴일", color: "bg-rose-500" },
    quick: { label: "Quick (AI)", color: "bg-violet-500" },
  };

  return (
    <section className="mt-8 mb-6">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm uppercase tracking-wider text-zinc-400">📊 미팅 패턴 분석</h2>
          <span className="text-[10px] text-zinc-600 font-mono">
            {range.label} · {total} events
          </span>
        </div>
        {toggle}
      </div>

      {/* 인사이트 라인 */}
      {(() => {
        const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
        const maxDay = Math.max(...analysis.dayBuckets);
        const busiestDayIdx = analysis.dayBuckets.indexOf(maxDay);
        const busiestDay = dayLabels[busiestDayIdx];
        const slotMax = Math.max(...analysis.slotBuckets);
        const busiestSlotIdx = analysis.slotBuckets.indexOf(slotMax);
        const busiestSlot = analysis.slotLabels[busiestSlotIdx];
        const catEntries = Object.entries(analysis.catCount).sort((a, b) => b[1] - a[1]);
        const topCat = catEntries[0];
        const topCatLabel = topCat
          ? (CATEGORIES.find((c) => c.key === topCat[0])?.label || "기타")
          : "—";
        const topCatPct = topCat ? Math.round((topCat[1] / total) * 100) : 0;
        const topPerson = analysis.peopleCount[0];
        const routine = analysis.catCount.routine || 0;
        const specialPct = total > 0 ? Math.round(((total - routine) / total) * 100) : 0;
        const weekendCount = analysis.dayBuckets[5] + analysis.dayBuckets[6];
        const chips: Array<{ label: string; value: string; color: string }> = [
          { label: "가장 바쁜 요일", value: busiestDay + (maxDay > 0 ? ` (${maxDay})` : ""), color: "text-emerald-400" },
          { label: "가장 바쁜 시간대", value: busiestSlot + (slotMax > 0 ? ` (${slotMax})` : ""), color: "text-sky-400" },
          { label: "Top 분류", value: `${topCatLabel} ${topCatPct}%`, color: "text-violet-400" },
          ...(topPerson ? [{ label: "Top 인맥", value: `${topPerson.name} (${topPerson.count}회)`, color: "text-cyan-400" }] : []),
          { label: "특별 일정", value: `${specialPct}%`, color: "text-pink-400" },
          ...(weekendCount > 0 ? [{ label: "주말 일정", value: `${weekendCount}건`, color: "text-rose-400" }] : []),
        ];
        return (
          <div className="mb-4 px-3 py-2.5 rounded-xl border border-zinc-800 bg-gradient-to-r from-zinc-900/40 to-zinc-900/10">
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span>💡</span>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                {range.label} 인사이트
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {chips.map((c, i) => (
                <div key={i} className="inline-flex items-baseline gap-1.5">
                  <span className="text-zinc-600 text-[10px]">{c.label}</span>
                  <span className={`font-medium ${c.color}`}>{c.value}</span>
                </div>
              ))}
            </div>
            {(aiBusy || aiText || aiErr) && (
              <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 text-xs leading-relaxed">
                <span className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mr-2">
                  AI 코멘트
                </span>
                {aiBusy && <span className="text-zinc-500 italic">분석 중...</span>}
                {aiErr && <span className="text-rose-400">{aiErr}</span>}
                {aiText && <span className="text-zinc-300 whitespace-pre-wrap">{aiText}</span>}
              </div>
            )}
          </div>
        );
      })()}

      {/* 추세 차트 — 월/주 토글 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              {trendMode === "month" ? "월별 추세" : "주별 추세"}
            </p>
            <span className="text-[10px] text-zinc-600 font-mono">
              {trendMode === "month" ? "과거 2 · 현재 · 미래 3" : "과거 4 · 현재 · 미래 4"}
            </span>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden text-[10px]">
            {(["month", "week"] as const).map((m) => {
              const on = trendMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTrendMode(m)}
                  className={`px-2.5 py-1 transition border-r border-zinc-800 last:border-r-0 ${
                    on
                      ? "bg-zinc-700/80 text-zinc-100 font-semibold"
                      : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {m === "month" ? "월" : "주"}
                </button>
              );
            })}
          </div>
        </div>
        {(() => {
          const series = trendMode === "month" ? analysis.monthly : analysis.weekly;
          const cols = trendMode === "month" ? "grid-cols-6" : "grid-cols-9";
          const maxMonth = Math.max(1, ...series.map((m) => m.total));
          return (
            <div className={`grid ${cols} gap-2`}>
              {series.map((m) => {
                const tot = m.total;
                const routineH = (m.routine / maxMonth) * 100;
                const specialH = (m.special / maxMonth) * 100;
                return (
                  <div key={m.key} className="flex flex-col items-center gap-1">
                    <div className="text-[10px] font-mono text-zinc-500 min-h-[14px]">
                      {tot > 0 ? tot : ""}
                    </div>
                    <div className="w-full h-24 bg-zinc-800/40 rounded relative overflow-hidden flex flex-col justify-end">
                      <div
                        className={m.isFuture ? "bg-violet-500/40" : "bg-violet-500"}
                        style={{ height: `${specialH}%` }}
                        title={`특별 ${m.special}건`}
                      />
                      <div
                        className={m.isFuture ? "bg-zinc-500/40" : "bg-zinc-500"}
                        style={{ height: `${routineH}%` }}
                        title={`정기 ${m.routine}건`}
                      />
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        m.isCurrent ? "text-sky-400" : m.isFuture ? "text-zinc-500" : "text-zinc-300"
                      }`}
                    >
                      {m.label}
                      {m.isCurrent && <span className="ml-0.5 text-[8px]">●</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div className="mt-3 pt-2 border-t border-zinc-800 flex items-center gap-3 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-violet-500" /> 특별 (1on1·외부·이벤트 등)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-zinc-500" /> 정기 회의
          </span>
          <span className="ml-auto opacity-70">미래는 흐림</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1) 카테고리 분포 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">분류별</p>
          <div className="space-y-2">
            {[...CATEGORIES, { key: "other", label: "기타", emoji: "📌", color: "bg-zinc-600" }].map((c) => {
              const n = analysis.catCount[c.key] || 0;
              if (n === 0) return null;
              const pct = Math.round((n / total) * 100);
              const w = (n / maxCat) * 100;
              return (
                <div key={c.key} className="text-xs">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-zinc-300">
                      {c.emoji} {c.label}
                    </span>
                    <span className="text-zinc-500 font-mono">
                      {n} <span className="text-zinc-600">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div className={`h-full ${c.color}`} style={{ width: `${w}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2) 캘린더 비율 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">캘린더별</p>
          <div className="space-y-2">
            {Object.entries(analysis.calCount)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => {
                const meta = calLabels[k] || { label: k, color: "bg-zinc-500" };
                const pct = Math.round((n / total) * 100);
                return (
                  <div key={k} className="text-xs">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-zinc-300">{meta.label}</span>
                      <span className="text-zinc-500 font-mono">
                        {n} <span className="text-zinc-600">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                      <div className={`h-full ${meta.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-800 text-[10px] text-zinc-600">
            평균 {Math.round((total / Math.max(1, range.days)) * 7 * 10) / 10}건/주 · {Math.round((total / Math.max(1, range.days)) * 10) / 10}건/일
          </div>
        </div>

        {/* 4) 요일 + 시간대 패턴 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">요일 · 시간대</p>
          {(() => {
            const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
            const dayMax = Math.max(1, ...analysis.dayBuckets);
            const slotMax = Math.max(1, ...analysis.slotBuckets);
            return (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-zinc-600 mb-1.5">요일</p>
                  <div className="grid grid-cols-7 gap-1">
                    {analysis.dayBuckets.map((n, i) => {
                      const h = (n / dayMax) * 100;
                      const isWeekend = i >= 5;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="text-[10px] font-mono text-zinc-500 min-h-[12px]">{n || ""}</div>
                          <div className="w-full h-16 bg-zinc-800/40 rounded relative overflow-hidden flex flex-col justify-end">
                            <div
                              className={isWeekend ? "bg-rose-500/70" : "bg-emerald-500"}
                              style={{ height: `${h}%` }}
                              title={`${dayLabels[i]} ${n}건`}
                            />
                          </div>
                          <div className={`text-[10px] ${isWeekend ? "text-rose-400" : "text-zinc-400"}`}>
                            {dayLabels[i]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="pt-2 border-t border-zinc-800">
                  <p className="text-[10px] text-zinc-600 mb-1.5">시간대 (종일 제외)</p>
                  <div className="space-y-1.5">
                    {analysis.slotLabels.map((lab, i) => {
                      const n = analysis.slotBuckets[i];
                      const w = (n / slotMax) * 100;
                      return (
                        <div key={lab} className="text-[11px]">
                          <div className="flex items-baseline justify-between mb-0.5">
                            <span className="text-zinc-400">{lab}</span>
                            <span className="text-zinc-500 font-mono">{n}</span>
                          </div>
                          <div className="h-1 bg-zinc-800 rounded overflow-hidden">
                            <div className="h-full bg-sky-500" style={{ width: `${w}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* 3) 자주 만나는 사람 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">자주 만난 사람 (인맥 매칭)</p>
          {analysis.peopleCount.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">
              매칭된 일정 없음 · 인맥 페이지에서 등록 후 자동 매칭
            </p>
          ) : (
            <ul className="space-y-1.5">
              {analysis.peopleCount.slice(0, 12).map((p, i) => (
                <li key={p.name} className="flex items-baseline justify-between text-xs">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="text-zinc-600 font-mono text-[10px] w-4 shrink-0">
                      {i + 1}.
                    </span>
                    <span className="text-zinc-200 truncate" title={p.role || ""}>
                      {p.name}
                    </span>
                  </span>
                  <span className="text-zinc-500 font-mono ml-2 shrink-0">{p.count}회</span>
                </li>
              ))}
              {analysis.peopleCount.length > 12 && (
                <li className="text-[10px] text-zinc-600 italic">
                  +{analysis.peopleCount.length - 12} more
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* ⚖️ 균형 진단 — 사용자 세팅 가능한 권장 비율 vs 현재 */}
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h3 className="text-sm uppercase tracking-wider text-zinc-300">⚖️ 균형 진단</h3>
            <span className="text-[10px] text-zinc-600 font-mono">권장 vs 현재 ({range.label})</span>
          </div>
          <div className="flex items-center gap-2">
            {editingTargets && (
              <>
                <span className="text-[10px] text-zinc-600 font-mono">
                  합계 {Object.values(targets).reduce((s, v) => s + v, 0)}%
                </span>
                <button
                  onClick={resetTargets}
                  className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  ↺ 기본값
                </button>
              </>
            )}
            <button
              onClick={() => setEditingTargets((v) => !v)}
              className={`text-[10px] px-2 py-1 rounded border ${
                editingTargets
                  ? "bg-violet-700/60 border-violet-500 text-violet-50 font-semibold"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              }`}
            >
              {editingTargets ? "완료" : "⚙ 권장 비율 세팅"}
            </button>
          </div>
        </div>
        {(() => {
          const TARGETS = targets;
          const labelOf: Record<string, string> = {
            routine: "정기 회의",
            "1on1": "1on1·면담",
            external: "외부 미팅",
            meal: "식사·회식",
            event: "워크샵·이벤트",
            pt: "PT·운동",
            errand: "잡무·인테리어",
            meeting_general: "기타 미팅",
          };
          const rows = Object.entries(TARGETS)
            .map(([key, target]) => {
              const n = analysis.catCount[key] || 0;
              const cur = total > 0 ? (n / total) * 100 : 0;
              const diff = cur - target;
              return { key, label: labelOf[key], target, cur, diff, n };
            })
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

          const verdict = (d: number) => {
            if (d >= 10) return { text: "과다", color: "text-rose-400", bar: "bg-rose-500" };
            if (d >= 4) return { text: "약간 많음", color: "text-amber-400", bar: "bg-amber-500" };
            if (d <= -10) return { text: "매우 부족", color: "text-sky-400", bar: "bg-sky-500" };
            if (d <= -4) return { text: "부족", color: "text-cyan-400", bar: "bg-cyan-500" };
            return { text: "균형", color: "text-emerald-400", bar: "bg-emerald-500" };
          };

          // 처방 카드 — 가장 큰 편차 3개에 대한 짧은 액션 제안 (휴리스틱)
          const ACTIONS: Record<string, { over: string; under: string }> = {
            routine: {
              over: "정기 회의 통합·축소 검토 — 같은 제목 반복은 격주 또는 비동기로 전환",
              under: "주요 부서 정기 체크인을 새로 세팅해 흐름 가시화",
            },
            "1on1": {
              over: "1on1이 너무 많으면 부서장 위임 — 격주 또는 30분으로 단축",
              under: "내부 핵심 인맥 (성지영·신승아·최정음 등)과 격주 1on1 잡기",
            },
            external: {
              over: "외부 미팅 과다 — 위임 또는 묶음 미팅 활용",
              under: "브랜드·파트너 콜드 미팅 늘리기 (BD 채널 강화)",
            },
            meal: {
              over: "식사·회식 과다 — 컨디션·deep work 시간 보호",
              under: "핵심 파트너와 식사 미팅 1-2회 추가 (관계 유지)",
            },
            event: {
              over: "이벤트 일정이 많아 호흡이 가쁨 — 다음 주에 노 이벤트 데이 확보",
              under: "외부 컨퍼런스·워크샵 한 개 추가해 인사이트·노출 확보",
            },
            pt: {
              over: "운동·PT 일정 과다 — 다른 우선순위 일정과 균형",
              under: "주 2-3회 운동 슬롯 고정 — CEO 체력 관리는 자산",
            },
            errand: {
              over: "잡무가 많음 — 위임 가능 항목 분리 (창현 전무 또는 외부)",
              under: "—",
            },
            meeting_general: {
              over: "분류 모호한 미팅이 많음 — 제목에 컨텍스트 추가하면 분석 정확도 ↑",
              under: "—",
            },
          };

          const top3 = rows.filter((r) => Math.abs(r.diff) >= 4).slice(0, 4);

          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT: 카테고리별 비교 (편집 모드 시 input) */}
              <div className="space-y-2">
                {rows.map((r) => {
                  const v = verdict(r.diff);
                  const maxScale = Math.max(35, r.target + 10, r.cur + 5);
                  return (
                    <div key={r.key} className="text-xs">
                      <div className="flex items-baseline justify-between mb-1 gap-2">
                        <span className="text-zinc-300">{r.label}</span>
                        {editingTargets ? (
                          <div className="flex items-baseline gap-2 font-mono text-[10px]">
                            <span className="text-zinc-600">목표</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={r.target}
                              onChange={(e) => {
                                const n = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                saveTargets({ ...targets, [r.key]: n });
                              }}
                              className="w-12 px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-100 text-right focus:outline-none focus:border-violet-500"
                            />
                            <span className="text-zinc-600">%</span>
                            <span className="text-zinc-600">/ 현재</span>
                            <span className="text-zinc-300">{Math.round(r.cur)}%</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[10px]">
                            <span className="text-zinc-500">목표 {r.target}%</span>
                            <span className="text-zinc-600"> / </span>
                            <span className="text-zinc-300">현재 {Math.round(r.cur)}%</span>
                            <span className={`ml-2 font-semibold ${v.color}`}>
                              {r.diff > 0 ? "+" : ""}
                              {Math.round(r.diff)}% · {v.text}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="relative h-2 bg-zinc-800 rounded overflow-hidden">
                        {/* 목표 위치 (점선) */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-zinc-500"
                          style={{ left: `${(r.target / maxScale) * 100}%` }}
                          title={`목표 ${r.target}%`}
                        />
                        {/* 현재 */}
                        <div
                          className={`absolute top-0 bottom-0 left-0 ${v.bar} opacity-80`}
                          style={{ width: `${(r.cur / maxScale) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {editingTargets && (
                  <p className="pt-2 text-[10px] text-zinc-600 italic">
                    입력값은 즉시 브라우저에 저장됩니다 (localStorage). 합계가 100%가 아니어도 동작하지만, 권장은 100%.
                  </p>
                )}
              </div>

              {/* RIGHT: 처방 */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                  편차 큰 항목 처방 (상위 {top3.length}개)
                </p>
                {top3.length === 0 ? (
                  <p className="text-xs text-emerald-400">
                    ✓ 모든 카테고리가 권장 ±4% 이내 — 균형 잘 잡혀있음
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {top3.map((r) => {
                      const v = verdict(r.diff);
                      const over = r.diff > 0;
                      const action = ACTIONS[r.key]?.[over ? "over" : "under"] || "";
                      return (
                        <li
                          key={r.key}
                          className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                        >
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className={`text-[10px] uppercase tracking-wider font-bold ${v.color}`}>
                              {over ? "↑" : "↓"} {v.text}
                            </span>
                            <span className="text-xs text-zinc-300 font-medium">{r.label}</span>
                            <span className="text-[10px] text-zinc-600 font-mono ml-auto">
                              {Math.round(r.cur)}% vs {r.target}%
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 leading-snug">{action}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="pt-2 mt-2 border-t border-zinc-800 text-[10px] text-zinc-600 italic">
                  처방은 휴리스틱. AI 코멘트가 위에 동적으로 정리되어 있음 (윈도우 토글 시 자동 갱신).
                </p>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 👥 팀별 미팅 분포 */}
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm uppercase tracking-wider text-zinc-300">👥 팀별 미팅 분포</h3>
          <span className="text-[10px] text-zinc-600 font-mono">{range.label}</span>
        </div>
        {(() => {
          const otherN = analysis.teamCount.other || 0;
          const rows = TEAMS.map((t) => ({
            ...t,
            n: analysis.teamCount[t.key] || 0,
            people: analysis.teamPeople[t.key] ? Array.from(analysis.teamPeople[t.key]) : [],
          }))
            .filter((r) => r.n > 0)
            .sort((a, b) => b.n - a.n);

          if (rows.length === 0 && otherN === 0) {
            return <p className="text-xs text-zinc-500 italic">분류된 일정 없음</p>;
          }
          const maxN = Math.max(1, ...rows.map((r) => r.n), otherN);

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {rows.map((r) => {
                const pct = total > 0 ? Math.round((r.n / total) * 100) : 0;
                const w = (r.n / maxN) * 100;
                return (
                  <div key={r.key} className="text-xs">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-zinc-300">
                        {r.emoji} {r.label}
                      </span>
                      <span className="text-zinc-500 font-mono">
                        {r.n} <span className="text-zinc-600">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded overflow-hidden mb-1">
                      <div className={`h-full ${r.color}`} style={{ width: `${w}%` }} />
                    </div>
                    {r.people.length > 0 && (
                      <p className="text-[10px] text-zinc-600 truncate" title={r.people.join(", ")}>
                        ↳ {r.people.slice(0, 5).join(", ")}
                        {r.people.length > 5 && ` +${r.people.length - 5}`}
                      </p>
                    )}
                  </div>
                );
              })}
              {otherN > 0 && (
                <div className="text-xs">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-zinc-500">❓ 미분류</span>
                    <span className="text-zinc-600 font-mono">
                      {otherN} ({total > 0 ? Math.round((otherN / total) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-zinc-600" style={{ width: `${(otherN / maxN) * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1 italic">
                    제목·역할에 키워드 없어 분류 안 됨 — 키워드 보강 가능
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </section>
  );
}
