"use client";
import { useEffect, useState } from "react";
import MonthView from "./MonthView";
import CalendarQuickAdd from "@/components/CalendarQuickAdd";
import MeetingBreakdown from "@/components/MeetingBreakdown";
import { CalEvent } from "@/lib/calendars";

type CalendarMode = "mine" | "company";

type CalendarClientProps = {
  mode: CalendarMode;
};

const COPY: Record<CalendarMode, { eyebrow: string; title: string; source: string; scope: string }> = {
  mine: {
    eyebrow: "calendar · mine",
    title: "👤 대표 캘린더",
    source: "Jinho Park + Quick + 공휴일",
    scope: "mine",
  },
  company: {
    eyebrow: "calendar · company",
    title: "🏢 회사 캘린더",
    source: "beaus company + 콘텐츠 + 매니지먼트팀 + 손주희 라인",
    scope: "team",
  },
};

export default function CalendarClient({ mode }: CalendarClientProps) {
  const copy = COPY[mode];
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/calendar/events?scope=${copy.scope}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (Array.isArray(d?.events)) {
            setEvents(d.events as CalEvent[]);
            setUpdatedAt(typeof d.updatedAt === "number" && d.updatedAt > 0 ? d.updatedAt : null);
            setErr(null);
          } else {
            setErr("events.json schema invalid");
          }
          setLoaded(true);
        })
        .catch((e) => {
          if (!alive) return;
          setErr(String(e?.message || e));
          setLoaded(true);
        });
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [copy.scope]);

  const updatedLabel =
    updatedAt &&
    new Date(updatedAt * 1000).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500">{copy.eyebrow}</p>
        <h1 className="text-2xl font-semibold mt-1">{copy.title}</h1>
        <p className="text-zinc-500 text-xs mt-1">
          Google Calendar · {copy.source} ·{" "}
          {err ? (
            <span className="text-amber-400">fetch 실패: {err}</span>
          ) : loaded ? (
            <>
              {updatedLabel ? `마지막 갱신 ${updatedLabel} KST · ` : ""}
              {events.length} events
            </>
          ) : (
            <>로딩 중…</>
          )}
        </p>
      </header>
      {mode === "mine" && <CalendarQuickAdd />}
      <MonthView events={events} />
      <MeetingBreakdown events={events} />
    </div>
  );
}
