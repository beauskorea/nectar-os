"use client";
import { useState } from "react";

type Status = "todo" | "doing" | "done";
type Board = "company" | "personal";

type Result = {
  text: string;
  priority: "high" | "med" | "low";
  ok: boolean;
  id?: string;
  error?: string;
};

const STATUS_BUCKETS: Array<{ key: Status; label: string; color: string }> = [
  { key: "todo", label: "To Do", color: "bg-zinc-700/60 border-zinc-500 text-zinc-100" },
  { key: "doing", label: "Doing", color: "bg-sky-700/60 border-sky-500 text-sky-50" },
];

const PRI_BADGE: Record<string, string> = {
  high: "bg-rose-700/60 text-rose-50 border-rose-500/60",
  med: "bg-zinc-700/60 text-zinc-200 border-zinc-600",
  low: "bg-emerald-700/60 text-emerald-50 border-emerald-500/60",
};

export default function TodosQuickAdd({
  onAdded,
  board = "company",
}: {
  onAdded?: () => void;
  board?: Board;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    | { kind: "ok" | "warn" | "err"; text: string; results?: Result[] }
    | null
  >(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/tasks/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, status, board }),
      });
      const data = (await r.json()) as {
        todos?: Result[];
        count?: number;
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!r.ok || !data.todos?.length) {
        setMsg({
          kind: "err",
          text: `❌ ${data.error || "파싱 실패"}${data.detail ? ` — ${data.detail}` : ""}`,
        });
        return;
      }
      const okList = data.todos.filter((t) => t.ok);
      const failList = data.todos.filter((t) => !t.ok);
      if (okList.length > 0 && failList.length === 0) {
        setMsg({
          kind: "ok",
          text: `✅ Google Tasks에 ${okList.length}개 추가됨`,
          results: data.todos,
        });
      } else if (okList.length === 0) {
        setMsg({
          kind: "err",
          text: `❌ Google Tasks 추가 실패 — ${failList[0]?.error || "?"}`,
        });
      } else {
        setMsg({
          kind: "warn",
          text: `⚠️ ${okList.length}개 추가 / ${failList.length}개 실패`,
          results: data.todos,
        });
      }
      setText("");
      onAdded?.();
    } catch (err) {
      setMsg({ kind: "err", text: `❌ ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-violet-400">✨</span>
        <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden shrink-0">
          {STATUS_BUCKETS.map((b) => {
            const on = status === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setStatus(b.key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium transition border-r border-zinc-800 last:border-r-0 ${
                  on ? b.color : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
                }`}
                title={`Google Tasks 리스트: ${board === "personal" ? "개인" : "회사"} · ${b.label}`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="자연어로 할일 추가 — 예: 내일까지 보고서 마치고, 그 다음에 담당자에게 자료 보내기"
          disabled={busy}
          className="flex-1 min-w-[300px] bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "처리 중..." : "AI 추가"}
        </button>
      </div>
      {msg && (
        <div
          className={`text-xs mt-2 font-mono ${
            msg.kind === "ok"
              ? "text-emerald-400"
              : msg.kind === "warn"
                ? "text-amber-400"
                : "text-rose-400"
          }`}
        >
          <div>{msg.text}</div>
          {msg.results && msg.results.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {msg.results.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span
                    className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${PRI_BADGE[r.priority]}`}
                  >
                    {r.priority}
                  </span>
                  <span className={r.ok ? "text-zinc-300" : "text-rose-400"}>
                    {r.ok ? "✓" : "✗"} {r.text}
                  </span>
                  {r.error && <span className="text-zinc-600">— {r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
