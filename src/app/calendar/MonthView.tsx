"use client";
import "./calendar-scroll.css";
import { useEffect, useMemo, useState } from "react";
import { CALENDARS, CAL_ORDER, CalEvent } from "@/lib/calendars";

function parseDateLocal(s: string): Date {
  if (s.length === 10) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(s);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function gridStart(d: Date) {
  const first = startOfMonth(d);
  return addDays(first, -first.getDay()); // Sunday start
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 메인 = 특별/일회성 이벤트. 고정 반복 회의는 자동 제외.
// 1) 같은 제목이 N번 이상 등장하면 정기 회의로 간주 → 제외
// 2) 블랙리스트 키워드 포함시 제외 (정기 회의 표식)
// 3) 종일 일정은 무조건 포함 (워크샵·행사·출장 등)
// 4) 화이트리스트 키워드 포함 + 빈도 적은 시간 일정 → 포함
const RECURRING_BLACKLIST = [
  "주간회의", "데일리", "스탠드업", "스크럼", "정기", "체크인",
  "월요회의", "수요회의", "금요회의", "주례", "위클리",
  "추가PT", "PT 추가", "운동",
];

const SPECIAL_WHITELIST = [
  "워크샵", "워크숍", "세미나", "컨퍼런스", "기자간담", "런칭", "오픈",
  "발표", "프레젠테이션", "마감", "제출", "발송", "촬영",
  "인터뷰", "출장", "투어", "방문", "이벤트", "행사",
];

const SOFT_KEYWORDS = [
  "미팅", "면담", "1on1", "1:1", "약속", "콜", "통화",
  "런치", "디너", "회식", "식사",
];

const HOLIDAY_KEYWORDS = [
  "공휴일", "대체공휴일", "부처님오신날", "석가탄신일", "설날", "추석",
  "어린이날", "현충일", "광복절", "개천절", "한글날", "성탄절",
];

function normalizeTitle(t: string): string {
  return (t || "")
    .replace(/[(\[].*?[)\]]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase()
    .trim();
}

function isHolidayEvent(e: CalEvent): boolean {
  return e.cal === "holiday" || HOLIDAY_KEYWORDS.some((kw) => (e.title || "").includes(kw));
}

function isSpecialMain(
  e: CalEvent,
  freq: Record<string, number>,
): boolean {
  const t = e.title || "";
  if (isHolidayEvent(e)) return false;
  // 블랙리스트 — 명백한 정기 회의/루틴 제외
  if (RECURRING_BLACKLIST.some((kw) => t.includes(kw))) return false;
  // 빈도 ≥ 3 → 정기 회의로 간주 → 제외
  const norm = normalizeTitle(t);
  if (norm && (freq[norm] || 0) >= 3) return false;
  // 종일 — 큼직한 행사
  if (e.allDay) return true;
  // 화이트리스트 — 무조건 특별
  if (SPECIAL_WHITELIST.some((kw) => t.includes(kw))) return true;
  // 소프트 키워드 — 빈도 ≤ 2일 때만
  if (SOFT_KEYWORDS.some((kw) => t.includes(kw))) return true;
  return false;
}

function formatHM(s: string) {
  if (s.length === 10) return "";
  const d = new Date(s);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${ampm} ${h12}시` : `${ampm} ${h12}:${String(m).padStart(2, "0")}`;
}

function calendarMeta(cal: string) {
  return CALENDARS[cal] || {
    key: cal,
    label: cal,
    chipBg: "bg-zinc-800/80",
    chipText: "text-zinc-200",
    dotBg: "bg-zinc-500",
  };
}

export default function MonthView({ events }: { events: CalEvent[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState<Date>(new Date(2026, 4, 1)); // May 2026 default
  const [quickEvents, setQuickEvents] = useState<CalEvent[]>([]);
  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem("jinho-quick-events-v1");
        if (raw) {
          const list = JSON.parse(raw) as CalEvent[];
          if (Array.isArray(list)) setQuickEvents(list);
        } else {
          setQuickEvents([]);
        }
      } catch {
        setQuickEvents([]);
      }
    };
    reload();
    window.addEventListener("jinho-quick-events-changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("jinho-quick-events-changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  const allEvents = useMemo(() => [...events, ...quickEvents], [events, quickEvents]);
  const calendarKeys = useMemo(() => {
    const keys = new Set(CAL_ORDER);
    for (const event of allEvents) {
      if (event.cal) keys.add(event.cal);
    }
    return Array.from(keys);
  }, [allEvents]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(CAL_ORDER.map((k) => [k, true])),
  );

  const gs = useMemo(() => gridStart(cursor), [cursor]);
  const days: Date[] = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gs, i)),
    [gs],
  );

  // bucket events by day (expand multi-day)
  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of allEvents) {
      if (enabled[e.cal] === false) continue;
      const s = parseDateLocal(e.start);
      const eEnd = parseDateLocal(e.end);
      // end is exclusive for all-day; for timed treat as same day
      let cur = new Date(s);
      const last = e.allDay ? addDays(eEnd, -1) : eEnd;
      while (cur <= last) {
        const k = ymd(cur);
        (map[k] ||= []).push(e);
        if (!e.allDay && ymd(cur) === ymd(eEnd)) break;
        cur = addDays(cur, 1);
      }
    }
    // sort each day: all-day first then by time
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      });
    }
    return map;
  }, [allEvents, enabled]);

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
  const todayKey = ymd(today);
  const tomorrow = addDays(today, 1);
  const tomorrowKey = ymd(tomorrow);
  const freq: Record<string, number> = {};
  for (const ev of allEvents) {
    const k = normalizeTitle(ev.title);
    if (k) freq[k] = (freq[k] || 0) + 1;
  }
  const todayList = (eventsByDay[todayKey] || []).filter((e) => !isHolidayEvent(e));
  const tomorrowList = (eventsByDay[tomorrowKey] || []).filter((e) => !isHolidayEvent(e));
  const tomorrowImportant = tomorrowList.filter((e) => isSpecialMain(e, freq));
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekEnd = addDays(todayMid, 7);
  const weekMain = allEvents
    .filter((e) => enabled[e.cal] !== false && !isHolidayEvent(e))
    .filter((e) => {
      const s = parseDateLocal(e.start);
      return s >= todayMid && s < weekEnd && isSpecialMain(e, freq);
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="flex gap-3">
      {/* sidebar — mini cal toggles (compact) */}
      <aside className="w-36 shrink-0 space-y-0.5">
        <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">내 캘린더</p>
        {calendarKeys.map((k) => {
          const c = calendarMeta(k);
          const on = enabled[k];
          return (
            <button
              key={k}
              onClick={() => setEnabled((p) => ({ ...p, [k]: !p[k] }))}
              className="flex items-center gap-1.5 w-full text-left px-1.5 py-0.5 rounded hover:bg-zinc-800/60 transition"
            >
              <span
                className={`w-2 h-2 rounded-sm shrink-0 ${on ? c.dotBg : "bg-transparent border border-zinc-600"}`}
              />
              <span
                className={`text-[11px] truncate ${on ? "text-zinc-200" : "text-zinc-500 line-through"}`}
              >
                {c.label}
              </span>
            </button>
          );
        })}
        <div className="pt-2 mt-2 border-t border-zinc-800 text-[10px] text-zinc-600 space-y-0.5">
          <p>총 {allEvents.length}<span className="text-zinc-700"> (+{quickEvents.length})</span></p>
          <p>{cursor.getMonth() + 1}월: {allEvents.filter((e) => e.start.startsWith(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`)).length}</p>
        </div>

        <div className="pt-3 mt-3 border-t border-sky-900/60">
          <p className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold mb-1.5">
            📍 오늘 {today.getMonth() + 1}/{today.getDate()}
          </p>
          {(() => {
            if (todayList.length === 0) {
              return <p className="text-[10px] text-zinc-600 italic">일정 없음</p>;
            }
            return (
              <div className="space-y-1">
                {todayList.slice(0, 12).map((e, i) => {
                  const c = calendarMeta(e.cal);
                  return (
                    <div
                      key={`tod-${e.id}-${i}`}
                      className="flex items-start gap-1.5 text-[11px] leading-tight"
                      title={`${e.allDay ? "종일" : formatHM(e.start)} · ${e.title}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${c.dotBg}`} />
                      <div className="flex-1 min-w-0">
                        {!e.allDay && (
                          <span className="text-zinc-500 font-mono text-[10px] block">
                            {formatHM(e.start)}
                          </span>
                        )}
                        <span className="text-zinc-200 break-words">{e.title}</span>
                      </div>
                    </div>
                  );
                })}
                {todayList.length > 12 && (
                  <p className="text-[10px] text-zinc-600">+{todayList.length - 12} more</p>
                )}
              </div>
            );
          })()}
        </div>

        <div className="pt-3 mt-3 border-t border-amber-900/60">
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
              📌 내일 {tomorrow.getMonth() + 1}/{tomorrow.getDate()}
            </p>
            <span className="text-[9px] text-zinc-600 font-mono">
              중요 {tomorrowImportant.length}
            </span>
          </div>
          {tomorrowList.length === 0 ? (
            <p className="text-[10px] text-zinc-600 italic">일정 없음</p>
          ) : (
            <div className="space-y-1">
              {tomorrowList.slice(0, 12).map((e, i) => {
                const c = calendarMeta(e.cal);
                const important = isSpecialMain(e, freq);
                return (
                  <div
                    key={`tom-${e.id}-${i}`}
                    className="flex items-start gap-1.5 text-[11px] leading-tight"
                    title={`${e.allDay ? "종일" : formatHM(e.start)} · ${e.title}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${important ? "bg-amber-400" : c.dotBg}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-500 font-mono text-[10px] block">
                        {e.allDay ? "종일" : formatHM(e.start)}
                        {important && <span className="text-amber-400"> · 중요</span>}
                      </span>
                      <span className={important ? "text-amber-100 break-words" : "text-zinc-200 break-words"}>
                        {e.title}
                      </span>
                    </div>
                  </div>
                );
              })}
              {tomorrowList.length > 12 && (
                <p className="text-[10px] text-zinc-600">+{tomorrowList.length - 12} more</p>
              )}
            </div>
          )}
        </div>

        <div className="pt-3 mt-3 border-t border-violet-900/60">
          <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mb-1.5">
            📋 이번주 메인
          </p>
          {(() => {
            if (weekMain.length === 0) {
              return <p className="text-[10px] text-zinc-600 italic">메인 일정 없음</p>;
            }
            return (
              <div className="space-y-1.5">
                {weekMain.slice(0, 20).map((e, i) => {
                  const c = calendarMeta(e.cal);
                  const d = parseDateLocal(e.start);
                  const md = `${d.getMonth() + 1}/${d.getDate()}`;
                  const weekday = WEEKDAYS[d.getDay()];
                  const isToday = ymd(d) === ymd(today);
                  return (
                    <div
                      key={`wk-${e.id}-${i}`}
                      className="flex items-start gap-1.5 text-[11px] leading-tight"
                      title={`${md}(${weekday}) ${e.allDay ? "종일" : formatHM(e.start)} · ${e.title}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${c.dotBg}`} />
                      <div className="flex-1 min-w-0">
                        <span
                          className={`font-mono text-[10px] block ${
                            isToday ? "text-sky-400 font-semibold" : "text-zinc-500"
                          }`}
                        >
                          {md}({weekday}) {!e.allDay && formatHM(e.start)}{e.allDay && " 종일"}
                        </span>
                        <span className="text-zinc-200 break-words">{e.title}</span>
                      </div>
                    </div>
                  );
                })}
                {weekMain.length > 20 && (
                  <p className="text-[10px] text-zinc-600">+{weekMain.length - 20} more</p>
                )}
              </div>
            );
          })()}
        </div>
      </aside>

      {/* main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-sm"
          >
            오늘
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="w-8 h-8 rounded-lg hover:bg-zinc-800 text-zinc-400"
          >
            ‹
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="w-8 h-8 rounded-lg hover:bg-zinc-800 text-zinc-400"
          >
            ›
          </button>
          <h2 className="text-lg font-medium ml-2">{monthLabel}</h2>
          <span className="ml-auto text-xs text-zinc-500 font-mono">월 뷰</span>
        </div>

        <div className="grid grid-cols-7 grid-rows-[auto_repeat(6,minmax(110px,1fr))] border-l border-t border-zinc-800 rounded-lg overflow-hidden">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="border-r border-b border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-500 text-center"
            >
              {w}
            </div>
          ))}
          {days.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = ymd(d) === ymd(today);
            const list = eventsByDay[ymd(d)] || [];
            return (
              <div
                key={i}
                className={`relative border-r border-b p-1 overflow-hidden ${
                  isToday
                    ? "bg-sky-950/30 border-sky-500 ring-2 ring-sky-500 ring-inset z-10"
                    : `border-zinc-800 ${inMonth ? "bg-zinc-950" : "bg-zinc-900/30"}`
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  {isToday && (
                    <span className="text-[8px] uppercase tracking-wider text-sky-400 font-semibold px-0.5">
                      TODAY
                    </span>
                  )}
                  <span
                    className={`text-[10px] w-4 h-4 flex items-center justify-center rounded-full ml-auto ${
                      isToday
                        ? "bg-sky-500 text-white font-bold"
                        : inMonth
                          ? "text-zinc-400"
                          : "text-zinc-600"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="space-y-px flex-1 overflow-y-auto min-h-0 calendar-cell-scroll">
                  {list.slice(0, 12).map((e, idx) => {
                    const c = calendarMeta(e.cal);
                    if (e.allDay) {
                      return (
                        <div
                          key={`${e.id}-${idx}`}
                          className={`text-[11px] leading-tight px-1.5 py-px rounded truncate ${c.chipBg} ${c.chipText}`}
                          title={e.title}
                        >
                          {e.title}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={`${e.id}-${idx}`}
                        className="flex items-center gap-1 text-[11px] leading-tight px-0.5 truncate text-zinc-300"
                        title={`${formatHM(e.start)} ${e.title}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dotBg}`} />
                        <span className="text-zinc-500 shrink-0">{formatHM(e.start)}</span>
                        <span className="truncate">{e.title}</span>
                      </div>
                    );
                  })}
                  {list.length > 12 && (
                    <div className="text-[10px] text-zinc-500 px-1">
                      +{list.length - 12}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
