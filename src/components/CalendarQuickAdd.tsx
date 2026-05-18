"use client";
import { useState } from "react";

const EVENT_KEY = "jinho-quick-events-v1";

type Bucket = "beautysketch" | "beauscontents";

const BUCKETS: Array<{ key: Bucket; label: string; dot: string; active: string }> = [
  {
    key: "beautysketch",
    label: "뷰티스케치",
    dot: "bg-amber-400",
    active: "bg-amber-700/60 border-amber-500 text-amber-50",
  },
  {
    key: "beauscontents",
    label: "콘텐츠",
    dot: "bg-cyan-400",
    active: "bg-cyan-700/60 border-cyan-500 text-cyan-50",
  },
];

type EventResult = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
  synced?: boolean;
  deleted?: boolean;
  google_id?: string;
  error?: string;
};

type ApiResponse = {
  intent?: "add" | "delete";
  cal?: string;
  events?: EventResult[];
  ok?: boolean;
  error?: string;
  detail?: string;
};

type StoredEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};

function fmtPreview(e: EventResult): string {
  if (e.allDay) return `${e.start} (종일) ${e.title}`;
  const d = new Date(e.start);
  if (Number.isNaN(d.getTime())) return `${e.start} ${e.title}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${md} ${hm} ${e.title}`;
}

export default function CalendarQuickAdd() {
  const [text, setText] = useState("");
  const [bucket, setBucket] = useState<Bucket>("beautysketch");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/calendar/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, cal: bucket }),
      });
      const data = (await r.json()) as ApiResponse;
      if (!r.ok || !data.events?.length) {
        setMsg({ kind: "err", text: `❌ ${data.error || "파싱 실패"}${data.detail ? ` — ${data.detail}` : ""}` });
        return;
      }
      const events = data.events;
      const intent = data.intent || "add";

      if (intent === "delete") {
        const okList = events.filter((e) => e.deleted);
        const failList = events.filter((e) => !e.deleted);
        if (okList.length > 0 && failList.length === 0) {
          setMsg({
            kind: "ok",
            text: `🗑️ ${okList.length}개 삭제됨 — 화면 반영 최대 1분 (${okList.map(fmtPreview).join(" / ")})`,
          });
        } else if (okList.length === 0) {
          setMsg({
            kind: "err",
            text: `❌ 삭제 실패 — ${failList.map((e) => e.error || "?").join(" / ")}`,
          });
        } else {
          setMsg({
            kind: "warn",
            text: `⚠️ ${okList.length}개 삭제 / ${failList.length}개 실패 — ${failList.map((e) => e.error || "?").join(" / ")}`,
          });
        }
        // also drop from localStorage if google_id matches
        try {
          const existing: StoredEvent[] = JSON.parse(localStorage.getItem(EVENT_KEY) || "[]");
          const gids = new Set(okList.map((e) => e.google_id).filter(Boolean));
          if (gids.size > 0) {
            const next = existing.filter((s) => !gids.has((s as StoredEvent & { google_id?: string }).google_id || ""));
            if (next.length !== existing.length) {
              localStorage.setItem(EVENT_KEY, JSON.stringify(next));
              window.dispatchEvent(new Event("jinho-quick-events-changed"));
            }
          }
        } catch {}
        setText("");
        return;
      }

      // intent === "add"
      const synced = events.filter((e) => e.synced);
      const failed = events.filter((e) => !e.synced);

      if (synced.length > 0 && failed.length === 0) {
        setMsg({
          kind: "ok",
          text: `✅ Google ${bucket === "beautysketch" ? "뷰티스케치" : "콘텐츠"} 캘린더에 ${synced.length}개 추가 — 화면 반영 최대 1분 (${synced.map(fmtPreview).join(" / ")})`,
        });
      } else if (synced.length === 0) {
        // fallback to localStorage so the user at least sees it
        const enriched: StoredEvent[] = events.map((ev) => ({
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
          cal: bucket,
        }));
        const existing: StoredEvent[] = (() => {
          try {
            return JSON.parse(localStorage.getItem(EVENT_KEY) || "[]");
          } catch {
            return [];
          }
        })();
        localStorage.setItem(EVENT_KEY, JSON.stringify([...existing, ...enriched]));
        window.dispatchEvent(new Event("jinho-quick-events-changed"));
        setMsg({
          kind: "warn",
          text: `⚠️ Google 동기화 실패 → 로컬에만 저장: ${failed[0]?.error || "?"}`,
        });
      } else {
        setMsg({
          kind: "warn",
          text: `⚠️ ${synced.length}개 Google 추가 / ${failed.length}개 실패: ${failed[0]?.error || "?"}`,
        });
      }
      setText("");
    } catch (err) {
      setMsg({ kind: "err", text: `❌ ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="flex gap-2 items-center">
        <span className="text-violet-400">✨</span>
        <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden shrink-0">
          {BUCKETS.map((b) => {
            const on = bucket === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setBucket(b.key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium transition border-r border-zinc-800 last:border-r-0 ${
                  on ? b.active : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
                }`}
                title={`Google ${b.label} 캘린더(${b.key})로 추가/삭제`}
              >
                <span className={`w-2 h-2 rounded-sm ${b.dot}`} />
                {b.label}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="자연어로 추가/삭제 — 예: 내일 오후 3시 김태원 미팅 / 내일 오후 2시 스케줄 삭제"
          disabled={busy}
          className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "처리 중..." : "AI 실행"}
        </button>
      </div>
      {msg && (
        <p
          className={`text-xs mt-1.5 font-mono ${
            msg.kind === "ok"
              ? "text-emerald-400"
              : msg.kind === "warn"
                ? "text-amber-400"
                : "text-rose-400"
          }`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
