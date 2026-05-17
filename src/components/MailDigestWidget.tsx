"use client";
import { useEffect, useState } from "react";

type Category =
  | "sales"
  | "client"
  | "finance"
  | "urgent"
  | "event"
  | "lecture"
  | "news"
  | "noise"
  | "action"
  | "info";

type Msg = {
  id: string;
  ts: number;
  fromName: string;
  fromAddr: string;
  subject: string;
  unread: boolean;
  priority?: "high" | "med" | "low" | null;
  category?: Category | null;
  aiSummary?: string | null;
  trashed?: boolean;
};

type MailFile = { count: number; messages: Msg[] };

const CATEGORY_META: Record<string, { label: string; emoji: string; badge: string }> = {
  sales:   { label: "영업",   emoji: "🤝", badge: "border-indigo-900/60 bg-indigo-900/40 text-indigo-300" },
  client:  { label: "클라",   emoji: "💼", badge: "border-emerald-900/60 bg-emerald-900/40 text-emerald-300" },
  finance: { label: "정산",   emoji: "💰", badge: "border-amber-900/60 bg-amber-900/40 text-amber-300" },
  urgent:  { label: "긴급",   emoji: "🚨", badge: "border-rose-900/60 bg-rose-900/40 text-rose-300" },
  event:   { label: "행사",   emoji: "🎤", badge: "border-violet-900/60 bg-violet-900/40 text-violet-300" },
  lecture: { label: "강의",   emoji: "🎓", badge: "border-teal-900/60 bg-teal-900/40 text-teal-300" },
  news:    { label: "정보",   emoji: "📰", badge: "border-sky-900/60 bg-sky-900/40 text-sky-300" },
  noise:   { label: "노이즈", emoji: "🗑", badge: "border-zinc-800 bg-zinc-800/60 text-zinc-500" },
  action:  { label: "처리",   emoji: "⚑", badge: "border-rose-900/60 bg-rose-900/40 text-rose-300" },
  info:    { label: "참고",   emoji: "ℹ", badge: "border-sky-900/60 bg-sky-900/40 text-sky-300" },
};

// 처리 강도: 즉시 대응이 필요한 카테고리
const ACTIONABLE = new Set<Category>(["sales", "client", "finance", "urgent", "lecture", "action"]);

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function MailDigestWidget() {
  const [data, setData] = useState<MailFile | null>(null);
  useEffect(() => {
    fetch("/mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ count: 0, messages: [] }));
  }, []);

  if (!data) return <div className="text-sm text-zinc-500">로딩...</div>;

  // 중요도 점수: urgent>finance>sales>client>event (정보/노이즈는 0)
  const catScore = (c?: Category | null) => {
    switch (c) {
      case "urgent": return 5;
      case "lecture": return 3.5; // 강의 초빙은 본인 관심사
      case "finance": return 3;
      case "sales": return 2.5;
      case "client": return 2;
      case "event": return 1;
      case "action": return 2; // 레거시
      default: return 0;
    }
  };
  const score = (m: Msg) =>
    catScore(m.category) +
    (m.priority === "high" ? 2 : 0) +
    (m.priority === "med" ? 1 : 0) +
    (m.unread ? 0.5 : 0);

  const live = data.messages.filter((m) => !m.trashed);
  const actionCount = live.filter((m) => m.category && ACTIONABLE.has(m.category)).length;
  const unreadCount = live.filter((m) => m.unread).length;

  const ranked = [...live]
    .filter((m) => score(m) > 0)
    .sort((a, b) => score(b) - score(a) || b.ts - a.ts);
  const show = (ranked.length ? ranked : live.slice().sort((a, b) => b.ts - a.ts)).slice(0, 7);

  return (
    <>
      <div className="flex items-center gap-3 mb-2 text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
        <span className="text-rose-400">⚑ 처리 {actionCount}</span>
        <span>안 읽음 {unreadCount}</span>
        <span className="text-zinc-600">90일 {data.count}</span>
      </div>
      <ul className="space-y-1.5">
      {show.map((m) => {
        const meta = m.category ? CATEGORY_META[m.category] : null;
        const isActionable = m.category ? ACTIONABLE.has(m.category) : false;
        const isHigh = m.priority === "high";
        const dotCls =
          m.category === "urgent" ? "bg-rose-400"
          : m.category === "lecture" ? "bg-teal-400"
          : m.category === "finance" ? "bg-amber-400"
          : m.category === "sales" ? "bg-indigo-400"
          : m.category === "client" ? "bg-emerald-400"
          : m.category === "event" ? "bg-violet-400"
          : m.category === "news" ? "bg-sky-400"
          : m.unread ? "bg-sky-400"
          : "bg-zinc-600";
        return (
          <li key={m.id}>
            <a
              href={`/mail?id=${encodeURIComponent(m.id)}`}
              className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-zinc-800/50 transition"
            >
              <div className="flex items-baseline gap-2 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotCls}`} />
                <span className="text-zinc-500 text-xs w-20 truncate shrink-0">
                  {m.fromName || m.fromAddr.split("@")[0]}
                </span>
                {meta && (
                  <span className={`text-[9px] uppercase tracking-wider border px-1 rounded shrink-0 ${meta.badge}`}>
                    {meta.emoji} {meta.label}
                  </span>
                )}
                <span
                  className={`flex-1 truncate ${
                    isHigh || isActionable
                      ? "text-zinc-100 font-medium"
                      : m.unread
                        ? "text-zinc-100"
                        : "text-zinc-400"
                  }`}
                >
                  {m.subject || "(제목 없음)"}
                </span>
                <span className="text-[10px] text-zinc-600 shrink-0">{ago(m.ts)}</span>
              </div>
              {m.aiSummary && (
                <div className="mt-0.5 ml-[26px] text-[11px] text-zinc-500 truncate">
                  {m.aiSummary}
                </div>
              )}
            </a>
          </li>
        );
      })}
      {show.length === 0 && (
        <li className="text-sm text-zinc-500">처리할 메일 없음 ✓</li>
      )}
    </ul>
    </>
  );
}
