"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Msg = {
  id: string;
  ts: number;
  date: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  snippet: string;
  aiSummary: string | null;
  unread: boolean;
  priority: string | null;
  category: string | null;
  trashed?: boolean;
};
type MailFile = { messages: Msg[] };

type Vip = {
  keywords: string[];
  senderDomains: string[];
  vipPeople: string[];
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function VipMailsCard() {
  const [data, setData] = useState<MailFile | null>(null);
  const [vip, setVip] = useState<Vip | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
    fetch("/vip-mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setVip)
      .catch(() => {});
  }, []);

  const matched = useMemo(() => {
    if (!data || !vip) return [];
    const out: { msg: Msg; reasons: string[] }[] = [];
    for (const m of data.messages) {
      if (m.trashed) continue;
      const reasons: string[] = [];
      const hay = `${m.subject} ${m.snippet} ${m.aiSummary || ""}`.toLowerCase();
      const fromAddr = (m.fromAddr || "").toLowerCase();
      const fromName = m.fromName || "";

      for (const kw of vip.keywords) {
        if (hay.includes(kw.toLowerCase())) reasons.push(kw);
      }
      for (const dom of vip.senderDomains) {
        if (fromAddr.endsWith("@" + dom.toLowerCase()) || fromAddr.includes("." + dom.toLowerCase())) {
          reasons.push("@" + dom);
          break;
        }
      }
      for (const p of vip.vipPeople) {
        if (fromName.includes(p)) reasons.push(p);
      }
      if (reasons.length > 0) out.push({ msg: m, reasons });
    }
    out.sort((a, b) => b.msg.ts - a.msg.ts);
    return out;
  }, [data, vip]);

  if (matched.length === 0) return null;

  const top = matched.slice(0, 6);
  const rest = matched.length - top.length;

  return (
    <section className="rounded-xl border border-yellow-700/50 bg-gradient-to-br from-yellow-950/30 via-zinc-900/30 to-zinc-950/30 p-4 mb-5">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-baseline gap-2 mb-2"
      >
        <span className="text-base">⭐</span>
        <h2 className="text-sm font-semibold text-yellow-200 uppercase tracking-wider">
          VIP 메일 {collapsed ? "▸" : "▾"}
        </h2>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono">
          {matched.length}건 매칭 · 최근 {top.length}건 표시
        </span>
      </button>

      {!collapsed && (
        <ul className="space-y-1">
          {top.map(({ msg: m, reasons }) => (
            <li key={m.id}>
              <Link
                href={`/mail?id=${encodeURIComponent(m.id)}`}
                className="flex items-baseline gap-3 text-sm py-1.5 px-2 -mx-2 rounded hover:bg-zinc-800/40 transition cursor-pointer"
              >
                {m.unread && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0 mt-1.5" />
                )}
                {!m.unread && <span className="w-1.5 h-1.5 shrink-0 mt-1.5" />}
                <span className="text-zinc-400 text-xs w-28 truncate shrink-0">
                  {m.fromName || m.fromAddr.split("@")[0]}
                </span>
                <span
                  className={`flex-1 truncate ${m.unread ? "text-zinc-100 font-medium" : "text-zinc-300"}`}
                  title={reasons.join(" · ")}
                >
                  {m.aiSummary || m.subject}
                </span>
                <span className="text-[9px] uppercase text-yellow-400 font-mono shrink-0 truncate max-w-[140px]">
                  {reasons.slice(0, 2).join(" · ")}
                </span>
                <span className="text-xs text-zinc-600 shrink-0">{ago(m.ts)} 전</span>
              </Link>
            </li>
          ))}
          {rest > 0 && (
            <li className="px-2 pt-2 text-[10px] text-zinc-500">
              + {rest}건 더 — /mail 에서 필터링
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
