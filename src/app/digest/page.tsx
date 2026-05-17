"use client";
import { useEffect, useMemo, useState } from "react";

type Msg = {
  id: string;
  ts: number;
  date: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  aiSummary?: string | null;
  aiInsight?: string | null;
  category?: string | null;
  unread: boolean;
  trashed?: boolean;
};

type MailFile = { count: number; updatedAt: number; messages: Msg[] };

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

export default function DigestPage() {
  const [data, setData] = useState<MailFile | null>(null);
  const [days, setDays] = useState(7);
  const [digest, setDigest] = useState<string | null>(null);
  const [digestMeta, setDigestMeta] = useState<{ model?: string; sourceCount?: number; elapsedMs?: number } | null>(null);
  const [digestErr, setDigestErr] = useState<string | null>(null);
  const [synthBusy, setSynthBusy] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);

  useEffect(() => {
    fetch("/mail.json", { cache: "no-store" }).then(r => r.json()).then(setData);
  }, []);

  const newsletters = useMemo(() => {
    if (!data) return [];
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    return data.messages
      .filter(m => m.category === "news" && !m.trashed && m.ts >= cutoff)
      .sort((a, b) => b.ts - a.ts);
  }, [data, days]);

  const unreadCount = newsletters.filter(m => m.unread).length;

  async function synthesize() {
    setSynthBusy(true); setDigest(null); setDigestErr(null);
    try {
      const r = await fetch("/api/digest/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setDigestErr(j.error || `error ${r.status}`);
      } else {
        setDigest(j.digest);
        setDigestMeta({ model: j.model, sourceCount: j.sourceCount, elapsedMs: j.elapsedMs });
      }
    } catch (e) {
      setDigestErr(String(e));
    } finally {
      setSynthBusy(false);
    }
  }

  async function markAllRead() {
    const unreadIds = newsletters.filter(m => m.unread).map(m => m.id);
    if (unreadIds.length === 0) return;
    if (!confirm(`${unreadIds.length}건의 뉴스레터를 모두 읽음 처리할까요?\n(Naver Works IMAP에서도 \\Seen 플래그 적용)`)) return;
    setMarkBusy(true);
    try {
      let ok = 0;
      for (const id of unreadIds) {
        try {
          const r = await fetch("/api/mail/mark-read", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ messageId: id }),
          });
          if (r.ok) ok++;
        } catch {}
      }
      // 새로고침
      const r2 = await fetch("/mail.json", { cache: "no-store" });
      setData(await r2.json());
      alert(`${ok}건 읽음 처리 완료`);
    } finally {
      setMarkBusy(false);
    }
  }

  async function bulkTrash() {
    if (newsletters.length === 0) return;
    if (!confirm(`최근 ${days}일 뉴스레터 ${newsletters.length}건을 모두 휴지통으로 보낼까요?\n(Naver Works IMAP 실제 이동)`)) return;
    setMarkBusy(true);
    try {
      const r = await fetch("/api/mail/triage-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageIds: newsletters.map(m => m.id), action: "trash" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        alert(`실패: ${j.error || r.status}`);
      } else {
        const r2 = await fetch("/mail.json", { cache: "no-store" });
        setData(await r2.json());
        alert(`${j.processed?.length || 0}건 휴지통 이동 완료`);
      }
    } finally {
      setMarkBusy(false);
    }
  }

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">digest · 뉴스레터 종합 분석</p>
        <h1 className="text-2xl font-semibold mt-1">📊 뉴스 다이제스트</h1>
        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
          📰 정보 카테고리 뉴스레터를 한 번에 종합 분석. 메일함을 비우면서 핵심 트렌드만 흡수.
        </p>
      </header>

      {/* 컨트롤 */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500">기간:</span>
          {[3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-[11px] px-2.5 py-1 rounded transition ${
                days === d ? "bg-zinc-100 text-zinc-900 font-semibold" : "bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 border border-zinc-800"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          📰 {newsletters.length}건 · 안 읽음 {unreadCount}건
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={synthesize}
            disabled={synthBusy || newsletters.length === 0}
            className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition font-semibold"
          >
            {synthBusy ? "분석 중..." : "🤖 종합 분석"}
          </button>
          <button
            onClick={markAllRead}
            disabled={markBusy || unreadCount === 0}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50 transition"
          >
            ✓ 모두 읽음 ({unreadCount})
          </button>
          <button
            onClick={bulkTrash}
            disabled={markBusy || newsletters.length === 0}
            className="text-xs px-3 py-1.5 rounded bg-rose-900/60 hover:bg-rose-800 text-rose-100 disabled:opacity-50 transition"
            title="기간 내 모든 뉴스레터를 IMAP 휴지통으로"
          >
            🗑 모두 휴지통 ({newsletters.length})
          </button>
        </div>
      </div>

      {/* 종합 분석 결과 */}
      {(digest || digestErr || synthBusy) && (
        <section className="mb-6 rounded-xl border border-indigo-900/60 bg-indigo-950/30 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs uppercase tracking-wider text-indigo-300">🔮 AI 종합 분석</span>
            {digestMeta && (
              <span className="text-[10px] text-zinc-500 font-mono">
                {digestMeta.model} · {digestMeta.sourceCount}건 입력 · {((digestMeta.elapsedMs || 0) / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          {synthBusy && !digest && <p className="text-sm text-zinc-400 italic">AI가 {newsletters.length}건 분석 중...</p>}
          {digestErr && <p className="text-sm text-rose-300">에러: {digestErr}</p>}
          {digest && (
            <div className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
              {digest}
            </div>
          )}
        </section>
      )}

      {/* 뉴스레터 리스트 */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800 max-h-[60vh] overflow-y-auto">
        {!data && <div className="p-6 text-sm text-zinc-500">로딩...</div>}
        {data && newsletters.length === 0 && (
          <div className="p-6 text-sm text-zinc-500">최근 {days}일 뉴스레터 없음</div>
        )}
        {newsletters.map(m => (
          <a
            key={m.id}
            href={`/mail?id=${encodeURIComponent(m.id)}`}
            className="block px-4 py-3 hover:bg-zinc-800/40 transition"
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.unread ? "bg-sky-400" : "bg-transparent"}`} />
              <span className={`text-sm w-32 truncate ${m.unread ? "text-zinc-100 font-medium" : "text-zinc-400"}`}>
                {m.fromName || m.fromAddr.split("@")[0]}
              </span>
              <span className={`flex-1 truncate text-sm ${m.unread ? "text-zinc-100" : "text-zinc-400"}`}>
                {m.subject || "(제목 없음)"}
              </span>
              <span className="text-xs text-zinc-600 shrink-0 tabular-nums">{ago(m.ts)} 전</span>
            </div>
            {m.aiInsight && (
              <div className="mt-1.5 ml-7 text-[12px] text-zinc-400 whitespace-pre-wrap leading-relaxed">
                {m.aiInsight}
              </div>
            )}
            {!m.aiInsight && m.aiSummary && (
              <div className="mt-1 ml-7 text-xs text-zinc-500 truncate">
                {m.aiSummary}
              </div>
            )}
          </a>
        ))}
      </section>

      <p className="mt-6 text-xs text-zinc-600 font-mono">
        Source: 📰 news 카테고리 메일 · 각 메일의 aiInsight (Gemini 2.5 Flash, 별도 cron)는 자동 생성됨
      </p>
    </div>
  );
}
