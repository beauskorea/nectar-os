"use client";
import { useEffect, useState } from "react";
import MiniDatePicker from "./MiniDatePicker";
import TimeWheelPicker from "./TimeWheelPicker";

type Tab = "todo" | "event";

type Todo = {
  id: string;
  text: string;
  status: "todo" | "doing" | "done";
  createdAt: number;
  priority: "high" | "med" | "low";
};

type QuickEvent = {
  id: string;
  title: string;
  start: string; // ISO local "YYYY-MM-DDTHH:mm:ss+09:00" or "YYYY-MM-DD" for allDay
  end: string;
  allDay: boolean;
  cal: string;
};

const TODO_KEY = "jinho-todos-v1";
const EVENT_KEY = "jinho-quick-events-v1";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadTodos(): Todo[] {
  try {
    return JSON.parse(localStorage.getItem(TODO_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveTodos(list: Todo[]) {
  localStorage.setItem(TODO_KEY, JSON.stringify(list));
}

function loadEvents(): QuickEvent[] {
  try {
    return JSON.parse(localStorage.getItem(EVENT_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveEvents(list: QuickEvent[]) {
  localStorage.setItem(EVENT_KEY, JSON.stringify(list));
}

export default function QuickCapture() {
  const [tab, setTab] = useState<Tab>("todo");
  const [mounted, setMounted] = useState(false);

  // todo form
  const [todoText, setTodoText] = useState("");
  const [priority, setPriority] = useState<"high" | "med" | "low">("med");

  // event form
  const today = new Date();
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState(ymd(today));
  const [evTime, setEvTime] = useState("");

  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<QuickEvent[]>([]);

  useEffect(() => {
    setTodos(loadTodos());
    setEvents(loadEvents());
    setMounted(true);
  }, []);

  async function addTodo(e?: React.FormEvent) {
    e?.preventDefault();
    const t = todoText.trim();
    if (!t) return;
    // Try API first (Google Tasks); fall back to localStorage on failure
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, priority, status: "todo" }),
      });
      const j = await r.json();
      if (j.todo) {
        const apiTodo: Todo = {
          id: j.todo.id,
          text: j.todo.text,
          status: "todo",
          createdAt: Math.floor(Date.now() / 1000),
          priority: j.todo.priority,
        };
        const next = [apiTodo, ...todos];
        setTodos(next);
        saveTodos(next); // local cache for offline
        setTodoText("");
        return;
      }
    } catch {}
    // fallback
    const next: Todo[] = [
      {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: t,
        status: "todo",
        createdAt: Math.floor(Date.now() / 1000),
        priority,
      },
      ...todos,
    ];
    setTodos(next);
    saveTodos(next);
    setTodoText("");
  }

  function delTodo(id: string) {
    const next = todos.filter((t) => t.id !== id);
    setTodos(next);
    saveTodos(next);
    // best-effort API delete (id may not exist on server if added during fallback)
    // we don't know the listId here — fire-and-forget with empty listId, ignore failures
    fetch(`/api/tasks/${id}?listId=`, { method: "DELETE" }).catch(() => {});
  }

  function addEvent(e?: React.FormEvent) {
    e?.preventDefault();
    const title = evTitle.trim();
    if (!title) return;
    let start: string;
    let end: string;
    let allDay = false;
    if (!evTime) {
      // all-day: end exclusive next day
      const [y, m, d] = evDate.split("-").map(Number);
      const startDate = new Date(y, m - 1, d);
      const endDate = new Date(y, m - 1, d + 1);
      start = ymd(startDate);
      end = ymd(endDate);
      allDay = true;
    } else {
      const [hh, mm] = evTime.split(":").map(Number);
      const [y, m, d] = evDate.split("-").map(Number);
      const startDate = new Date(y, m - 1, d, hh, mm);
      const endDate = new Date(y, m - 1, d, hh + 1, mm);
      const iso = (dt: Date) =>
        `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:00+09:00`;
      start = iso(startDate);
      end = iso(endDate);
    }
    const next: QuickEvent[] = [
      {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        start,
        end,
        allDay,
        cal: "beauskorea",
      },
      ...events,
    ];
    setEvents(next);
    saveEvents(next);
    setEvTitle("");
    setEvTime("");
  }

  function delEvent(id: string) {
    const next = events.filter((e) => e.id !== id);
    setEvents(next);
    saveEvents(next);
  }

  if (!mounted) {
    return (
      <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 min-h-[120px]" />
    );
  }

  const PRI_LABEL = { high: "🔴 high", med: "🟡 med", low: "⚪ low" } as const;
  const recentTodos = todos.slice(0, 4);
  const recentEvents = events.slice(0, 4);

  return (
    <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setTab("todo")}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === "todo"
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-100"
          }`}
        >
          ✅ 할 일
        </button>
        <button
          onClick={() => setTab("event")}
          className={`px-3 py-1.5 rounded-lg text-sm transition ${
            tab === "event"
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-100"
          }`}
        >
          📅 일정
        </button>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono">
          {tab === "todo" ? "→ /todos" : "→ /calendar"}
        </span>
      </div>

      {tab === "todo" ? (
        <>
          <form onSubmit={addTodo} className="flex gap-2">
            <input
              autoFocus
              value={todoText}
              onChange={(e) => setTodoText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  // Prevent IME Enter from submitting the form
                  if (e.key === "Enter") e.stopPropagation();
                }
              }}
              placeholder="할 일을 빠르게 입력… (Enter)"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <div className="flex gap-1">
              {(["high", "med", "low"] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`px-2 py-2 rounded-lg text-xs border ${
                    priority === p
                      ? "border-zinc-300 text-zinc-100"
                      : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
                  }`}
                >
                  {PRI_LABEL[p]}
                </button>
              ))}
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-emerald-500 text-zinc-900 text-sm font-medium hover:bg-emerald-400"
            >
              추가
            </button>
          </form>
          {recentTodos.length > 0 && (
            <ul className="mt-3 space-y-1">
              {recentTodos.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 text-sm text-zinc-300 group"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      t.priority === "high"
                        ? "bg-rose-400"
                        : t.priority === "med"
                          ? "bg-amber-400"
                          : "bg-zinc-600"
                    }`}
                  />
                  <span className="flex-1 truncate">{t.text}</span>
                  <span className="text-[10px] text-zinc-600 font-mono">
                    {t.status}
                  </span>
                  <button
                    onClick={() => delTodo(t.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-zinc-500 hover:text-rose-400"
                    title="삭제"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <form onSubmit={addEvent} className="flex gap-2 flex-wrap">
            <input
              autoFocus
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  if (e.key === "Enter") e.stopPropagation();
                }
              }}
              placeholder="일정 제목… (Enter)"
              className="flex-1 min-w-[180px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <MiniDatePicker value={evDate} onChange={setEvDate} />
            <TimeWheelPicker value={evTime} onChange={setEvTime} className="w-24" />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-sky-500 text-zinc-900 text-sm font-medium hover:bg-sky-400"
            >
              추가
            </button>
          </form>
          <p className="text-[10px] text-zinc-600 mt-2">
            시간 비우면 종일 일정 · 캘린더 페이지 월뷰에도 함께 표시됨 (cyan)
          </p>
          {recentEvents.length > 0 && (
            <ul className="mt-3 space-y-1">
              {recentEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 text-sm text-zinc-300 group"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-cyan-400" />
                  <span className="font-mono text-xs text-zinc-500 w-28 shrink-0">
                    {e.allDay
                      ? `${e.start} 종일`
                      : e.start.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="flex-1 truncate">{e.title}</span>
                  <button
                    onClick={() => delEvent(e.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-zinc-500 hover:text-rose-400"
                    title="삭제"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
