"use client";
import { useEffect, useState } from "react";

type Category = "action" | "idea" | "reference" | "snooze";
type Priority = "P0" | "P1" | "P2" | "P3";
type Item = { id: string; ts: number; text: string; category: Category; priority: Priority };

const INBOX_KEY = "jinho-os:inbox:v1";
const PRI_COLOR: Record<Priority, string> = {
  P0: "text-rose-400",
  P1: "text-amber-400",
  P2: "text-zinc-500",
  P3: "text-zinc-600",
};

function relTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function InboxRecentCard() {
  const [items, setItems] = useState<Item[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INBOX_KEY);
      if (raw) setItems(JSON.parse(raw) as Item[]);
    } catch {}
    setMounted(true);

    // 같은 탭에서 /inbox 갱신 시 반영하기 위해 storage event + focus 시 reload
    const reload = () => {
      try {
        const raw = localStorage.getItem(INBOX_KEY);
        setItems(raw ? (JSON.parse(raw) as Item[]) : []);
      } catch {}
    };
    window.addEventListener("focus", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  // priority 우선 정렬, 최신 우선
  const sorted = [...items].sort((a, b) => {
    const pr: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    if (a.priority !== b.priority) return pr[a.priority] - pr[b.priority];
    return b.ts - a.ts;
  });
  const top = sorted.slice(0, 3);
  const total = items.length;

  return (
    <a
      href="/inbox"
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-600 transition"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">📥 인박스 / 회고</h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          {mounted ? `${total} captured` : "…"}
        </span>
      </div>
      {!mounted ? (
        <p className="text-sm text-zinc-600">로딩…</p>
      ) : top.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">캡처된 항목 없음 — /inbox 에서 시작</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {top.map((it) => (
            <li key={it.id} className="flex items-baseline gap-2">
              <span className={`text-[10px] font-mono font-bold w-7 shrink-0 ${PRI_COLOR[it.priority]}`}>
                {it.priority}
              </span>
              <span className="text-[10px] text-zinc-600 w-14 shrink-0">{relTime(it.ts)}</span>
              <span className="text-zinc-300 flex-1 truncate">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-zinc-600 mt-3 pt-2 border-t border-zinc-800">
        저녁 회고: <span className="text-zinc-500">진전 / 내일 1순위 / 에너지</span> · /journal
      </p>
    </a>
  );
}
