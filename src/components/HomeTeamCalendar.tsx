"use client";
import { useEffect, useMemo, useState } from "react";

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
  location?: string;
};

const TEAM_LABELS: Record<string, { label: string; emoji: string; dot: string; text: string }> = {
  beauskorea: { label: "Jinho Park", emoji: "👤", dot: "bg-sky-400", text: "text-sky-300" },
  beautysketch: { label: "뷰티스케치", emoji: "🌊", dot: "bg-pink-400", text: "text-pink-300" },
  beauscontents: { label: "콘텐츠", emoji: "📣", dot: "bg-cyan-400", text: "text-cyan-300" },
  mgmt_team: { label: "매니지먼트", emoji: "💼", dot: "bg-teal-400", text: "text-teal-300" },
  sonjuhee_just: { label: "손주희", emoji: "🎬", dot: "bg-violet-400", text: "text-violet-300" },
  quick: { label: "Quick (AI)", emoji: "✨", dot: "bg-violet-400", text: "text-violet-300" },
  mock: { label: "샘플", emoji: "📌", dot: "bg-zinc-500", text: "text-zinc-400" },
};

const REP_CAL_KEYS = new Set(["beauskorea", "beautysketch", "quick"]);
const REP_TITLE_RE = /대표|전무|상무|임원|고문|자문|주간회의/;

function parseDateLocal(s: string): Date {
  if (s.length === 10) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(s);
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(e: CalEvent) {
  if (e.allDay || e.start.length === 10) return "종일";
  const d = parseDateLocal(e.start);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDay(e: CalEvent, todayKey: string, tomorrowKey: string) {
  const key = e.start.length === 10 ? e.start : ymd(parseDateLocal(e.start));
  if (key === todayKey) return "오늘";
  if (key === tomorrowKey) return "내일";
  const d = parseDateLocal(e.start);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isMeeting(title: string) {
  return /미팅|회의|면담|1on1|1:1|콜|통화|주간|정기|TF|tf/i.test(title);
}

function isRepEvent(e: CalEvent) {
  return REP_CAL_KEYS.has(e.cal) || REP_TITLE_RE.test(e.title);
}

type CalendarGroup = {
  cal: string;
  meta: { label: string; emoji: string; dot: string; text: string };
  items: CalEvent[];
  today: number;
  meetings: number;
};

function groupByCalendar(items: CalEvent[], todayKey: string): CalendarGroup[] {
  const byCal = new Map<string, CalEvent[]>();
  for (const e of items) {
    if (e.cal === "holiday") continue;
    const arr = byCal.get(e.cal) || [];
    arr.push(e);
    byCal.set(e.cal, arr);
  }
  return [...byCal.entries()]
    .map(([cal, calItems]) => ({
      cal,
      meta: TEAM_LABELS[cal] || { label: cal, emoji: "📌", dot: "bg-zinc-500", text: "text-zinc-400" },
      items: calItems,
      today: calItems.filter((e) => (e.start.length === 10 ? e.start : ymd(parseDateLocal(e.start))) === todayKey).length,
      meetings: calItems.filter((e) => isMeeting(e.title)).length,
    }))
    .sort((a, b) => b.today - a.today || b.items.length - a.items.length || a.meta.label.localeCompare(b.meta.label));
}

export default function HomeTeamCalendar() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/calendar/events?scope=team", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setEvents(Array.isArray(d?.events) ? d.events : []);
          setLoaded(true);
        })
        .catch(() => alive && setLoaded(true));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const now = useMemo(() => new Date(), []);
  const todayKey = ymd(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = ymd(tomorrow);

  const split = useMemo(() => {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const upcoming = events
      .filter((e) => {
        const start = parseDateLocal(e.start).getTime();
        return !Number.isNaN(start) && start >= todayStart.getTime() && start < weekEnd.getTime();
      })
      .sort((a, b) => parseDateLocal(a.start).getTime() - parseDateLocal(b.start).getTime());

    const representative = upcoming.filter(isRepEvent);
    const company = upcoming.filter((e) => e.cal !== "holiday" && !isRepEvent(e));

    return {
      representative: groupByCalendar(representative, todayKey),
      company: groupByCalendar(company, todayKey),
    };
  }, [events, now, todayKey]);

  const buckets = [
    {
      key: "representative",
      title: "👤 대표 달력",
      href: "/calendar",
      hint: "대표 개인·임원·고문",
      groups: split.representative,
    },
    {
      key: "company",
      title: "🏢 회사 달력",
      href: "/calendar/company",
      hint: "팀·콘텐츠·협업",
      groups: split.company,
    },
  ];

  const total = buckets.reduce((sum, b) => sum + b.groups.reduce((n, g) => n + g.items.length, 0), 0);
  const meetingTotal = buckets.reduce((sum, b) => sum + b.groups.reduce((n, g) => n + g.meetings, 0), 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-medium text-zinc-300">👥 팀별 달력</h2>
          <p className="text-[10px] text-zinc-600 mt-1">캘린더별 · 시간순 · 7일</p>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">
          {loaded ? `${total} 일정 · ${meetingTotal} 미팅` : "로딩…"}
        </span>
      </div>

      {loaded && total === 0 && <p className="text-xs text-zinc-500 italic">팀 일정 없음</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {buckets.map((bucket) => {
          const bucketTotal = bucket.groups.reduce((sum, g) => sum + g.items.length, 0);
          const visibleGroups = showAll ? bucket.groups : bucket.groups.slice(0, 3);
          return (
            <section key={bucket.key} className="min-w-0">
              <a href={bucket.href} className="group flex items-baseline justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-white">{bucket.title}</h3>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{bucket.hint}</p>
                </div>
                <span className="text-[10px] text-zinc-600 font-mono">
                  {bucketTotal} events →
                </span>
              </a>
              {bucketTotal === 0 ? (
                <p className="text-xs text-zinc-500 italic">일정 없음</p>
              ) : (
                <div className="space-y-3">
                  {visibleGroups.map((group) => (
                    <div key={`${bucket.key}-${group.cal}`} className="min-w-0">
                      <div className="flex items-baseline justify-between mb-1.5">
                        <p className={`text-[11px] uppercase tracking-wider font-semibold ${group.meta.text}`}>
                          {group.meta.emoji} {group.meta.label}
                          <span className="text-zinc-600 font-normal"> · 오늘 {group.today} · 7일 {group.items.length}</span>
                        </p>
                        {group.meetings > 0 && <span className="text-[10px] text-zinc-600 font-mono">{group.meetings} mtg</span>}
                      </div>
                      <ul className="space-y-1">
                        {group.items.slice(0, showAll ? 8 : 4).map((e) => (
                          <li key={e.id} className="flex items-baseline gap-2 text-xs rounded px-1 -mx-1 py-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${group.meta.dot}`} />
                            <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{formatDay(e, todayKey, tomorrowKey)}</span>
                            <span className="font-mono text-[10px] text-zinc-500 w-10 shrink-0">{formatTime(e)}</span>
                            <span className="truncate flex-1 text-zinc-200">{e.title}</span>
                          </li>
                        ))}
                        {group.items.length > (showAll ? 8 : 4) && (
                          <li className="text-[10px] text-zinc-600 italic px-1">+{group.items.length - (showAll ? 8 : 4)} more</li>
                        )}
                      </ul>
                    </div>
                  ))}
                  {bucket.groups.length > visibleGroups.length && (
                    <p className="text-[10px] text-zinc-600 italic">+{bucket.groups.length - visibleGroups.length} calendars</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {buckets.some((bucket) => bucket.groups.length > 3) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 pt-2 border-t border-zinc-800 w-full text-left text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {showAll ? "접기" : "더 보기"}
        </button>
      )}
    </div>
  );
}
