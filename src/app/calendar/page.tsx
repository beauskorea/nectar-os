"use client";
import { useEffect, useState } from "react";
import MonthView from "./MonthView";
import CalendarQuickAdd from "@/components/CalendarQuickAdd";
import MeetingBreakdown from "@/components/MeetingBreakdown";
import { CalEvent } from "@/lib/calendars";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/calendar/events", { cache: "default" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (Array.isArray(d?.events)) {
            setEvents(d.events as CalEvent[]);
            setUpdatedAt(typeof d.updatedAt === "number" ? d.updatedAt : null);
            setErr(null);
          } else {
            setErr("events.json schema invalid");
          }
        })
        .catch((e) => alive && setErr(String(e?.message || e)));
    };
    load();
    const t = setInterval(load, 5 * 60_000); // 5분 폴링 (gzip + SWR 캐시 60s)
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

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
        <p className="text-xs uppercase tracking-widest text-zinc-500">calendar</p>
        <h1 className="text-2xl font-semibold mt-1">캘린더</h1>
        <p className="text-zinc-500 text-xs mt-1">
          Google Calendar ·{" "}
          {updatedLabel ? (
            <>실시간 동기화 · 마지막 갱신 {updatedLabel} KST · {events.length} events</>
          ) : err ? (
            <span className="text-amber-400">fetch 실패: {err}</span>
          ) : (
            <>로딩 중…</>
          )}
        </p>
      </header>
      <CalendarQuickAdd />
      <MonthView events={events} />
      <MeetingBreakdown events={events} />
    </div>
  );
}
