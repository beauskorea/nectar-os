"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Msg = {
  id: string;
  ts: number;
  fromName: string;
  fromAddr: string;
  subject: string;
  aiSummary: string | null;
  priority: "high" | "med" | "low" | null;
  category: "action" | "info" | "noise" | null;
};

type MailFile = { messages: Msg[] };

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function ActionStrip() {
  const [data, setData] = useState<MailFile | null>(null);

  useEffect(() => {
    fetch("/mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return null;
  const high = data.messages.filter(
    (m) => m.priority === "high" || m.category === "action",
  );
  if (high.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-rose-900/60 bg-gradient-to-br from-rose-950/30 to-zinc-950/30 p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-rose-400">🚨</span>
        <h2 className="text-sm font-semibold text-rose-200 uppercase tracking-wider">
          오늘 처리할 메일 {high.length}건
        </h2>
        <Link href="/mail" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">
          전체 →
        </Link>
      </div>
      <ul className="space-y-1">
        {high.slice(0, 5).map((m) => (
          <li key={m.id}>
            <Link
              href={`/mail?id=${encodeURIComponent(m.id)}`}
              className="flex items-baseline gap-3 text-sm py-1.5 px-2 -mx-2 rounded hover:bg-zinc-800/40 transition cursor-pointer"
            >
              <span
                className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded shrink-0 ${
                  m.priority === "high"
                    ? "bg-rose-900/40 text-rose-300 border-rose-900/60"
                    : "bg-amber-900/40 text-amber-300 border-amber-900/60"
                }`}
              >
                {m.priority === "high" ? "high" : "action"}
              </span>
              <span className="text-zinc-400 text-xs w-24 truncate shrink-0">
                {m.fromName || m.fromAddr.split("@")[0]}
              </span>
              <span className="text-zinc-100 flex-1 truncate">
                {m.aiSummary || m.subject}
              </span>
              <span className="text-xs text-zinc-600 shrink-0">{ago(m.ts)} 전</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
