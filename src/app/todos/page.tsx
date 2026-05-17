"use client";
import { useEffect, useState } from "react";
import ContactsToReach from "@/components/ContactsToReach";
import TodosQuickAdd from "@/components/TodosQuickAdd";

type Status = "todo" | "doing" | "done";
type Board = "company" | "personal";
type Todo = {
  id: string;
  listId: string;
  board: Board;
  text: string;
  status: Status;
  priority: "high" | "med" | "low";
  completed: boolean;
  userNotes: string;
  updated?: string;
};

type Owner = "me" | "influencer" | "brand" | "partner" | "evp" | "people";

type WeeklyItem = {
  id: string;
  text: string;
  owner: Owner;
  priority: "high" | "med" | "low";
};
type WeeklySection = {
  emoji: string;
  label: string;
  defaultOwner: Owner;
  defaultPriority: "high" | "med" | "low";
  items: WeeklyItem[];
};
type WeeklyData = {
  available: boolean;
  week?: number;
  period?: string;
  sections?: WeeklySection[];
  total?: number;
  sourceUrl?: string;
};


type Suggestion = {
  id: string;
  source: "mail" | "people";
  owner: Owner;
  ownerReason: string;
  title: string;
  detail: string;
  ts: number;
  priority: "high" | "med" | "low";
  link?: string;
};

const SUGGEST_DISMISSED_KEY = "jinho-todos:dismissed-suggestions:v1";
const SUGGEST_OVERRIDE_KEY = "jinho-todos:classification-overrides:v1";
const WEEKLY_DISMISSED_KEY = "jinho-todos:weekly-dismissed:v1";
const BOARD_KEY = "jinho-todos:active-board:v1";

const BOARD_META: Record<Board, { emoji: string; label: string; prefix: string }> = {
  company: { emoji: "🏢", label: "회사", prefix: "회사" },
  personal: { emoji: "🏠", label: "개인", prefix: "개인" },
};
const OWNER_LABEL: Record<Owner, string> = {
  me: "내 일",
  influencer: "인플루언서",
  brand: "브랜드",
  partner: "파트너",
  evp: "전무님",
  people: "인맥",
};


function buildColumns(board: Board): { key: Status; label: string }[] {
  const p = BOARD_META[board].prefix;
  return [
    { key: "todo", label: `${p} · To Do` },
    { key: "doing", label: `${p} · Doing` },
    { key: "done", label: `${p} · Done` },
  ];
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-400",
  med: "bg-amber-400",
  low: "bg-zinc-500",
};

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Owner>>({});
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [weeklyDismissed, setWeeklyDismissed] = useState<Set<string>>(new Set());
  const [weeklyOpen, setWeeklyOpen] = useState(true);
  const [openOwners, setOpenOwners] = useState<Record<Owner, boolean>>({
    me: true,
    influencer: true,
    brand: true,
    partner: true,
    evp: false,
    people: true,
  });
  const [addOpen, setAddOpen] = useState<Record<Status, boolean>>({
    todo: false,
    doing: false,
    done: false,
  });
  const [addText, setAddText] = useState<Record<Status, string>>({
    todo: "",
    doing: "",
    done: "",
  });
  const [addPriority, setAddPriority] = useState<"high" | "med" | "low">("med");
  const [showDone, setShowDone] = useState<Record<Status, boolean>>({
    todo: false,
    doing: false,
    done: true,
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);
  const [board, setBoardState] = useState<Board>("company");

  const COLUMNS = buildColumns(board);

  function setBoard(b: Board) {
    setBoardState(b);
    try {
      localStorage.setItem(BOARD_KEY, b);
    } catch {}
  }

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/tasks", { cache: "no-store" });
      const j = await r.json();
      setConfigured(!!j.configured);
      if (j.configured) {
        setTodos(j.todos || []);
        setError(j.error || null);
      } else {
        setTodos([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOARD_KEY);
      if (raw === "personal" || raw === "company") setBoardState(raw);
    } catch {}
    refresh();
    fetchSuggestions();
    try {
      const raw = localStorage.getItem(SUGGEST_DISMISSED_KEY);
      if (raw) setDismissedIds(new Set(JSON.parse(raw)));
    } catch {}
    try {
      const raw = localStorage.getItem(SUGGEST_OVERRIDE_KEY);
      if (raw) setOverrides(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(WEEKLY_DISMISSED_KEY);
      if (raw) setWeeklyDismissed(new Set(JSON.parse(raw)));
    } catch {}
    fetchWeekly();
    function onFocus() {
      refresh();
      fetchSuggestions();
    }
    window.addEventListener("focus", onFocus);
    // Poll every 30s
    const interval = setInterval(() => {
      refresh();
      fetchSuggestions();
    }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, []);

  function overrideSuggestion(id: string, target: Owner) {
    setOverrides((prev) => {
      const next = { ...prev, [id]: target };
      try {
        localStorage.setItem(SUGGEST_OVERRIDE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  async function fetchWeekly() {
    try {
      const r = await fetch("/api/weekly-tasks", { cache: "no-store" });
      const j = await r.json();
      setWeekly(j as WeeklyData);
    } catch {}
  }

  function dismissWeekly(id: string) {
    setWeeklyDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(WEEKLY_DISMISSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  async function acceptWeekly(item: WeeklyItem) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: item.text, priority: item.priority, status: "todo", board }),
      });
      const j = await r.json();
      if (j.todo) {
        setTodos((prev) => [j.todo as Todo, ...prev]);
        dismissWeekly(item.id);
      } else {
        setError(j.error || "create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function fetchSuggestions() {
    try {
      const r = await fetch("/api/suggestions", { cache: "no-store" });
      const j = await r.json();
      setSuggestions(j.suggestions || []);
    } catch {}
  }

  function dismissSuggestion(id: string) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(SUGGEST_DISMISSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  async function acceptSuggestion(sg: Suggestion) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: sg.title, priority: sg.priority, status: "todo", board }),
      });
      const j = await r.json();
      if (j.todo) {
        setTodos((prev) => [j.todo as Todo, ...prev]);
        dismissSuggestion(sg.id);
      } else {
        setError(j.error || "create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function addInColumn(status: Status) {
    const t = (addText[status] || "").trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, priority: addPriority, status, board }),
      });
      const j = await r.json();
      if (j.todo) {
        setTodos((prev) => [j.todo as Todo, ...prev]);
        setAddText((p) => ({ ...p, [status]: "" }));
      } else {
        setError(j.error || "create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function move(t: Todo, target: Status) {
    if (target === t.status || busy) return;
    setBusy(true);
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: target } : x)));
    try {
      const r = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId: t.listId, toStatus: target }),
      });
      const j = await r.json();
      if (j.todo) {
        setTodos((prev) => prev.map((x) => (x.id === t.id ? (j.todo as Todo) : x)));
      } else {
        setError(j.error || "move failed");
        refresh();
      }
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleCompleted(t: Todo) {
    if (busy) return;
    setBusy(true);
    const next = !t.completed;
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, completed: next } : x)));
    try {
      const r = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId: t.listId, completed: next }),
      });
      const j = await r.json();
      if (j.todo) {
        setTodos((prev) => prev.map((x) => (x.id === t.id ? (j.todo as Todo) : x)));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Todo) {
    if (busy) return;
    setBusy(true);
    const prev = todos;
    setTodos((p) => p.filter((x) => x.id !== t.id));
    try {
      const r = await fetch(`/api/tasks/${t.id}?listId=${encodeURIComponent(t.listId)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "delete failed");
        setTodos(prev);
      }
    } catch (e) {
      setError((e as Error).message);
      setTodos(prev);
    } finally {
      setBusy(false);
    }
  }

  function onDropToColumn(target: Status) {
    if (!dragId) return;
    const t = todos.find((x) => x.id === dragId);
    setDragId(null);
    setDragOverCol(null);
    if (!t || t.status === target) return;
    move(t, target);
  }

  return (
    <div className="-mx-0 min-h-screen bg-zinc-950">
      <div className="px-6 py-6">
        <header className="mb-4 flex items-center gap-3 flex-wrap">
          <h1 className="text-zinc-100 font-semibold text-lg">메인 보드</h1>
          <div className="inline-flex rounded-xl border border-zinc-800 overflow-hidden shrink-0 shadow-lg">
            {(["company", "personal"] as Board[]).map((b) => {
              const on = board === b;
              const meta = BOARD_META[b];
              const count = todos.filter((t) => (t.board ?? "company") === b && !t.completed).length;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBoard(b)}
                  className={`flex items-center gap-2 px-5 py-3 text-base font-semibold transition border-r border-zinc-800 last:border-r-0 ${
                    on
                      ? b === "company"
                        ? "bg-sky-600 text-white border-sky-400"
                        : "bg-emerald-600 text-white border-emerald-400"
                      : "bg-zinc-900/40 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
                  }`}
                >
                  <span className="text-lg leading-none">{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span className={`text-sm font-mono ${on ? "opacity-90" : "opacity-60"}`}>· {count}</span>
                </button>
              );
            })}
          </div>
          <span className="text-xs text-zinc-500">넥타 ⟷ Google Tasks ⟷ TasksBoard</span>
          <a
            href="https://tasksboard.com/app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-400 hover:underline"
          >
            tasksboard.com →
          </a>
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-800 border border-transparent hover:border-zinc-700"
          >
            ↻ {loading ? "..." : "새로고침"}
          </button>
        </header>

        <TodosQuickAdd onAdded={refresh} board={board} />

        {configured === false && (
          <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            ⚠ Google Tasks 토큰이 설정되지 않았습니다.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300 font-mono">
            {error}
          </div>
        )}

        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const colItems = todos.filter((t) => t.status === col.key && (t.board ?? "company") === board);
            const active = colItems
              .filter((t) => !t.completed)
              .sort((a, b) => {
                const order = { high: 0, med: 1, low: 2 };
                if (a.priority !== b.priority) return order[a.priority] - order[b.priority];
                return (b.updated || "").localeCompare(a.updated || "");
              });
            const done = colItems
              .filter((t) => t.completed)
              .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
            const open = addOpen[col.key];
            const isDragOver = dragOverCol === col.key;
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverCol !== col.key) setDragOverCol(col.key);
                }}
                onDragLeave={(e) => {
                  // only clear if leaving the section
                  if (e.currentTarget === e.target) setDragOverCol(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropToColumn(col.key);
                }}
                className={`bg-zinc-900/60 rounded-2xl border w-[320px] shrink-0 flex flex-col max-h-[calc(100vh-180px)] transition ${
                  isDragOver ? "border-sky-400 ring-1 ring-sky-400/50" : "border-zinc-800"
                }`}
              >
                <header className="flex items-center justify-between px-4 pt-4 pb-2">
                  <h2 className="text-zinc-100 font-semibold text-[15px] truncate">{col.label}</h2>
                  <span className="text-xs text-zinc-500 font-mono">{active.length}</span>
                </header>

                <div className="px-3 pb-2">
                  {!open ? (
                    <button
                      onClick={() => setAddOpen((p) => ({ ...p, [col.key]: true }))}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
                    >
                      <span className="w-5 h-5 inline-flex items-center justify-center text-zinc-500">+</span>
                      <span>작업 추가</span>
                    </button>
                  ) : (
                    <div className="border border-zinc-700 rounded-lg p-2 bg-zinc-950/50">
                      <input
                        key={`add-${col.key}`}
                        autoFocus
                        value={addText[col.key]}
                        onChange={(e) => setAddText((p) => ({ ...p, [col.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addInColumn(col.key);
                          } else if (e.key === "Escape") {
                            setAddOpen((p) => ({ ...p, [col.key]: false }));
                            setAddText((p) => ({ ...p, [col.key]: "" }));
                          }
                        }}
                        placeholder="작업 제목"
                        className="w-full text-sm outline-none placeholder-zinc-600 text-zinc-100 bg-transparent"
                      />
                      <div className="flex items-center gap-1 mt-2">
                        {(["high", "med", "low"] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => setAddPriority(p)}
                            title={`priority ${p}`}
                            className={`w-3 h-3 rounded-full border transition ${
                              addPriority === p
                                ? "ring-2 ring-offset-1 ring-offset-zinc-900 ring-zinc-300"
                                : "opacity-50 hover:opacity-100"
                            } ${PRIORITY_DOT[p]} ${
                              p === "low" ? "border-zinc-600" : "border-transparent"
                            }`}
                          />
                        ))}
                        <span className="text-[10px] text-zinc-600 font-mono ml-1">↵ 저장 · esc 취소</span>
                        <button
                          onClick={() => addInColumn(col.key)}
                          disabled={!(addText[col.key] || "").trim() || busy}
                          className="ml-auto text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-30"
                        >
                          추가
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-3">
                  {active.length === 0 && done.length === 0 && !loading && (
                    <div className="text-center py-10 px-4 text-zinc-500">
                      <div className="text-3xl mb-2">📭</div>
                      <p className="text-sm">아직 작업이 없습니다</p>
                      <p className="text-xs text-zinc-600 mt-1">위의 "+"를 클릭하여 추가하세요</p>
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {active.map((t) => (
                      <TaskRow
                        key={t.id}
                        t={t}
                        col={col}
                        busy={busy}
                        onToggle={toggleCompleted}
                        onMove={move}
                        onRemove={remove}
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverCol(null);
                        }}
                        isDragging={dragId === t.id}
                      />
                    ))}
                  </ul>

                  {done.length > 0 && (
                    <div className="mt-3">
                      <button
                        onClick={() =>
                          setShowDone((p) => ({ ...p, [col.key]: !p[col.key] }))
                        }
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
                      >
                        <span>{showDone[col.key] ? "▾" : "▸"}</span>
                        <span>완료됨 ({done.length})</span>
                      </button>
                      {showDone[col.key] && (
                        <ul className="space-y-0.5 mt-1">
                          {done.map((t) => (
                            <TaskRow
                              key={t.id}
                              t={t}
                              col={col}
                              busy={busy}
                              onToggle={toggleCompleted}
                              onMove={move}
                              onRemove={remove}
                              onDragStart={() => setDragId(t.id)}
                              onDragEnd={() => {
                                setDragId(null);
                                setDragOverCol(null);
                              }}
                              isDragging={dragId === t.id}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {board === "company" && (
          <WeeklyCell
            data={weekly}
            dismissedIds={weeklyDismissed}
            open={weeklyOpen}
            setOpen={setWeeklyOpen}
            busy={busy}
            onAccept={acceptWeekly}
            onDismiss={dismissWeekly}
          />
        )}
        {board === "company" && (() => {
          const OWNER_META = {
            me:         { t: "💡 내 일",             ac: "amber"  as Accent, st: "메일/캘린더 기반 · CEO 직접 처리" },
            influencer: { t: "🎤 인플루언서 영입",   ac: "purple" as Accent, st: "크리에이터/자청 영입" },
            brand:      { t: "🏢 브랜드 영업",       ac: "sky"    as Accent, st: "RFP/캠페인/광고 대행" },
            partner:    { t: "🤝 파트너",            ac: "cyan"   as Accent, st: "파트너십/입점/콜라보" },
            people:     { t: "👥 인맥 챙기기",       ac: "rose"   as Accent, st: "people.json overdue" },
            evp:        { t: "📋 전무님 일",         ac: "zinc"   as Accent, st: "인보이스/지급/송금" },
          } satisfies Record<Owner, { t: string; ac: Accent; st: string }>;
          const mapped = suggestions.map((sg) => (overrides[sg.id] ? { ...sg, owner: overrides[sg.id] } : sg));
          const pendingByOwner: Record<Owner, number> = { me: 0, influencer: 0, brand: 0, partner: 0, people: 0, evp: 0 };
          for (const sg of mapped) if (!dismissedIds.has(sg.id)) pendingByOwner[sg.owner]++;
          const renderCell = (o: Owner) => (
            <SuggestionsCell
              key={o}
              owner={o}
              title={OWNER_META[o].t}
              accent={OWNER_META[o].ac}
              subtitle={OWNER_META[o].st}
              suggestions={mapped.filter((sg) => sg.owner === o)}
              dismissedIds={dismissedIds}
              show={openOwners[o]}
              setShow={(v) => setOpenOwners((p) => ({ ...p, [o]: v }))}
              busy={busy}
              onAccept={acceptSuggestion}
              onDismiss={dismissSuggestion}
              onOverride={overrideSuggestion}
            />
          );
          const groups: { label: string; emoji: string; hint: string; owners: Owner[] }[] = [
            { label: "밖일",  emoji: "🌐", hint: "영입 · 영업 · 파트너",     owners: ["influencer", "brand", "partner"] },
            { label: "안일",  emoji: "🏠", hint: "내 일 · 인맥",              owners: ["me", "people"] },
            { label: "참고",  emoji: "📎", hint: "전무님 (인보이스/지급)",   owners: ["evp"] },
          ];
          return groups.map((g) => {
            const total = g.owners.reduce((s, o) => s + pendingByOwner[o], 0);
            const isInner = g.label === "안일";
            if (total === 0 && !isInner) return null;
            return (
              <div key={g.label} className="mt-8">
                <div className="flex items-baseline gap-2 px-1 mb-1">
                  <span className="text-[11px] uppercase tracking-widest text-zinc-400">{g.emoji} {g.label}</span>
                  <span className="text-[11px] text-zinc-600 font-mono">{total}</span>
                  <span className="text-[11px] text-zinc-600 ml-1">· {g.hint}</span>
                  <div className="flex-1 border-t border-zinc-800 ml-3" />
                </div>
                {g.owners.map(renderCell)}
                {isInner && <ContactsToReach />}
              </div>
            );
          });
        })()}
        {board === "personal" && (
          <div className="mt-6 text-xs text-zinc-500 px-1">
            🏠 개인 보드 — 회사 자동제안(메일/캘린더/인맥)은 표시하지 않음. 직접 추가만 사용.
          </div>
        )}
      </div>
    </div>
  );
}

type Accent = "amber" | "purple" | "sky" | "cyan" | "rose" | "zinc";

const ACCENT_HEADER: Record<Accent, string> = {
  amber: "text-amber-400 hover:bg-amber-950/20",
  purple: "text-purple-300 hover:bg-purple-950/20",
  sky: "text-sky-300 hover:bg-sky-950/20",
  cyan: "text-cyan-300 hover:bg-cyan-950/20",
  rose: "text-rose-300 hover:bg-rose-950/20",
  zinc: "text-zinc-300 hover:bg-zinc-800/40",
};
const ACCENT_CARD: Record<Accent, string> = {
  amber: "border-amber-900/40 bg-amber-950/10 hover:border-amber-700/60",
  purple: "border-purple-900/40 bg-purple-950/10 hover:border-purple-700/60",
  sky: "border-sky-900/40 bg-sky-950/10 hover:border-sky-700/60",
  cyan: "border-cyan-900/40 bg-cyan-950/10 hover:border-cyan-700/60",
  rose: "border-rose-900/40 bg-rose-950/10 hover:border-rose-700/60",
  zinc: "border-zinc-700 bg-zinc-950/40 hover:border-zinc-500",
};
const ACCENT_COUNT: Record<Accent, string> = {
  amber: "text-amber-400/70",
  purple: "text-purple-300/70",
  sky: "text-sky-300/70",
  cyan: "text-cyan-300/70",
  rose: "text-rose-300/70",
  zinc: "text-zinc-500",
};

function SuggestionsCell({
  owner,
  title,
  subtitle,
  accent,
  suggestions,
  dismissedIds,
  show,
  setShow,
  busy,
  onAccept,
  onDismiss,
  onOverride,
}: {
  owner: Owner;
  title: string;
  subtitle: string;
  accent: Accent;
  suggestions: Suggestion[];
  dismissedIds: Set<string>;
  show: boolean;
  setShow: (v: boolean) => void;
  busy: boolean;
  onAccept: (sg: Suggestion) => void;
  onDismiss: (id: string) => void;
  onOverride: (id: string, target: Owner) => void;
}) {
  const pending = suggestions.filter((sg) => !dismissedIds.has(sg.id));
  if (pending.length === 0) return null;
  const headerCls = ACCENT_HEADER[accent];
  const cardCls = ACCENT_CARD[accent];
  const countCls = ACCENT_COUNT[accent];
  return (
    <section className="mt-6 bg-zinc-900/60 rounded-2xl border border-zinc-800">
      <button
        onClick={() => setShow(!show)}
        className={`w-full flex items-center gap-2 px-4 py-3 rounded-t-2xl ${headerCls}`}
      >
        <span className="text-xs">{show ? "▾" : "▸"}</span>
        <span className="font-semibold">{title}</span>
        <span className={`text-xs ${countCls} font-mono`}>({pending.length})</span>
        <span className="ml-auto text-[11px] text-zinc-500 font-mono">{subtitle}</span>
      </button>
      {show && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 px-4 pb-4">
          {pending.slice(0, 9).map((sg) => (
            <li
              key={sg.id}
              className={`rounded-lg border p-3 transition ${cardCls}`}
            >
              <p className="text-sm text-zinc-100 leading-snug line-clamp-2">{sg.title}</p>
              <p className="text-[11px] text-zinc-500 mt-1.5 line-clamp-1">{sg.detail}</p>
              <div className="flex items-center gap-1 mt-3">
                <button
                  onClick={() => onAccept(sg)}
                  disabled={busy}
                  className="text-[11px] px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 border border-emerald-700/40 disabled:opacity-40"
                >
                  + {owner === "me" || owner === "people" ? "할 일로 추가" : "내 할 일로 가져오기"}
                </button>
                <button
                  onClick={() => onDismiss(sg.id)}
                  className="text-[11px] px-2 py-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                >
                  무시
                </button>
                <select
                  value={owner}
                  onChange={(e) => onOverride(sg.id, e.target.value as Owner)}
                  title="분류 변경"
                  className="text-[11px] bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-zinc-100 rounded px-1 py-0.5 outline-none cursor-pointer"
                >
                  {(Object.keys(OWNER_LABEL) as Owner[]).map((k) => (
                    <option key={k} value={k}>
                      → {OWNER_LABEL[k]}
                    </option>
                  ))}
                </select>
                {sg.link && (
                  <a
                    href={sg.link}
                    className="ml-auto text-[11px] text-sky-400 hover:underline"
                  >
                    열기 →
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  t,
  col,
  busy,
  onToggle,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  t: Todo;
  col: { key: Status; label: string };
  busy: boolean;
  onToggle: (t: Todo) => void;
  onMove: (t: Todo, target: Status) => void;
  onRemove: (t: Todo) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const order: Status[] = ["todo", "doing", "done"];
  const idx = order.indexOf(col.key);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-zinc-800/40 transition cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        onClick={() => onToggle(t)}
        className={`mt-0.5 w-[18px] h-[18px] rounded-full border-2 shrink-0 transition flex items-center justify-center ${
          t.completed
            ? "bg-emerald-500 border-emerald-500 text-zinc-950"
            : "border-zinc-600 hover:border-zinc-400"
        }`}
        title={t.completed ? "되돌리기" : "완료"}
      >
        {t.completed && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-relaxed flex items-center gap-2 ${
            t.completed ? "text-zinc-600 line-through" : "text-zinc-100"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority]}`} />
          <span className="truncate">{t.text}</span>
        </p>
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition">
          {idx > 0 && (
            <button
              onClick={() => onMove(t, order[idx - 1])}
              disabled={busy}
              title="이전 컬럼"
              className="text-[11px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800"
            >
              ←
            </button>
          )}
          {idx < order.length - 1 && (
            <button
              onClick={() => onMove(t, order[idx + 1])}
              disabled={busy}
              title="다음 컬럼"
              className="text-[11px] text-zinc-500 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800"
            >
              →
            </button>
          )}
          <button
            onClick={() => onRemove(t)}
            disabled={busy}
            title="삭제"
            className="ml-auto text-[11px] text-zinc-500 hover:text-rose-400 px-1.5 py-0.5 rounded hover:bg-rose-950/50"
          >
            삭제
          </button>
        </div>
      </div>
    </li>
  );
}


const SECTION_ACCENT: Record<string, string> = {
  "📌": "border-rose-700/40 bg-rose-950/10",
  "💼": "border-sky-700/40 bg-sky-950/10",
  "🚀": "border-purple-700/40 bg-purple-950/10",
  "🛠️": "border-amber-700/40 bg-amber-950/10",
  "👤": "border-indigo-700/40 bg-indigo-950/10",
  "🏢": "border-zinc-700 bg-zinc-950/30",
  "🎯": "border-emerald-700/40 bg-emerald-950/10",
  "⭐": "border-yellow-700/40 bg-yellow-950/10",
  "•": "border-zinc-700 bg-zinc-950/30",
};

function WeeklyCell({
  data,
  dismissedIds,
  open,
  setOpen,
  busy,
  onAccept,
  onDismiss,
}: {
  data: WeeklyData | null;
  dismissedIds: Set<string>;
  open: boolean;
  setOpen: (v: boolean) => void;
  busy: boolean;
  onAccept: (it: WeeklyItem) => void;
  onDismiss: (id: string) => void;
}) {
  if (!data || !data.available || !data.sections || data.sections.length === 0) return null;
  const totalPending = data.sections.reduce(
    (n, sec) => n + sec.items.filter((i) => !dismissedIds.has(i.id)).length,
    0,
  );
  if (totalPending === 0) return null;
  return (
    <section className="mt-6 bg-zinc-900/60 rounded-2xl border border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-amber-300 hover:bg-amber-950/20 rounded-t-2xl"
      >
        <span className="text-xs">{open ? "▾" : "▸"}</span>
        <span className="font-semibold">📋 주간 업무 — 대표님</span>
        <span className="text-xs text-amber-300/70 font-mono">
          {data.week}주차 · {data.period}
        </span>
        <span className="text-xs text-zinc-500 font-mono">({totalPending})</span>
        <a
          href={data.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[11px] text-sky-400 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          시트 열기 →
        </a>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {data.sections.map((sec) => {
            const pending = sec.items.filter((i) => !dismissedIds.has(i.id));
            if (pending.length === 0) return null;
            const accent = SECTION_ACCENT[sec.emoji] || SECTION_ACCENT["•"];
            return (
              <div key={`${sec.emoji}-${sec.label}`}>
                <h3 className="text-[12px] font-semibold text-zinc-300 mb-2">
                  {sec.emoji} {sec.label}{" "}
                  <span className="text-zinc-600 font-mono font-normal">
                    ({pending.length})
                  </span>
                </h3>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {pending.map((it) => (
                    <li
                      key={it.id}
                      className={`rounded-lg border p-2.5 transition ${accent}`}
                    >
                      <p className="text-sm text-zinc-100 leading-snug">{it.text}</p>
                      <div className="flex items-center gap-1 mt-2">
                        <button
                          onClick={() => onAccept(it)}
                          disabled={busy}
                          className="text-[11px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 border border-emerald-700/40 disabled:opacity-40"
                        >
                          + 할 일로 추가
                        </button>
                        <button
                          onClick={() => onDismiss(it.id)}
                          className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                        >
                          무시
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
