"use client";
import { useEffect, useMemo, useState } from "react";

type Decision = {
  id: string;
  ts: number;
  date: string;
  question: string;
  text: string;
  source: string;
};

type Parsed = {
  summary: string | null;
  draft: string | null;
  actions: { kind: string; text: string }[];
  record: string | null;
  rest: string | null;
};

function parseDecisionText(text: string): Parsed {
  const lines = text.split("\n");
  let summary: string | null = null;
  let record: string | null = null;
  const actions: { kind: string; text: string }[] = [];
  let mode: "draft" | "actions" | "record" | "rest" | null = null;
  const draftBuf: string[] = [];
  const restBuf: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (mode === "draft") draftBuf.push("");
      continue;
    }
    if (line.startsWith("✓") && !summary) {
      summary = line.replace(/^✓\s*/, "");
      mode = null;
      continue;
    }
    if (line.startsWith("📧")) { mode = "draft"; continue; }
    if (line.startsWith("📝")) { mode = "actions"; continue; }
    if (line.startsWith("📌")) {
      mode = "record";
      const rest = line.replace(/^📌\s*기록:?\s*/, "").trim();
      if (rest) record = rest;
      continue;
    }
    if (mode === "draft") draftBuf.push(line);
    else if (mode === "actions") {
      const m = line.match(/^[-•·]?\s*(\/?[\w가-힣]+):\s*(.+)$/);
      if (m) actions.push({ kind: m[1].replace(/^\//, ""), text: m[2].trim() });
      else if (line.startsWith("-") || line.startsWith("•")) {
        actions.push({ kind: "메모", text: line.replace(/^[-•]\s*/, "") });
      }
    } else if (mode === "record") record = (record ? record + " " : "") + line;
    else restBuf.push(line);
  }

  return {
    summary,
    draft: draftBuf.length > 0 ? draftBuf.join("\n").trim() : null,
    actions,
    record,
    rest: restBuf.length > 0 ? restBuf.join("\n") : null,
  };
}

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}

function groupByDate(items: Decision[]): { date: string; items: Decision[] }[] {
  const map = new Map<string, Decision[]>();
  for (const it of items) {
    if (!map.has(it.date)) map.set(it.date, []);
    map.get(it.date)!.push(it);
  }
  return Array.from(map.entries())
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.ts - a.ts),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export default function DecisionsPage() {
  const [items, setItems] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

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
  }, []);

  async function remove(id: string) {
    if (!confirm("이 결정 기록을 지울까요?")) return;
    await fetch(`/api/decisions?id=${id}`, { method: "DELETE" });
    load();
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const Q = q.trim().toLowerCase();
    return items.filter(
      (d) =>
        d.question.toLowerCase().includes(Q) ||
        d.text.toLowerCase().includes(Q) ||
        d.date.includes(Q),
    );
  }, [items, q]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">decisions · CEO log</p>
        <h1 className="text-2xl font-semibold mt-1">📌 결정 timeline</h1>
        <p className="text-zinc-500 text-xs mt-1">
          /mail/insights 채팅 + 수동 입력 누적. 총 {items.length}건.
        </p>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="검색 (질문/응답/날짜)"
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600 mb-6"
      />

      {loading ? (
        <p className="text-sm text-zinc-500">로딩…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
          {q ? "검색 결과 없음" : "아직 결정 기록 없음. /mail/insights 채팅에서 입력하면 여기 누적됩니다."}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.date}>
              <div className="flex items-baseline gap-3 mb-3 pb-2 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-300 font-mono">{g.date}</h2>
                <span className="text-[10px] text-zinc-500">{g.items.length}건</span>
              </div>
              <ul className="space-y-3">
                {g.items.map((d) => {
                  const parsed = parseDecisionText(d.text);
                  return (
                    <li
                      key={d.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
                    >
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="text-[10px] text-zinc-600 font-mono">{ago(d.ts)}</span>
                        <span className="text-[10px] text-zinc-600 font-mono">· {d.source}</span>
                        <button
                          onClick={() => remove(d.id)}
                          className="ml-auto text-[10px] text-zinc-700 hover:text-rose-400"
                        >
                          지우기
                        </button>
                      </div>
                      {d.question && (
                        <p className="text-xs text-sky-300 italic mb-2">"{d.question}"</p>
                      )}
                      {parsed.summary && (
                        <p className="text-sm text-zinc-100 font-medium mb-2">✓ {parsed.summary}</p>
                      )}
                      {parsed.draft && (
                        <details className="mb-2">
                          <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">
                            📧 회신 초안 보기
                          </summary>
                          <pre className="mt-1 text-[11px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed border-l-2 border-zinc-700 pl-3">
                            {parsed.draft}
                          </pre>
                        </details>
                      )}
                      {parsed.actions.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-zinc-400 mb-1">
                          {parsed.actions.map((a, i) => (
                            <li key={i}>
                              <span className="text-zinc-500">{a.kind}:</span> {a.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      {parsed.record && (
                        <p className="text-[10px] text-zinc-500 italic mt-1.5">📌 {parsed.record}</p>
                      )}
                      {parsed.rest && (
                        <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">
                          {parsed.rest}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
