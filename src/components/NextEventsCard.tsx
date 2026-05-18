"use client";
import { useEffect, useMemo, useState } from "react";
import TimeWheelPicker from "./TimeWheelPicker";

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};

const QUICK_KEY = "jinho-quick-events-v1";
const HIDE_KEY = "jinho-hidden-events-v1";

function parseDateLocal(sIn: string): Date {
  if (sIn.length === 10) {
    const [y, m, d] = sIn.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(sIn);
}

function formatTime(s: string, allDay: boolean) {
  if (allDay) return "종일";
  const d = parseDateLocal(s);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function classifyCompanyMeeting(title: string) {
  if (/대표|전무|상무|이사|임원/.test(title)) return "임원";
  if (/고문|자문|멘토/.test(title)) return "자문";
  if (/주간|정기|고정|회의/.test(title)) return "정기";
  return "미팅";
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CAL_DOT: Record<string, string> = {
  beautysketch: "bg-amber-400",
  beauscontents: "bg-sky-400",
  holiday: "bg-rose-400",
  quick: "bg-amber-400",
  mock: "bg-zinc-500",
};

function loadQuick(): CalEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveQuick(arr: CalEvent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(QUICK_KEY, JSON.stringify(arr));
}

function loadHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHidden(arr: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HIDE_KEY, JSON.stringify(arr));
}

export default function NextEventsCard() {
  const [realEvents, setRealEvents] = useState<CalEvent[]>([]);
  const [quickEvents, setQuickEvents] = useState<CalEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/events.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (Array.isArray(d?.events)) setRealEvents(d.events as CalEvent[]);
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

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuickEvents(loadQuick());
      setHidden(loadHidden());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const events = useMemo(() => [...realEvents, ...quickEvents].filter(e => !hidden.includes(e.id)), [realEvents, quickEvents, hidden]);
  const now = new Date();
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  const todayList = events
    .filter((e) => isSameDay(parseDateLocal(e.start), now))
    .sort((a, b) => parseDateLocal(a.start).getTime() - parseDateLocal(b.start).getTime());
  const tomorrowList = events
    .filter((e) => isSameDay(parseDateLocal(e.start), tomorrowDate))
    .sort((a, b) => parseDateLocal(a.start).getTime() - parseDateLocal(b.start).getTime());
  const todayCompanyList = todayList.filter((e) => e.cal !== "holiday");

  // mini calendar grid
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
  const days: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) {
      const k = e.start.length === 10 ? e.start : ymd(parseDateLocal(e.start));
      (map[k] ||= []).push(e);
    }
    return map;
  }, [events]);

  function addEvent() {
    if (!selectedDate || !newTitle.trim()) return;
    const id = `quick-${Date.now()}`;
    const allDay = !newTime;
    const startStr = allDay
      ? selectedDate
      : `${selectedDate}T${newTime}:00+09:00`;
    const endStr = allDay
      ? selectedDate
      : `${selectedDate}T${String(Math.min(parseInt(newTime.slice(0, 2), 10) + 1, 23)).padStart(2, "0")}${newTime.slice(2)}:00+09:00`;
    const ev: CalEvent = {
      id,
      title: newTitle.trim(),
      start: startStr,
      end: endStr,
      allDay,
      cal: "quick",
    };
    const next = [...quickEvents, ev];
    setQuickEvents(next);
    saveQuick(next);
    setNewTitle("");
    setNewTime("");
  }

  function removeQuick(id: string) {
    const next = quickEvents.filter((e) => e.id !== id);
    setQuickEvents(next);
    saveQuick(next);
  }

  function removeEvent(id: string, cal: string) {
    if (cal === "quick") {
      removeQuick(id);
    } else {
      // real Google 일정은 안전을 위해 화면에서만 숨김 (서버 X)
      if (!confirm("이 일정을 화면에서 숨길까요?\n(Google 캘린더에는 그대로 남음)")) return;
      const next = [...hidden, id];
      setHidden(next);
      saveHidden(next);
    }
  }

  const monthLabel = `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = ymd(now);
  const tomorrowStr = ymd(tomorrowDate);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-baseline justify-between mb-3 group cursor-pointer"
      >
        <h2 className="text-sm font-medium text-zinc-300 group-hover:text-white">
          📅 오늘 브리핑 {expanded ? "▾" : "▸"}
        </h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          {loaded ? `오늘 ${todayList.length} · 내일 ${tomorrowList.length} · 미니 ${quickEvents.length}` : "로딩…"}
        </span>
      </button>

      {/* Left: 오늘 · Right: 내일 */}
      <div className="grid grid-cols-2 gap-3">
        {/* TODAY */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-sky-300">오늘</p>
            <span className="text-[9px] text-zinc-600 font-mono">
              {now.getMonth() + 1}/{now.getDate()}
            </span>
          </div>
          <ul className="space-y-1.5">
            {todayList.length === 0 && (
              <li className="text-xs text-zinc-500 italic">자유로운 하루</li>
            )}
            {todayList.map((e) => {
              const start = parseDateLocal(e.start);
              const inProgress =
                start.getTime() <= now.getTime() && parseDateLocal(e.end).getTime() >= now.getTime();
              return (
                <li
                  key={e.id}
                  className={`flex items-baseline gap-2 text-xs rounded px-1 -mx-1 py-0.5 ${
                    inProgress ? "bg-amber-500/15 ring-1 ring-amber-500/30" : ""
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${
                      inProgress ? "bg-amber-400 animate-pulse" : CAL_DOT[e.cal] || "bg-zinc-500"
                    }`}
                  />
                  <span
                    className={`font-mono w-10 shrink-0 ${inProgress ? "text-amber-300" : "text-zinc-500"}`}
                  >
                    {inProgress ? "NOW" : formatTime(e.start, e.allDay)}
                  </span>
                  <span className="flex-1 min-w-0 flex items-baseline gap-1">
                    <span
                      className={`truncate ${
                        inProgress ? "text-amber-100 font-medium" : "text-zinc-200"
                      }`}
                    >
                      {e.title}
                    </span>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        removeEvent(e.id, e.cal);
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-950/40 text-sm leading-none shrink-0"
                      title={e.cal === "quick" ? "삭제" : "화면에서 숨기기"}
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* TOMORROW */}
        <div className="border-l border-zinc-800 pl-3">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-violet-300">내일</p>
            <span className="text-[9px] text-zinc-600 font-mono">
              {tomorrowDate.getMonth() + 1}/{tomorrowDate.getDate()}
            </span>
          </div>
          <ul className="space-y-1.5">
            {tomorrowList.length === 0 && (
              <li className="text-xs text-zinc-500 italic">일정 없음</li>
            )}
            {tomorrowList.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-2 text-xs rounded px-1 -mx-1 py-0.5"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${CAL_DOT[e.cal] || "bg-zinc-500"}`} />
                <span className="font-mono w-10 shrink-0 text-zinc-500">
                  {formatTime(e.start, e.allDay)}
                </span>
                <span className="flex-1 min-w-0 flex items-baseline gap-1">
                  <span className="truncate text-zinc-300">{e.title}</span>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeEvent(e.id, e.cal);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-950/40 text-sm leading-none shrink-0"
                    title={e.cal === "quick" ? "삭제" : "화면에서 숨기기"}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {todayCompanyList.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">📋 오늘 전사 전체</p>
            <span className="text-[10px] text-zinc-600 font-mono">{todayCompanyList.length} meetings</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {todayCompanyList.map((e) => {
              const label = classifyCompanyMeeting(e.title);
              return (
                <li
                  key={`company-${e.id}`}
                  className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CAL_DOT[e.cal] || "bg-zinc-500"}`} />
                    <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                      {formatTime(e.start, e.allDay)}
                    </span>
                    <span className="truncate text-xs text-zinc-200">{e.title}</span>
                  </div>
                  <span className="mt-1 inline-flex text-[10px] text-zinc-500">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* mini calendar (펼치기) */}
      {expanded && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="w-6 h-6 rounded text-zinc-400 hover:bg-zinc-800"
            >
              ‹
            </button>
            <span className="text-xs font-mono text-zinc-300">{monthLabel}</span>
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="w-6 h-6 rounded text-zinc-400 hover:bg-zinc-800"
            >
              ›
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300 font-mono"
            >
              today
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px text-[10px] mb-1">
            {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
              <div key={w} className="text-zinc-600 text-center">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {days.map((d, i) => {
              const k = ymd(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isTodayCell = k === todayStr;
              const isTomorrowCell = k === tomorrowStr;
              const isSelected = k === selectedDate;
              const evs = eventsByDay[k] || [];
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(k === selectedDate ? null : k)}
                  className={`aspect-square rounded text-[11px] flex flex-col items-center justify-center transition ${
                    isSelected
                      ? "bg-sky-700 text-white ring-1 ring-sky-400"
                      : isTodayCell
                      ? "bg-sky-900/50 text-sky-100 ring-1 ring-sky-700"
                      : isTomorrowCell
                      ? "bg-violet-900/30 text-violet-200"
                      : inMonth
                      ? "text-zinc-300 hover:bg-zinc-800"
                      : "text-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  <span>{d.getDate()}</span>
                  {evs.length > 0 && (
                    <span className="flex gap-px mt-px">
                      {evs.slice(0, 3).map((e, j) => (
                        <span key={j} className={`w-1 h-1 rounded-full ${CAL_DOT[e.cal] || "bg-zinc-500"}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-2">
                + {selectedDate} 일정 추가
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="제목"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) addEvent();
                  }}
                />
                <button
                  onClick={addEvent}
                  disabled={!newTitle.trim()}
                  className="bg-sky-700 hover:bg-sky-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-sky-50 rounded px-3 py-1 text-xs"
                >
                  추가
                </button>
              </div>
              <div className="flex justify-center mb-2">
                <TimeWheelPicker value={newTime} onChange={setNewTime} className="w-20" />
              </div>
              {eventsByDay[selectedDate] && eventsByDay[selectedDate].length > 0 && (
                <ul className="space-y-1 mt-2 text-xs">
                  {eventsByDay[selectedDate].map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2 text-zinc-300">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CAL_DOT[e.cal] || "bg-zinc-500"}`} />
                      <span className="font-mono text-zinc-500 w-10">{formatTime(e.start, e.allDay)}</span>
                      <span className="flex-1 min-w-0 flex items-baseline gap-1">
                        <span className="truncate">{e.title}</span>
                        <button
                          onClick={() => removeEvent(e.id, e.cal)}
                          className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-950/40 text-sm leading-none shrink-0"
                          title={e.cal === "quick" ? "삭제" : "화면에서 숨기기"}
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-[10px] text-zinc-700 font-mono mt-3 text-right">
            <a href="/calendar" className="hover:text-zinc-400">전체 캘린더 →</a> · 로컬 저장
          </p>
        </div>
      )}
    </div>
  );
}
