"use client";
import { useEffect, useState, useMemo } from "react";

type MorningItem = { rank: number; kind: string; title: string; why?: string; messageId?: string };
type Morning = {
  date: string;
  generatedAt: number;
  brief: { headline: string; top5: MorningItem[]; watchouts?: string };
};
type Evening = {
  date: string;
  generatedAt: number;
  wrap: {
    headline: string;
    todayWins: string[];
    unfinished: string[];
    tomorrowFocus: string[];
    energyPrompt?: string;
  };
};
type CalEvent = { start: string; title: string; cal: string; allDay: boolean };
type MailFile = { messages: Array<{ id: string; ts: number; subject: string; fromName: string; aiSummary?: string | null; priority?: string | null; category?: string | null; unread: boolean; trashed?: boolean }> };

type Slot = "morning" | "midday" | "evening" | "tomorrow" | "weekly";

function getActiveSlot(hour: number): Slot {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "midday";
  if (hour >= 18 && hour < 24) return "evening";
  // 00~06 — show evening (yesterday's)
  return "evening";
}

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DayBrief() {
  const [morning, setMorning] = useState<Morning | null>(null);
  const [evening, setEvening] = useState<Evening | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [mail, setMail] = useState<MailFile | null>(null);
  const [now, setNow] = useState(new Date());
  const [selected, setSelected] = useState<Slot | null>(null);

  useEffect(() => {
    fetch("/morning_brief.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setMorning).catch(() => null);
    fetch("/evening_wrap.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setEvening).catch(() => null);
    fetch("/data/events.json", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(setEvents).catch(() => null);
    fetch("/mail.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setMail).catch(() => null);
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hour = now.getHours();
  const active = getActiveSlot(hour);
  const view = selected ?? active;
  const t = today();

  // midday metrics (client-side)
  const middayMetrics = useMemo(() => {
    const todayStr = t;
    const dayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const nowHM = `${String(hour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const todayEvts = events.filter(e => e.start.startsWith(todayStr));
    const past = todayEvts.filter(e => {
      if (e.allDay) return false;
      const time = e.start.split("T")[1]?.slice(0, 5) || "";
      return time && time < nowHM;
    });
    const upcoming = todayEvts.filter(e => {
      if (e.allDay) return false;
      const time = e.start.split("T")[1]?.slice(0, 5) || "";
      return time && time >= nowHM;
    });
    const live = mail?.messages.filter(m => !m.trashed) || [];
    const unreadHigh = live.filter(m => m.unread && (m.priority === "high" || m.category === "action"));
    return { past: past.length, upcoming, unreadHigh, allDay: todayEvts.filter(e => e.allDay) };
  }, [events, mail, t, hour, now]);

  const slots: Array<{ id: Slot; emoji: string; label: string; subtitle: string }> = [
    { id: "morning", emoji: "🌅", label: "모닝", subtitle: "오늘 5건" },
    { id: "midday", emoji: "📊", label: "미드데이", subtitle: "진행도" },
    { id: "evening", emoji: "🌙", label: "이브닝", subtitle: "회고 + 내일" },
    { id: "tomorrow", emoji: "📆", label: "내일", subtitle: "일정 미리보기" },
    { id: "weekly", emoji: "🗓", label: "위클리", subtitle: "다음 7일" },
  ];

  return (
    <section className="mb-6">
      {/* 4-cell strip — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
        {slots.map(s => {
          const isActive = s.id === active;
          const isSelected = s.id === view;
          return (
            <button
              key={s.id}
              onClick={() => setSelected(s.id === active ? null : s.id)}
              className={`text-left rounded-lg border px-3 py-2 transition cursor-pointer ${
                isSelected
                  ? "border-sky-500/60 bg-sky-950/30"
                  : isActive
                  ? "border-sky-900/40 bg-zinc-900/40 hover:bg-zinc-800/60"
                  : "border-zinc-800 bg-zinc-900/30 opacity-70 hover:opacity-100 hover:bg-zinc-800/40"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-base">{s.emoji}</span>
                <span className={`text-xs font-medium ${isSelected ? "text-sky-200" : "text-zinc-300"}`}>
                  {s.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-[9px] uppercase text-sky-400 font-mono">now</span>
                )}
              </div>
              <p className="text-[10px] text-zinc-500 mt-0.5">{s.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Active slot detail */}
      <div className="rounded-xl border border-sky-900/50 bg-gradient-to-br from-sky-950/30 via-zinc-900/30 to-zinc-950/30 p-5">
        {view === "morning" && morning && morning.date === t && (
          <MorningView m={morning} />
        )}
        {view === "morning" && (!morning || morning.date !== t) && (
          <StalePlaceholder label="모닝 브리프" reason={!morning ? "아직 생성 전 (07:30 KST 자동)" : `${morning.date} 데이터, 오늘 아직 안 만들어짐`} />
        )}
        {view === "midday" && (
          <MiddayView metrics={middayMetrics} />
        )}
        {view === "evening" && evening && (
          <EveningView e={evening} stale={evening.date !== t} />
        )}
        {view === "evening" && !evening && (
          <StalePlaceholder label="이브닝 랩" reason="19:30 KST 자동 생성" />
        )}
        {view === "tomorrow" && (
          <TomorrowView events={events} mail={mail} />
        )}
        {view === "weekly" && (
          <WeeklyView events={events} mail={mail} />
        )}
      </div>
    </section>
  );
}

function MorningView({ m }: { m: Morning }) {
  const storeKey = `jinho-morning-done-${m.date}`;
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setDoneSet(new Set(JSON.parse(raw)));
    } catch {}
  }, [storeKey]);

  function toggle(rank: number) {
    setDoneSet(prev => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      try { localStorage.setItem(storeKey, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  function routeFor(it: MorningItem): string {
    if (it.kind === "mail") {
      if (it.messageId) return `/mail?id=${encodeURIComponent(it.messageId)}`;
      return `/mail?q=${encodeURIComponent(it.title.split(":")[0] || it.title.slice(0, 30))}`;
    }
    if (it.kind === "people") return "/people";
    if (it.kind === "meeting") return "/calendar";
    if (it.kind === "task") return "/todos";
    return "/";
  }

  return (
    <>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-base">🌅</span>
        <h2 className="text-xs font-semibold text-sky-200 uppercase tracking-wider">모닝 브리프</h2>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono">{ago(m.generatedAt)} 전 · {doneSet.size}/{m.brief.top5.length} ✓</span>
      </div>
      <p className="text-sm text-zinc-100 font-medium mb-2 leading-snug">{m.brief.headline}</p>
      <ol className="space-y-0.5">
        {m.brief.top5.map(it => {
          const meta = KIND_META[it.kind] || KIND_META.task;
          const done = doneSet.has(it.rank);
          return (
            <li key={it.rank} className="flex items-baseline gap-2 py-0.5 text-xs group">
              <button
                type="button"
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(it.rank); }}
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                  done
                    ? "bg-emerald-600/40 border-emerald-500 text-emerald-100"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
                title={done ? "완료 취소" : "완료 체크"}
              >
                {done && <span className="text-[10px] leading-none">✓</span>}
              </button>
              <span className="text-zinc-600 font-mono w-3 shrink-0">{it.rank}</span>
              <span className="text-sm shrink-0">{meta.emoji}</span>
              <a
                href={routeFor(it)}
                className={`flex-1 min-w-0 truncate hover:text-sky-300 transition ${
                  done ? "text-zinc-500 line-through" : "text-zinc-200"
                }`}
                title={it.why || ""}
              >
                {it.title}
              </a>
              <span className={`text-[9px] uppercase tracking-wider font-mono shrink-0 ${meta.color}`}>{meta.label}</span>
            </li>
          );
        })}
      </ol>
      {m.brief.watchouts && (
        <div className="mt-2 pt-2 border-t border-zinc-800 text-[11px] text-amber-300/80 leading-snug">⚠️ {m.brief.watchouts}</div>
      )}
    </>
  );
}

function MiddayView({ metrics }: { metrics: { past: number; upcoming: any[]; unreadHigh: any[]; allDay: any[] } }) {
  return (
    <>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-2xl">📊</span>
        <div>
          <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">미드데이 체크</h2>
          <p className="text-xs text-zinc-500 font-mono">실시간 · 클라이언트 계산</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="지난 일정" value={`${metrics.past}건`} />
        <Stat label="남은 일정" value={`${metrics.upcoming.length}건`} accent />
        <Stat label="미답장 high" value={`${metrics.unreadHigh.length}건`} alert={metrics.unreadHigh.length > 0} />
      </div>
      {metrics.upcoming.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase text-zinc-500 mb-2">오후 남은 일정</p>
          <ul className="space-y-1.5">
            {metrics.upcoming.slice(0, 5).map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="font-mono text-cyan-300 w-12">{e.start.split("T")[1]?.slice(0, 5)}</span>
                <span className="text-zinc-200 flex-1 truncate">{e.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {metrics.unreadHigh.length > 0 && (
        <div>
          <p className="text-xs uppercase text-rose-400 mb-2">⚑ 미답장 high/action</p>
          <ul className="space-y-1.5">
            {metrics.unreadHigh.slice(0, 5).map((m, i) => (
              <li key={i}>
                <a
                  href={`/mail?id=${encodeURIComponent(m.id)}`}
                  className="flex items-baseline gap-3 text-sm py-1 px-1 -mx-1 rounded hover:bg-zinc-800/40 transition cursor-pointer group"
                  title={m.aiSummary || m.subject}
                >
                  <span className="text-zinc-500 text-xs w-24 truncate shrink-0">{m.fromName}</span>
                  <span className="text-zinc-200 flex-1 truncate group-hover:text-sky-300">{m.aiSummary || m.subject}</span>
                  <span className="text-[10px] text-zinc-600 group-hover:text-sky-400 shrink-0">답장 →</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function EveningView({ e, stale }: { e: Evening; stale: boolean }) {
  const label = stale ? `어제 (${e.date}) 회고` : `오늘 (${e.date}) 회고`;
  const winsLabel = stale ? "✓ 어제 한 진전" : "✓ 오늘 한 진전";
  return (
    <>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl">🌙</span>
        <div>
          <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">
            이브닝 랩 {stale && <span className="text-amber-400 text-[10px] ml-2 normal-case tracking-normal">(stale · 19:30 KST 갱신)</span>}
          </h2>
          <p className="text-xs text-zinc-500 font-mono">{label} · {ago(e.generatedAt)} 전 생성</p>
        </div>
      </div>
      {stale && (
        <div className="mb-3 rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/80">
          오늘 19:30 KST에 새 이브닝 랩이 생성됩니다. 아래는 어제 회고 (참고용).
        </div>
      )}
      <p className="text-base text-zinc-100 font-medium mb-4">{e.wrap.headline}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <p className="text-xs uppercase text-emerald-400 mb-2">{winsLabel}</p>
          <ul className="space-y-1.5">
            {e.wrap.todayWins.map((w, i) => (
              <li key={i} className="text-sm text-zinc-200">· {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase text-amber-400 mb-2">… 미해결</p>
          <ul className="space-y-1.5">
            {e.wrap.unfinished.map((w, i) => (
              <li key={i} className="text-sm text-zinc-300">· {w}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase text-cyan-400 mb-2">→ {stale ? "오늘" : "내일"} 1순위</p>
          <ul className="space-y-1.5">
            {e.wrap.tomorrowFocus.map((w, i) => (
              <li key={i} className="text-sm text-zinc-200">· {w}</li>
            ))}
          </ul>
        </div>
      </div>
      {e.wrap.energyPrompt && (
        <div className="mt-4 pt-3 border-t border-zinc-800 text-sm italic text-zinc-400">
          💭 {e.wrap.energyPrompt}
        </div>
      )}
    </>
  );
}

function TomorrowView({ events, mail }: { events: CalEvent[]; mail: MailFile | null }) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400_000);
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const dow = ["일", "월", "화", "수", "목", "금", "토"][tomorrow.getDay()];

  const dayEvts = events
    .filter(e => e.start.startsWith(ymd))
    .sort((a, b) => a.start.localeCompare(b.start));
  const allDay = dayEvts.filter(e => e.allDay);
  const timed = dayEvts.filter(e => !e.allDay);

  const live = mail?.messages.filter(m => !m.trashed) || [];
  const unreadHigh = live.filter(m => m.unread && (m.priority === "high" || m.category === "action"));

  return (
    <>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl">📆</span>
        <div>
          <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">
            내일 ({tomorrow.getMonth() + 1}/{tomorrow.getDate()} {dow})
          </h2>
          <p className="text-xs text-zinc-500 font-mono">
            {dayEvts.length} events · {unreadHigh.length} pending high mails
          </p>
        </div>
      </div>

      {allDay.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase text-zinc-500 mb-1.5">all-day</p>
          <div className="flex flex-wrap gap-1.5">
            {allDay.map((e, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded bg-rose-900/40 text-rose-200 border border-rose-900/60">
                {e.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {timed.length === 0 && allDay.length === 0 && (
        <p className="text-sm text-zinc-500">일정 없음 — 자유로운 하루</p>
      )}

      {timed.length > 0 && (
        <ul className="space-y-1.5">
          {timed.map((e, i) => (
            <li key={i} className="flex items-baseline gap-3 text-sm py-1 border-t border-zinc-800/60 first:border-t-0">
              <span className="font-mono text-cyan-300 w-12 shrink-0">{e.start.split("T")[1]?.slice(0, 5)}</span>
              <span className="text-zinc-200 flex-1">{e.title}</span>
              <span className="text-[10px] text-zinc-600 font-mono shrink-0">{e.cal}</span>
            </li>
          ))}
        </ul>
      )}

      {unreadHigh.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <p className="text-xs uppercase text-amber-400 mb-2">⚑ 내일까지 답할 미답장</p>
          <ul className="space-y-1">
            {unreadHigh.slice(0, 4).map((m, i) => (
              <li key={i}>
                <a
                  href={`/mail?id=${encodeURIComponent(m.id)}`}
                  className="flex items-baseline gap-3 text-xs py-1 px-1 -mx-1 rounded hover:bg-zinc-800/40 transition cursor-pointer group"
                  title={m.aiSummary || m.subject}
                >
                  <span className="text-zinc-500 w-24 truncate shrink-0">{m.fromName}</span>
                  <span className="text-zinc-300 flex-1 truncate group-hover:text-sky-300">{m.aiSummary || m.subject}</span>
                  <span className="text-[10px] text-zinc-600 group-hover:text-sky-400 shrink-0">→</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function WeeklyView({ events, mail }: { events: CalEvent[]; mail: MailFile | null }) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const horizon = new Date(now.getTime() + 7 * 86400_000);

  const days: { date: string; label: string; events: CalEvent[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400_000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    const dayEvts = events.filter(e => e.start.startsWith(ymd)).sort((a, b) => a.start.localeCompare(b.start));
    days.push({
      date: ymd,
      label: i === 0 ? `오늘 (${dow})` : i === 1 ? `내일 (${dow})` : `${d.getMonth() + 1}/${d.getDate()} (${dow})`,
      events: dayEvts,
    });
  }

  const totalEvents = days.reduce((s, d) => s + d.events.length, 0);
  const live = mail?.messages.filter(m => !m.trashed) || [];
  const highCount = live.filter(m => m.priority === "high" || m.category === "action").length;
  const unreadHigh = live.filter(m => m.unread && (m.priority === "high" || m.category === "action")).length;

  return (
    <>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl">🗓</span>
        <div>
          <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">위클리 (다음 7일)</h2>
          <p className="text-xs text-zinc-500 font-mono">{totalEvents} events · {highCount} high mails ({unreadHigh} unread)</p>
        </div>
      </div>
      <ul className="space-y-2">
        {days.map(d => {
          const isToday = d.date === todayStr;
          return (
            <li key={d.date} className={`rounded-lg px-3 py-2 ${isToday ? "bg-sky-950/30 border border-sky-900/40" : "bg-zinc-900/40 border border-zinc-800/60"}`}>
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-sm font-medium ${isToday ? "text-sky-200" : "text-zinc-300"}`}>{d.label}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{d.events.length}건</span>
              </div>
              {d.events.length === 0 ? (
                <p className="text-xs text-zinc-600">—</p>
              ) : (
                <ul className="space-y-0.5">
                  {d.events.slice(0, 5).map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-xs">
                      <span className="font-mono text-zinc-500 w-10 shrink-0">
                        {e.allDay ? "all" : e.start.split("T")[1]?.slice(0, 5)}
                      </span>
                      <span className="text-zinc-300 truncate">{e.title}</span>
                    </li>
                  ))}
                  {d.events.length > 5 && (
                    <li className="text-[10px] text-zinc-500 pl-12">+{d.events.length - 5} more</li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StalePlaceholder({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="text-center py-8 text-zinc-500">
      <p className="text-sm">{label} 데이터 없음</p>
      <p className="text-xs mt-1">{reason}</p>
    </div>
  );
}

function Stat({ label, value, accent, alert }: { label: string; value: string; accent?: boolean; alert?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${alert ? "border-rose-900/60 bg-rose-950/20" : "border-zinc-800 bg-zinc-900/40"}`}>
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${accent ? "text-cyan-300" : alert ? "text-rose-300" : "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

const KIND_META: Record<string, { emoji: string; label: string; color: string }> = {
  meeting: { emoji: "📅", label: "meeting", color: "text-cyan-300" },
  mail: { emoji: "📧", label: "mail", color: "text-amber-300" },
  people: { emoji: "👥", label: "people", color: "text-violet-300" },
  task: { emoji: "✅", label: "task", color: "text-emerald-300" },
};
