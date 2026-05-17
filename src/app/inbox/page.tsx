"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";

type Category = "action" | "idea" | "reference" | "snooze";
type Priority = "P0" | "P1" | "P2" | "P3";

type Item = {
  id: string;
  ts: number;
  text: string;
  category: Category;
  priority: Priority;
  source?: string;
};

type QueueKind = "tweet" | "article" | "youtube" | "video" | "book" | "misc";
type QueueItem = {
  id: string;
  ts: number;
  text: string;
  kind: QueueKind;
  url?: string;
  source?: string;
};

const INBOX_KEY = "jinho-os:inbox:v1";
const QUEUE_KEY = "jinho-os:queue:v1";
const MIGRATED_KEY = "jinho-os:inbox:migrated:v1";

const CAT_LABEL: Record<Category, string> = {
  action: "🎯 Action",
  idea: "💡 Idea",
  reference: "📚 Reference",
  snooze: "💤 Snooze",
};
const CAT_COLOR: Record<Category, string> = {
  action: "border-rose-700/40 bg-rose-950/20",
  idea: "border-violet-700/40 bg-violet-950/20",
  reference: "border-blue-700/40 bg-blue-950/20",
  snooze: "border-zinc-800 bg-zinc-950/40",
};
const PRI_COLOR: Record<Priority, string> = {
  P0: "text-rose-400",
  P1: "text-amber-400",
  P2: "text-zinc-400",
  P3: "text-zinc-600",
};

const QUEUE_LABEL: Record<QueueKind, string> = {
  tweet: "X",
  article: "글",
  youtube: "YT",
  video: "영상",
  book: "책",
  misc: "기타",
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

function detectQueueKind(text: string): { kind: QueueKind; url?: string } {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return { kind: "misc" };
  const url = urlMatch[0];
  if (/x\.com|twitter\.com/.test(url)) return { kind: "tweet", url };
  if (/youtube\.com|youtu\.be/.test(url)) return { kind: "youtube", url };
  return { kind: "article", url };
}

async function fetchInbox(): Promise<Item[]> {
  const r = await fetch("/api/inbox", { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as { items: Item[] };
  return j.items || [];
}
async function fetchQueue(): Promise<QueueItem[]> {
  const r = await fetch("/api/queue", { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as { items: QueueItem[] };
  return j.items || [];
}

export default function InboxPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<Category>("action");
  const [priority, setPriority] = useState<Priority>("P1");

  const [queueDraft, setQueueDraft] = useState("");

  const [filter, setFilter] = useState<"all" | Category>("all");

  const pollRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const [i, q] = await Promise.all([fetchInbox(), fetchQueue()]);
    setItems(i);
    setQueue(q);
    setLoading(false);
  }, []);

  useEffect(() => {
    setMounted(true);
    reload();
    pollRef.current = window.setInterval(reload, 15000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [reload]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.category] = (c[it.category] || 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? items : items.filter((i) => i.category === filter);
    return [...list].sort((a, b) => {
      const pr: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      if (a.priority !== b.priority) return pr[a.priority] - pr[b.priority];
      return b.ts - a.ts;
    });
  }, [items, filter]);

  async function addItem(e?: React.FormEvent) {
    e?.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    setSyncing(true);
    const optimistic: Item = {
      id: `opt_${Date.now()}`,
      ts: Date.now(),
      text: t,
      category,
      priority,
      source: "web",
    };
    setItems((prev) => [optimistic, ...prev]);
    try {
      const r = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, category, priority, source: "web" }),
      });
      if (r.ok) {
        const { item } = (await r.json()) as { item: Item };
        setItems((prev) => prev.map((p) => (p.id === optimistic.id ? item : p)));
      } else {
        setItems((prev) => prev.filter((p) => p.id !== optimistic.id));
      }
    } finally {
      setSyncing(false);
    }
  }

  async function patchItem(id: string, patch: Partial<Item> & { archived?: boolean }) {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? ({ ...p, ...patch } as Item) : p))
    );
    await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
  }
  async function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/inbox?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function addQueue(e?: React.FormEvent) {
    e?.preventDefault();
    const t = queueDraft.trim();
    if (!t) return;
    setQueueDraft("");
    const { kind, url } = detectQueueKind(t);
    const optimistic: QueueItem = {
      id: `opt_${Date.now()}`,
      ts: Date.now(),
      text: t,
      kind,
      url,
      source: "web",
    };
    setQueue((prev) => [optimistic, ...prev]);
    const r = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t, source: "web" }),
    });
    if (r.ok) {
      const { item } = (await r.json()) as { item: QueueItem };
      setQueue((prev) => prev.map((p) => (p.id === optimistic.id ? item : p)));
    } else {
      setQueue((prev) => prev.filter((p) => p.id !== optimistic.id));
    }
  }
  async function removeQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
    await fetch(`/api/queue?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function migrateLocalStorage() {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(MIGRATED_KEY)) {
      setMigrateMsg("이미 이전 완료됨");
      return;
    }
    const inboxRaw = localStorage.getItem(INBOX_KEY);
    const queueRaw = localStorage.getItem(QUEUE_KEY);
    let inboxLocal: Item[] = [];
    let queueLocal: QueueItem[] = [];
    try {
      inboxLocal = inboxRaw ? (JSON.parse(inboxRaw) as Item[]) : [];
    } catch {}
    try {
      queueLocal = queueRaw ? (JSON.parse(queueRaw) as QueueItem[]) : [];
    } catch {}

    if (!inboxLocal.length && !queueLocal.length) {
      localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
      setMigrateMsg("이전할 항목 없음");
      return;
    }

    setMigrateMsg(`이전 중… inbox=${inboxLocal.length} / queue=${queueLocal.length}`);
    let ok = 0;
    let fail = 0;
    for (const it of inboxLocal) {
      const r = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: it.id,
          ts: it.ts,
          text: it.text,
          category: it.category,
          priority: it.priority,
          source: "localStorage",
        }),
      });
      if (r.ok) ok++;
      else fail++;
    }
    for (const q of queueLocal) {
      const r = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: q.id,
          ts: q.ts,
          text: q.text,
          kind: q.kind,
          url: q.url,
          source: "localStorage",
        }),
      });
      if (r.ok) ok++;
      else fail++;
    }
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    setMigrateMsg(`완료: 성공 ${ok} / 실패 ${fail}`);
    reload();
  }

  const total = items.length;
  const alreadyMigrated =
    mounted && typeof window !== "undefined" && !!localStorage.getItem(MIGRATED_KEY);
  const hasLocalLeftover =
    mounted &&
    typeof window !== "undefined" &&
    !alreadyMigrated &&
    !!(localStorage.getItem(INBOX_KEY) || localStorage.getItem(QUEUE_KEY));

  return (
    <div className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">inbox · DB-backed · telegram-in</p>
        <h1 className="text-3xl font-semibold mt-1">
          인박스 / 큐 {syncing && <span className="text-xs text-zinc-500 ml-2">동기화…</span>}
        </h1>
        <p className="text-zinc-500 text-sm mt-2">
          빠르게 캡처 → P0/P1/P2/P3 → Action / Idea / Reference · Supabase 저장 · 텔레그램 <code className="text-zinc-400">/inbox</code> 동시 인입.
        </p>
      </header>

      {hasLocalLeftover && (
        <div className="mb-5 rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-amber-300">📦 기존 localStorage 데이터가 있어요 — DB로 옮길까요?</span>
          <button
            onClick={migrateLocalStorage}
            className="ml-auto text-[11px] px-3 py-1 rounded border border-amber-600/40 text-amber-200 hover:bg-amber-900/30"
          >
            DB로 이전
          </button>
          {migrateMsg && <span className="text-[11px] text-amber-200">{migrateMsg}</span>}
        </div>
      )}

      <form onSubmit={addItem} className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="빠른 캡처 — Enter 추가"
          className="flex-1 min-w-[260px] bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-2 text-sm text-zinc-300"
        >
          <option value="action">🎯 Action</option>
          <option value="idea">💡 Idea</option>
          <option value="reference">📚 Reference</option>
          <option value="snooze">💤 Snooze</option>
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-2 text-sm text-zinc-300"
        >
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
        <button type="submit" className="px-4 py-2 rounded-md bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white">
          추가
        </button>
      </form>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
            filter === "all"
              ? "bg-zinc-100 text-zinc-900 border-zinc-100"
              : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600"
          }`}
        >
          전체 <span className="opacity-60">{total}</span>
        </button>
        {(["action", "idea", "reference", "snooze"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              filter === k
                ? "bg-zinc-100 text-zinc-900 border-zinc-100"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600"
            }`}
          >
            {CAT_LABEL[k]} <span className="opacity-60">{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      <ul className="space-y-2 mb-10">
        {filtered.map((it) => (
          <li key={it.id} className={`rounded-lg border px-4 py-3 ${CAT_COLOR[it.category]}`}>
            <div className="flex items-baseline gap-3">
              <select
                value={it.priority}
                onChange={(e) => patchItem(it.id, { priority: e.target.value as Priority })}
                className={`text-[10px] font-mono font-bold w-12 shrink-0 bg-transparent border border-zinc-800 rounded px-1 py-0.5 ${PRI_COLOR[it.priority]} focus:outline-none`}
              >
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
              <span className="text-[10px] text-zinc-600 font-mono w-16 shrink-0">{relTime(it.ts)}</span>
              <span className="text-sm text-zinc-100 flex-1 leading-relaxed whitespace-pre-wrap">
                {it.text}
                {it.source && it.source !== "web" && (
                  <span className="ml-2 text-[10px] text-zinc-600 font-mono">[{it.source}]</span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <select
                  value={it.category}
                  onChange={(e) => patchItem(it.id, { category: e.target.value as Category })}
                  className="text-[10px] bg-transparent border border-zinc-800 rounded px-1 py-0.5 text-zinc-400 focus:outline-none"
                >
                  <option value="action">🎯</option>
                  <option value="idea">💡</option>
                  <option value="reference">📚</option>
                  <option value="snooze">💤</option>
                </select>
                <button
                  onClick={() => removeItem(it.id)}
                  className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-700"
                  title="완료 (삭제)"
                >
                  ✓
                </button>
                <button
                  onClick={() => patchItem(it.id, { category: "snooze" })}
                  className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500"
                  title="Snooze로 이동"
                  disabled={it.category === "snooze"}
                >
                  💤
                </button>
                <button
                  onClick={() => removeItem(it.id)}
                  className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-rose-400 hover:border-rose-700"
                  title="Archive (삭제)"
                >
                  ⊘
                </button>
              </div>
            </div>
          </li>
        ))}
        {!loading && filtered.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-zinc-600 text-sm">
            {total === 0 ? "첫 항목 캡처하기 — 위 입력박스에 작성 후 Enter" : "이 카테고리 비어있음 ✓ inbox zero"}
          </li>
        )}
      </ul>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300">📚 읽을거리 큐</h2>
          <span className="text-[10px] text-zinc-600 font-mono">URL 붙이면 자동 분류 (X / YT / 글)</span>
        </div>
        <form onSubmit={addQueue} className="flex items-center gap-2 mb-3">
          <input
            value={queueDraft}
            onChange={(e) => setQueueDraft(e.target.value)}
            placeholder="링크 또는 메모 — Enter 추가"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <button type="submit" className="px-3 py-2 rounded-md bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700">
            큐 추가
          </button>
        </form>
        <ul className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
          {queue.length === 0 && (
            <li className="px-4 py-6 text-center text-zinc-600 text-sm italic">큐 비어있음</li>
          )}
          {queue.map((q) => (
            <li key={q.id} className="px-4 py-3 flex items-baseline gap-3">
              <span className="text-[10px] uppercase text-zinc-500 font-mono w-10 shrink-0">{QUEUE_LABEL[q.kind]}</span>
              <span className="flex-1 text-sm text-zinc-200 truncate" title={q.text}>
                {q.url ? (
                  <a href={q.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline">
                    {q.text}
                  </a>
                ) : (
                  q.text
                )}
              </span>
              <span className="text-xs text-zinc-600 shrink-0">{relTime(q.ts)}</span>
              <button
                onClick={() => removeQueue(q.id)}
                className="text-[10px] px-2 py-1 rounded border border-zinc-800 text-zinc-500 hover:text-rose-400 hover:border-rose-700"
                title="제거"
              >
                ⊘
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-zinc-600 mt-8 font-mono">
        15초마다 자동 새로고침 · 
      </p>
    </div>
  );
}
