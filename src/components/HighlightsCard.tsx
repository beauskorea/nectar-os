"use client";
import { useEffect, useMemo, useState } from "react";

type Kind = "risk" | "issue" | "win";

type Highlight = {
  id: string;
  kind: Kind;
  title: string;
  action: string;
  owner: string;
  due: string | null;
  done: boolean;
  createdAt: number;
};

const STORAGE_KEY = "jinho-highlights-v1";

const KIND_META: Record<Kind, { emoji: string; label: string; bg: string; text: string; border: string; pillBg: string }> = {
  risk: {
    emoji: "🚨",
    label: "위험",
    bg: "bg-rose-950/30",
    text: "text-rose-200",
    border: "border-rose-900/60",
    pillBg: "bg-rose-700/60 border-rose-500 text-rose-50",
  },
  issue: {
    emoji: "⚠️",
    label: "이슈",
    bg: "bg-amber-950/30",
    text: "text-amber-200",
    border: "border-amber-900/60",
    pillBg: "bg-amber-700/60 border-amber-500 text-amber-50",
  },
  win: {
    emoji: "🎉",
    label: "축하·보상",
    bg: "bg-emerald-950/30",
    text: "text-emerald-200",
    border: "border-emerald-900/60",
    pillBg: "bg-emerald-700/60 border-emerald-500 text-emerald-50",
  },
};

function load(): Highlight[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function save(list: Highlight[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const t = new Date(due + "T23:59:59+09:00").getTime();
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.ceil((t - d.getTime()) / (86400 * 1000));
}

type Candidate = {
  src: "event" | "mail";
  sourceId: string;
  kind: Kind;
  title: string;
  action: string;
  owner: string;
  due: string | null;
};

export default function HighlightsCard() {
  const [items, setItems] = useState<Highlight[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [scanning, setScanning] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [scanStats, setScanStats] = useState<string>("");

  useEffect(() => {
    setItems(load());
  }, []);

  // 자동 스캔 — 페이지 마운트 시 한 번. 1시간 캐시 (sessionStorage).
  useEffect(() => {
    const AUTO_KEY = "jinho-highlights-autoscan-v1";
    const TTL_MS = 60 * 60 * 1000;
    try {
      const raw = sessionStorage.getItem(AUTO_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; items: Candidate[]; stats: string };
        if (Date.now() - parsed.ts < TTL_MS) {
          // 캐시된 결과를 후보로 복원 (단, 이미 등록된 sourceId는 제외)
          const existingSourceIds = new Set(
            load().map((h) => (h as Highlight & { sourceId?: string }).sourceId).filter(Boolean),
          );
          const fresh = parsed.items.filter((c) => !existingSourceIds.has(c.sourceId));
          if (fresh.length > 0) {
            setCandidates(fresh);
            setScanStats(`${parsed.stats} · 캐시`);
          }
          return;
        }
      }
    } catch {}
    // 캐시 없음/만료 — 새로 스캔
    (async () => {
      setScanning(true);
      try {
        const r = await fetch("/api/highlights/scan", { method: "POST" });
        const data = (await r.json()) as {
          items?: Candidate[];
          stats?: { events_scanned: number; mails_scanned: number; ai_matched: number };
          error?: string;
        };
        if (!r.ok || !data.items) return;
        const existingSourceIds = new Set(
          load().map((h) => (h as Highlight & { sourceId?: string }).sourceId).filter(Boolean),
        );
        const fresh = data.items.filter((c) => !existingSourceIds.has(c.sourceId));
        const statsStr = data.stats
          ? `이벤트 ${data.stats.events_scanned} · 메일 ${data.stats.mails_scanned} → AI 매칭 ${data.stats.ai_matched} (신규 ${fresh.length})`
          : "";
        if (fresh.length > 0) {
          setCandidates(fresh);
          setScanStats(statsStr);
        }
        try {
          sessionStorage.setItem(
            AUTO_KEY,
            JSON.stringify({ ts: Date.now(), items: data.items, stats: statsStr }),
          );
        } catch {}
      } catch {
        // 자동 스캔은 조용히 실패 — 사용자가 명시적으로 클릭하면 에러 표시
      } finally {
        setScanning(false);
      }
    })();
  }, []);

  const persist = (next: Highlight[]) => {
    setItems(next);
    save(next);
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/highlights/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const data = (await r.json()) as { items?: Omit<Highlight, "id" | "done" | "createdAt">[]; error?: string; detail?: string };
      if (!r.ok || !data.items?.length) {
        setErr(data.error || "AI 파싱 실패");
        return;
      }
      const enriched: Highlight[] = data.items.map((it) => ({
        id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: it.kind,
        title: it.title,
        action: it.action,
        owner: it.owner,
        due: it.due,
        done: false,
        createdAt: Date.now(),
      }));
      persist([...enriched, ...items]);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleDone = (id: string) => {
    persist(items.map((h) => (h.id === id ? { ...h, done: !h.done } : h)));
  };
  const remove = (id: string) => {
    persist(items.filter((h) => h.id !== id));
  };

  async function aiScan() {
    if (scanning) return;
    setScanning(true);
    setErr(null);
    setCandidates([]);
    setScanStats("");
    try {
      const r = await fetch("/api/highlights/scan", { method: "POST" });
      const data = (await r.json()) as {
        items?: Candidate[];
        stats?: { events_scanned: number; mails_scanned: number; ai_matched: number };
        error?: string;
      };
      if (!r.ok) {
        setErr(data.error || "스캔 실패");
        return;
      }
      // 이미 등록된 sourceId는 후보에서 제외
      const existingSourceIds = new Set(
        items.map((h) => (h as Highlight & { sourceId?: string }).sourceId).filter(Boolean),
      );
      const fresh = (data.items || []).filter((c) => !existingSourceIds.has(c.sourceId));
      setCandidates(fresh);
      if (data.stats) {
        setScanStats(
          `이벤트 ${data.stats.events_scanned} · 메일 ${data.stats.mails_scanned} → AI 매칭 ${data.stats.ai_matched} (신규 ${fresh.length})`,
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const acceptCandidate = (c: Candidate, idx: number) => {
    const next: Highlight & { sourceId?: string } = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: c.kind,
      title: c.title,
      action: c.action,
      owner: c.owner,
      due: c.due,
      done: false,
      createdAt: Date.now(),
      sourceId: c.sourceId,
    } as Highlight & { sourceId?: string };
    persist([next, ...items]);
    setCandidates(candidates.filter((_, i) => i !== idx));
  };
  const skipCandidate = (idx: number) => {
    setCandidates(candidates.filter((_, i) => i !== idx));
  };

  const filtered = useMemo(() => {
    let list = items;
    if (filter === "open") list = items.filter((h) => !h.done);
    else if (filter === "done") list = items.filter((h) => h.done);
    // sort: risk → issue → win, then due asc (null last), then newest createdAt
    const kindOrder: Record<Kind, number> = { risk: 0, issue: 1, win: 2 };
    return [...list].sort((a, b) => {
      if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
      const da = a.due ? new Date(a.due).getTime() : Infinity;
      const db = b.due ? new Date(b.due).getTime() : Infinity;
      if (da !== db) return da - db;
      return b.createdAt - a.createdAt;
    });
  }, [items, filter]);

  const counts = useMemo(() => {
    const open = items.filter((h) => !h.done);
    return {
      risk: open.filter((h) => h.kind === "risk").length,
      issue: open.filter((h) => h.kind === "issue").length,
      win: open.filter((h) => h.kind === "win").length,
      total: items.length,
      open: open.length,
    };
  }, [items]);

  return (
    <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">🎯 신경 써야 할 것</h2>
          <span className="text-[10px] text-zinc-600 font-mono">
            🚨 {counts.risk} · ⚠️ {counts.issue} · 🎉 {counts.win}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={aiScan}
            disabled={scanning}
            className="text-[10px] px-2.5 py-1 rounded border border-violet-700 bg-violet-900/40 text-violet-200 hover:bg-violet-900/70 disabled:opacity-50"
            title="캘린더 + 메일에서 자동으로 위험·이슈·축하 시그널 추출"
          >
            {scanning ? "스캔 중..." : "🤖 AI 자동 감지"}
          </button>
          <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden text-[10px]">
            {(["open", "all", "done"] as const).map((f) => {
              const on = filter === f;
              const labels: Record<string, string> = { open: "열린", all: "전체", done: "완료" };
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 transition border-r border-zinc-800 last:border-r-0 ${
                    on
                      ? "bg-zinc-700/80 text-zinc-100 font-semibold"
                      : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {labels[f]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI 자동 감지 후보 */}
      {(candidates.length > 0 || scanStats) && (
        <div className="mb-3 rounded-lg border border-violet-900/60 bg-violet-950/20 p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">
              🤖 AI 추천 시그널 (검토 후 추가)
            </span>
            {scanStats && (
              <span className="text-[10px] text-zinc-600 font-mono">{scanStats}</span>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">
              새로 추가할 시그널 없음 (이미 등록되었거나 일정·메일에 신호 없음)
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c, i) => {
                const m = KIND_META[c.kind];
                return (
                  <li
                    key={`${c.sourceId}-${i}`}
                    className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${m.pillBg}`}>
                          {m.emoji} {m.label}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono">
                          {c.src === "event" ? "📅" : "📧"} {c.src}
                        </span>
                        <span className="text-xs text-zinc-200 truncate">{c.title}</span>
                        {c.due && (
                          <span className="text-[10px] text-zinc-500 font-mono">⏰ {c.due}</span>
                        )}
                      </div>
                      {(c.action || c.owner) && (
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          {c.action && <span>→ {c.action}</span>}
                          {c.owner && <span className="ml-2">@{c.owner}</span>}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => acceptCandidate(c, i)}
                      className="text-[10px] px-2 py-1 rounded bg-emerald-700/60 text-emerald-50 hover:bg-emerald-700 shrink-0"
                      title="목록에 추가"
                    >
                      ＋ 추가
                    </button>
                    <button
                      onClick={() => skipCandidate(i)}
                      className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 shrink-0"
                      title="무시"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mb-3 flex gap-2 items-center">
        <span className="text-violet-400">✨</span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="자연어로 추가 — 예: 올리브영 파트너 성사, 마케팅팀 보상 챙기기 / 신승아 1on1 정체, 다음주 결정 / 박창현 전무에 계약서 검토 부탁"
          disabled={busy}
          className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "분석 중..." : "AI 추가"}
        </button>
      </form>
      {err && <p className="text-xs text-rose-400 mb-2">❌ {err}</p>}

      {filtered.length === 0 ? (
        <p className="text-xs text-zinc-500 italic px-2 py-3">
          {filter === "open"
            ? "열린 항목 없음 — 위 입력창에 한 줄 던지면 AI가 카테고리/액션/담당자로 정리해줍니다"
            : filter === "done"
              ? "완료된 항목 없음"
              : "아직 항목이 없습니다"}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((h) => {
            const m = KIND_META[h.kind];
            const d = daysUntil(h.due);
            const overdue = d !== null && d < 0;
            const urgent = d !== null && d >= 0 && d <= 2;
            return (
              <li
                key={h.id}
                className={`rounded-lg border ${m.border} ${m.bg} px-3 py-2.5 ${h.done ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={h.done}
                    onChange={() => toggleDone(h.id)}
                    className="mt-1 shrink-0 cursor-pointer accent-violet-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${m.pillBg}`}>
                        {m.emoji} {m.label}
                      </span>
                      <span className={`text-sm font-medium ${h.done ? "line-through text-zinc-500" : m.text}`}>
                        {h.title}
                      </span>
                      {h.due && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            overdue
                              ? "border-rose-700 bg-rose-950/50 text-rose-300"
                              : urgent
                                ? "border-amber-700 bg-amber-950/50 text-amber-300"
                                : "border-zinc-700 bg-zinc-900/50 text-zinc-400"
                          }`}
                        >
                          {h.due} ({overdue ? `${-d}일 지남` : d === 0 ? "오늘" : `${d}일 남음`})
                        </span>
                      )}
                    </div>
                    {(h.action || h.owner) && (
                      <p className={`text-xs mt-1.5 ${h.done ? "text-zinc-600" : "text-zinc-400"}`}>
                        {h.action && <span>→ {h.action}</span>}
                        {h.owner && (
                          <span className="ml-2 text-[10px] font-mono text-zinc-500">@{h.owner}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => remove(h.id)}
                    className="text-[10px] text-zinc-600 hover:text-rose-400 shrink-0"
                    title="삭제"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
