"use client";
import { useState } from "react";

export default function MailChatPanel({
  date,
  onDecisionSaved,
}: {
  date: string;
  onDecisionSaved?: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);

  async function submit() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setErr(null);
    setLastReply(null);
    try {
      const r = await fetch("/api/mail/insights/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, date, history: [] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      // 결정사항으로 자동 이관
      await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          question: msg,
          text: j.reply,
          source: "chat",
        }),
      });
      setLastReply(j.reply);
      setInput("");
      onDecisionSaved?.();
      // 5초 뒤 응답 자동 hide
      setTimeout(() => setLastReply(null), 5000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-indigo-900/40 bg-gradient-to-br from-indigo-950/30 to-zinc-900/30 p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-semibold text-indigo-200">💬 CEO 결정 입력</h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          {date} 컨텍스트 · Sonnet/Gemini · ↑ 결정사항 카드에 자동 이관
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="결정/지시 한 줄 (예: 로켓펀치 거절 / 클리오 제안 참여 / 퓨젠 6/6 갱신 검토)"
          disabled={busy}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium transition"
        >
          {busy ? "처리..." : "기록"}
        </button>
      </form>

      {lastReply && (
        <div className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
          ✓ 결정사항에 기록됨 — 위쪽 카드에서 확인 (5초 후 사라짐)
        </div>
      )}
      {err && (
        <div className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-300">
          ⚠️ {err}
        </div>
      )}
    </section>
  );
}
