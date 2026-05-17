"use client";
import { useEffect, useState } from "react";

type Decision = {
  id: string;
  ts: number;
  date: string;
  question: string;
  text: string;
  source: string;
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  return `${Math.floor(s / 86400)}일`;
}

type Parsed = {
  summary: string | null;        // ✓ 한줄
  draft: string | null;          // 📧 회신 초안
  actions: { kind: string; text: string }[]; // /todos /people /money /메모
  record: string | null;         // 📌 기록
  rest: string | null;           // 그 외
};

function parseDecisionText(text: string): Parsed {
  const lines = text.split("\n");
  let summary: string | null = null;
  let draft: string | null = null;
  let record: string | null = null;
  const actions: { kind: string; text: string }[] = [];

  let mode: "draft" | "actions" | "record" | "rest" | null = null;
  const draftBuf: string[] = [];
  const restBuf: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (mode === "draft") {
        // empty inside draft is OK if draftBuf already has content but no other section started
        draftBuf.push("");
      }
      continue;
    }
    if (line.startsWith("✓") && !summary) {
      summary = line.replace(/^✓\s*/, "");
      mode = null;
      continue;
    }
    if (line.startsWith("📧")) {
      mode = "draft";
      continue;
    }
    if (line.startsWith("📝")) {
      mode = "actions";
      continue;
    }
    if (line.startsWith("📌")) {
      mode = "record";
      const rest = line.replace(/^📌\s*기록:?\s*/, "").trim();
      if (rest) record = rest;
      continue;
    }
    if (mode === "draft") {
      draftBuf.push(line);
    } else if (mode === "actions") {
      // pattern: "- /todos: 내용" or "- /people: 내용" or "- 메모: 내용"
      const m = line.match(/^[-•·]?\s*(\/?[\w가-힣]+):\s*(.+)$/);
      if (m) {
        actions.push({ kind: m[1].replace(/^\//, ""), text: m[2].trim() });
      } else if (line.startsWith("-") || line.startsWith("•")) {
        actions.push({ kind: "메모", text: line.replace(/^[-•]\s*/, "") });
      }
    } else if (mode === "record") {
      record = (record ? record + " " : "") + line;
    } else {
      restBuf.push(line);
    }
  }

  return {
    summary,
    draft: draftBuf.length > 0 ? draftBuf.join("\n").trim() : null,
    actions,
    record,
    rest: restBuf.length > 0 ? restBuf.join("\n") : null,
  };
}

async function addTodo(text: string): Promise<boolean> {
  try {
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, priority: "med", status: "todo" }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const KIND_META: Record<string, { emoji: string; color: string }> = {
  todos: { emoji: "✅", color: "text-emerald-400" },
  people: { emoji: "👥", color: "text-violet-400" },
  money: { emoji: "💰", color: "text-amber-400" },
  메모: { emoji: "📝", color: "text-zinc-400" },
};

function DecisionItem({ d, onRemove }: { d: Decision; onRemove: () => void }) {
  const parsed = parseDecisionText(d.text);
  const [doneActions, setDoneActions] = useState<Record<number, "todo" | "ok" | "fail">>({});
  const [copied, setCopied] = useState(false);

  async function handleAction(idx: number, kind: string, text: string) {
    setDoneActions((p) => ({ ...p, [idx]: "todo" }));
    let ok = false;
    if (kind === "todos") ok = await addTodo(text);
    else ok = await copy(text);
    setDoneActions((p) => ({ ...p, [idx]: ok ? "ok" : "fail" }));
    setTimeout(() => setDoneActions((p) => ({ ...p, [idx]: ok ? "ok" : "fail" })), 2000);
  }

  async function copyDraft() {
    if (!parsed.draft) return;
    const ok = await copy(parsed.draft);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] text-zinc-600 font-mono">{ago(d.ts)} 전</span>
        <button
          onClick={onRemove}
          className="ml-auto text-[10px] text-zinc-700 hover:text-rose-400"
        >
          지우기
        </button>
      </div>
      {d.question && (
        <p className="text-[11px] text-sky-300 italic mb-1.5">"{d.question}"</p>
      )}
      {parsed.summary && (
        <p className="text-sm text-zinc-100 font-medium mb-2">✓ {parsed.summary}</p>
      )}
      {parsed.draft && (
        <div className="mb-2 rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">📧 회신 초안</span>
            <button
              onClick={copyDraft}
              className={`ml-auto text-[10px] px-2 py-0.5 rounded transition ${
                copied
                  ? "bg-emerald-700/40 text-emerald-200 border border-emerald-700/60"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
              }`}
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
          </div>
          <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
            {parsed.draft}
          </pre>
        </div>
      )}
      {parsed.actions.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">📝 후속 액션</p>
          <ul className="space-y-1">
            {parsed.actions.map((a, i) => {
              const meta = KIND_META[a.kind] || KIND_META.메모;
              const state = doneActions[i];
              return (
                <li key={i} className="flex items-baseline gap-1.5 text-xs">
                  <span className={meta.color}>{meta.emoji}</span>
                  <span className="text-zinc-300 flex-1">{a.text}</span>
                  {a.kind === "todos" ? (
                    <button
                      onClick={() => handleAction(i, "todos", a.text)}
                      disabled={state === "todo"}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition ${
                        state === "ok"
                          ? "bg-emerald-700/40 text-emerald-200"
                          : state === "fail"
                          ? "bg-rose-700/40 text-rose-200"
                          : "bg-sky-700/40 hover:bg-sky-600/60 text-sky-200"
                      }`}
                    >
                      {state === "todo"
                        ? "..."
                        : state === "ok"
                        ? "✓ 추가됨"
                        : state === "fail"
                        ? "실패"
                        : "+ 할일"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction(i, "copy", a.text)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                    >
                      {state === "ok" ? "✓" : "복사"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {parsed.record && (
        <p className="text-[10px] text-zinc-500 italic border-t border-zinc-800/60 pt-1.5">
          📌 {parsed.record}
        </p>
      )}
      {parsed.rest && (
        <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">{parsed.rest}</p>
      )}
    </li>
  );
}

export default function DecisionsCard({ date, refreshKey }: { date: string; refreshKey: number }) {
  const [items, setItems] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch("/api/decisions", { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function remove(id: string) {
    if (!confirm("이 결정 기록을 지울까요?")) return;
    await fetch(`/api/decisions?id=${id}`, { method: "DELETE" });
    load();
  }

  const todayDecisions = items.filter((d) => d.date === date).sort((a, b) => b.ts - a.ts);
  const earlier = items.filter((d) => d.date !== date).sort((a, b) => b.ts - a.ts).slice(0, 5);

  return (
    <section className="rounded-xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/20 to-zinc-900/30 p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-emerald-200">
          📌 결정사항 <span className="text-zinc-500 font-normal text-xs ml-1">{date}</span>
        </h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          오늘 {todayDecisions.length} · 누적 {items.length}
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">로딩…</p>
      ) : todayDecisions.length === 0 ? (
        <p className="text-xs text-zinc-500 italic py-4">
          아직 결정 없음 — 아래 채팅에 입력하면 여기 기록됩니다.
        </p>
      ) : (
        <ul className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
          {todayDecisions.map((d) => (
            <DecisionItem key={d.id} d={d} onRemove={() => remove(d.id)} />
          ))}
        </ul>
      )}

      {earlier.length > 0 && (
        <details className="mt-3 pt-3 border-t border-zinc-800/60">
          <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">
            이전 결정 {earlier.length}건 보기
          </summary>
          <ul className="mt-2 space-y-2">
            {earlier.map((d) => (
              <li key={d.id} className="text-xs">
                <span className="text-zinc-600 font-mono">{d.date}</span>
                {d.question && <span className="text-sky-400/80 italic"> "{d.question}"</span>}
                <p className="text-zinc-400 ml-1 truncate">{d.text.split("\n")[0]}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
