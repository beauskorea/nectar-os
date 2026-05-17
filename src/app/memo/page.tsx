"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type NoteListItem = {
  id: string;
  title: string;
  preview: string;
  folder: string;
  account: string;
  modified_at: string;
  created_at: string;
  pinned: number;
  board: string;
  team: string;
};

type NoteFull = NoteListItem & { body: string; plain: string };

const TEAM_OPTIONS = [
  "주간회의",
  "바이럴파트",
  "임원",
  "마케팅",
  "운영",
  "디자인",
  "개발",
  "재무",
];

type ListResponse = {
  notes: NoteListItem[];
  total: number;
  folders: { folder: string; c: number }[];
  last_sync_at: string | null;
};

function fmtRel(s: string): string {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  if (isNaN(d.getTime())) return s;
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

type ChatMsg = { role: "user" | "assistant"; content: string };

export default function MemoPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 px-6 py-6 text-zinc-500 text-sm">불러오는 중…</div>}>
      <MemoPage />
    </Suspense>
  );
}

function MemoPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [boardFilter, setBoardFilter] = useState<string>("");

  const searchParams = useSearchParams();
  const spBoard = searchParams.get("board") || "";
  const spTeam = searchParams.get("team") || "";
  useEffect(() => {
    setBoardFilter(spBoard);
    setTeamFilter(spTeam);
    setSelectedId(null);
  }, [spBoard, spTeam]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<NoteFull | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSavedAt, setEditSavedAt] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editDirty, setEditDirty] = useState(false);

  const [aiOpen, setAiOpen] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiHistory, setAiHistory] = useState<ChatMsg[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDeep, setAiDeep] = useState(false);
  const [transferMsg, setTransferMsg] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  const debouncedQ = useDebounced(q, 200);

  async function fetchList() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (folder) params.set("folder", folder);
      if (teamFilter) params.set("team", teamFilter);
      if (boardFilter) params.set("board", boardFilter);
      params.set("limit", "300");
      const r = await fetch(`/api/memo?${params.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ListResponse | { error: string };
      if ("error" in j) {
        setError(j.error);
        setData(null);
      } else {
        setError(null);
        setData(j);
        if (!selectedId && j.notes.length > 0) setSelectedId(j.notes[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, folder, teamFilter, boardFilter]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setEditTitle("");
      setEditBody("");
      setEditDirty(false);
      setAiHistory([]);
      return;
    }
    setSelLoading(true);
    setEditDirty(false);
    setAiHistory([]);
    fetch(`/api/memo/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.note) {
          const note = j.note as NoteFull;
          setSelected(note);
          const p = note.plain || "";
          const nl = p.indexOf("\n");
          if (nl === -1) {
            setEditTitle(p);
            setEditBody("");
          } else {
            setEditTitle(p.slice(0, nl));
            setEditBody(p.slice(nl + 1).replace(/^\n/, ""));
          }
          setEditSavedAt(note.modified_at || "");
        } else {
          setSelected(null);
        }
      })
      .catch(() => setSelected(null))
      .finally(() => setSelLoading(false));
  }, [selectedId]);

  const combinedEdit = editTitle + (editBody ? "\n\n" + editBody : "");
  const debouncedEdit = useDebounced(combinedEdit, 1000);
  useEffect(() => {
    if (!selectedId || !editDirty) return;
    setEditSaving(true);
    fetch(`/api/memo/${encodeURIComponent(selectedId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plain: debouncedEdit }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setEditSavedAt(new Date().toISOString().replace("T", " ").slice(0, 19));
          setEditDirty(false);
        }
      })
      .finally(() => setEditSaving(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedEdit]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        createNew();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createNew() {
    const r = await fetch("/api/memo/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plain: "" }),
    });
    const j = await r.json();
    if (j.id) {
      await fetchList();
      setSelectedId(j.id);
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }

  function meetingTemplate(team: string): string {
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `[회의록] ${team} ${dateStr}

참석:

의제:

논의:
  -

결정:
  -

액션:
  - [ ]

다음 미팅:`;
  }

  async function createMeetingNote(team: string) {
    setMeetingMenuOpen(false);
    const plain = meetingTemplate(team);
    const r = await fetch("/api/memo/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plain, board: "company", team }),
    });
    const j = await r.json();
    if (j.id) {
      await fetchList();
      setSelectedId(j.id);
      setTimeout(() => bodyRef.current?.focus(), 100);
    }
  }

  async function togglePin() {
    if (!selected) return;
    const newPinned = selected.pinned ? false : true;
    await fetch(`/api/memo/${encodeURIComponent(selected.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: newPinned }),
    });
    setSelected({ ...selected, pinned: newPinned ? 1 : 0 });
    fetchList();
  }

  async function setBoard(b: string) {
    if (!selected) return;
    setSelected({ ...selected, board: b, team: b ? selected.team : "" });
    await fetch(`/api/memo/${encodeURIComponent(selected.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: b, ...(b ? {} : { team: "" }) }),
    });
    fetchList();
  }

  async function setTeam(t: string) {
    if (!selected) return;
    setSelected({ ...selected, team: t });
    await fetch(`/api/memo/${encodeURIComponent(selected.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team: t }),
    });
    fetchList();
  }

  async function deleteCurrent() {
    if (!selected) return;
    if (!confirm(`"${selected.title || "(제목 없음)"}"를 삭제할까요?\n(맥 메모에서도 5분 이내 삭제됩니다)`)) return;
    await fetch(`/api/memo/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
    setSelectedId(null);
    await fetchList();
  }

  function insertChecklistAtCursor() {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const value = editBody;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const before = value.slice(0, lineStart);
    const after = value.slice(lineStart);
    const insertion = "[ ] ";
    const next = before + insertion + after;
    setEditBody(next);
    setEditDirty(true);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = lineStart + insertion.length;
    }, 0);
  }

  function toggleChecklistOnSelection() {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const value = editBody;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = value.indexOf("\n", start);
    const end = lineEnd === -1 ? value.length : lineEnd;
    const line = value.slice(lineStart, end);
    let next: string;
    if (/^\[ \] /.test(line)) next = value.slice(0, lineStart) + "[x] " + line.slice(4) + value.slice(end);
    else if (/^\[x\] /.test(line)) next = value.slice(0, lineStart) + line.slice(4) + value.slice(end);
    else next = value.slice(0, lineStart) + "[ ] " + line + value.slice(end);
    setEditBody(next);
    setEditDirty(true);
  }

  async function sendAi(prompt: string) {
    if (!selectedId || !prompt.trim()) return;
    const userMsg: ChatMsg = { role: "user", content: prompt };
    const nextHist = [...aiHistory, userMsg];
    setAiHistory(nextHist);
    setAiPrompt("");
    setAiBusy(true);
    try {
      const r = await fetch(`/api/memo/${encodeURIComponent(selectedId)}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, deep: aiDeep, history: aiHistory }),
      });
      const j = await r.json();
      if (j.answer) {
        setAiHistory([...nextHist, { role: "assistant", content: j.answer }]);
      } else {
        setAiHistory([...nextHist, { role: "assistant", content: `오류: ${j.error || "응답 없음"}` }]);
      }
    } catch (e) {
      setAiHistory([...nextHist, { role: "assistant", content: `오류: ${(e as Error).message}` }]);
    } finally {
      setAiBusy(false);
    }
  }

  async function transferToTodos() {
    if (!selectedId || transferBusy) return;
    setTransferBusy(true);
    setTransferMsg("AI가 할 일 추출 중...");
    try {
      const r = await fetch(`/api/memo/${encodeURIComponent(selectedId)}/extract-todos`, { method: "POST" });
      const j = await r.json();
      if (j.error === "tasks_not_configured") {
        setTransferMsg(`⚠ Google Tasks 미설정. 추출됨 ${j.items?.length || 0}개 (추가 안 됨)`);
      } else if (j.ok) {
        const n = (j.added || []).length;
        setTransferMsg(n === 0 ? "추출된 할 일 없음" : `✓ /todos에 ${n}개 추가됨`);
      } else {
        setTransferMsg(`오류: ${j.error}`);
      }
    } catch (e) {
      setTransferMsg(`오류: ${(e as Error).message}`);
    } finally {
      setTransferBusy(false);
      setTimeout(() => setTransferMsg(null), 8000);
    }
  }

  const grouped = useMemo(() => {
    if (!data) return [] as { label: string; items: NoteListItem[] }[];
    const pinned = data.notes.filter((n) => n.pinned);
    const rest = data.notes.filter((n) => !n.pinned);
    const groups: Record<string, NoteListItem[]> = {
      "오늘": [],
      "어제": [],
      "이전 7일": [],
      "이전 30일": [],
      "이전": [],
    };
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDay = 86400_000;
    for (const n of rest) {
      const d = new Date((n.modified_at || "").replace(" ", "T") + "Z");
      const ts = d.getTime();
      if (isNaN(ts)) groups["이전"].push(n);
      else if (ts >= startOfToday) groups["오늘"].push(n);
      else if (ts >= startOfToday - oneDay) groups["어제"].push(n);
      else if (ts >= startOfToday - 7 * oneDay) groups["이전 7일"].push(n);
      else if (ts >= startOfToday - 30 * oneDay) groups["이전 30일"].push(n);
      else groups["이전"].push(n);
    }
    const out: { label: string; items: NoteListItem[] }[] = [];
    if (pinned.length) out.push({ label: "📌 핀", items: pinned });
    for (const [label, items] of Object.entries(groups)) {
      if (items.length) out.push({ label, items });
    }
    return out;
  }, [data]);

  return (
    <div className="-mx-0 min-h-screen bg-zinc-950">
      <div className="px-6 py-6">
        <header className="mb-4 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-zinc-100 font-semibold text-lg">📝 메모장</h1>
          <span className="text-xs text-zinc-500">
            {data ? `${data.total.toLocaleString()}개` : "…"}
            {data?.last_sync_at && ` · 마지막 sync ${fmtRel(data.last_sync_at)}`}
          </span>
          <button
            onClick={createNew}
            className="text-xs text-zinc-100 px-3 py-1 rounded bg-sky-700/70 hover:bg-sky-600 border border-sky-500"
          >
            + 새 메모 <span className="text-zinc-300/70">⌘N</span>
          </button>
          <button
            onClick={fetchList}
            disabled={loading}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-800 border border-transparent hover:border-zinc-700"
          >
            ↻ {loading ? "..." : "새로고침"}
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300 font-mono">
            {error}
          </div>
        )}

        <div className="mb-3 flex gap-2 flex-wrap">
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색 (⌘K)"
            className="flex-1 min-w-[200px] rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          {data && data.folders.length > 1 && (
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none"
            >
              <option value="">전체 폴더</option>
              {data.folders.map((f) => (
                <option key={f.folder} value={f.folder}>
                  {f.folder || "(없음)"} ({f.c})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={`grid grid-cols-1 ${aiOpen ? "lg:grid-cols-[300px_1fr_340px]" : "lg:grid-cols-[300px_1fr]"} gap-4 min-h-[70vh]`}>
          {/* LIST */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto max-h-[80vh]">
              {!data && loading && <div className="px-3 py-6 text-center text-xs text-zinc-500">불러오는 중…</div>}
              {data && data.notes.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-zinc-500">
                  {q ? `"${q}" 결과 없음` : "메모 없음"}
                </div>
              )}
              {grouped.map((g) => (
                <div key={g.label}>
                  <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                    {g.label}
                  </div>
                  {g.items.map((n) => {
                    const on = selectedId === n.id;
                    return (
                      <button
                        key={n.id}
                        onClick={() => setSelectedId(n.id)}
                        className={`w-full text-left px-3 py-2 border-b border-zinc-800/60 transition ${
                          on ? "bg-zinc-800/70" : "hover:bg-zinc-800/30"
                        }`}
                      >
                        <div className="flex items-baseline gap-2">
                          {n.pinned ? <span className="text-amber-400 text-xs">📌</span> : null}
                          <div className="flex-1 text-sm text-zinc-100 truncate font-medium">
                            {n.title || "(제목 없음)"}
                          </div>
                          <div className="text-[10px] text-zinc-500 shrink-0">{fmtRel(n.modified_at)}</div>
                        </div>
                        {n.preview && <div className="mt-0.5 text-xs text-zinc-500 truncate">{n.preview}</div>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* BODY */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 overflow-hidden flex flex-col">
            {selLoading && <div className="px-6 py-10 text-center text-xs text-zinc-500">불러오는 중…</div>}
            {!selLoading && !selected && (
              <div className="px-6 py-10 text-center text-xs text-zinc-500">왼쪽에서 메모를 선택하거나 + 새 메모</div>
            )}
            {selected && (
              <div className="flex flex-col h-full max-h-[80vh] px-6 py-5">
                <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap">
                    <span>
                      {selected.folder || "메모"}
                      {selected.modified_at && <span> · 수정 {fmtRel(editSavedAt || selected.modified_at)}</span>}
                      <span className="ml-2 text-zinc-600">{editSaving ? "저장 중…" : editDirty ? "변경됨…" : "✓ 저장됨"}</span>
                    </span>
                    <span className="text-zinc-700">·</span>
                    <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
                      {(["company", "personal"] as const).map((b) => {
                        const on = selected.board === b;
                        return (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setBoard(b)}
                            className={`px-2 py-0.5 text-[11px] transition ${
                              on
                                ? b === "company"
                                  ? "bg-sky-700/70 text-sky-50"
                                  : "bg-emerald-700/70 text-emerald-50"
                                : "bg-zinc-900/40 text-zinc-500 hover:text-zinc-200"
                            }`}
                          >
                            {b === "company" ? "🏢 회사" : "🏠 개인"}
                          </button>
                        );
                      })}
                      {selected.board && (
                        <button
                          type="button"
                          onClick={() => setBoard("")}
                          title="분류 해제"
                          className="px-1.5 py-0.5 text-[11px] text-zinc-600 hover:text-rose-300 border-l border-zinc-700"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {selected.board === "company" && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {TEAM_OPTIONS.map((t) => {
                            const on = selected.team === t;
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setTeam(on ? "" : t)}
                                className={`px-2 py-0.5 text-[11px] rounded border transition ${
                                  on
                                    ? "bg-sky-700/70 text-sky-50 border-sky-500"
                                    : "border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500"
                                }`}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={togglePin}
                      title={selected.pinned ? "핀 해제" : "상단 고정"}
                      className={`px-2 py-1 rounded text-xs border ${
                        selected.pinned
                          ? "bg-amber-900/40 text-amber-200 border-amber-700/60"
                          : "border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-700/60"
                      }`}
                    >
                      📌
                    </button>
                    <button
                      onClick={() => setAiOpen((v) => !v)}
                      title="AI 패널"
                      className={`px-2 py-1 rounded text-xs border ${
                        aiOpen
                          ? "bg-sky-900/40 text-sky-200 border-sky-700/60"
                          : "border-zinc-700 text-zinc-400 hover:text-sky-300 hover:border-sky-700/60"
                      }`}
                    >
                      🤖
                    </button>
                    <button
                      onClick={deleteCurrent}
                      title="삭제"
                      className="px-2 py-1 rounded text-xs border border-zinc-700 text-zinc-400 hover:text-rose-300 hover:border-rose-700/60"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <input
                  ref={titleRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                    setEditDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      bodyRef.current?.focus();
                    }
                  }}
                  placeholder="제목"
                  className="mb-2 w-full rounded border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xl font-bold text-zinc-50 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none"
                  spellCheck={false}
                />
                <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <button onClick={insertChecklistAtCursor} className="px-2 py-0.5 rounded border border-zinc-700 hover:text-zinc-100 hover:border-zinc-500">
                    + [ ] 체크박스
                  </button>
                  <button onClick={toggleChecklistOnSelection} className="px-2 py-0.5 rounded border border-zinc-700 hover:text-zinc-100 hover:border-zinc-500">
                    ☐ 줄 토글
                  </button>
                  <span className="text-zinc-600">맥 sync 5분 이내</span>
                </div>
                <textarea
                  ref={bodyRef}
                  value={editBody}
                  onChange={(e) => {
                    setEditBody(e.target.value);
                    setEditDirty(true);
                  }}
                  className="flex-1 resize-none rounded border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none font-sans whitespace-pre-wrap"
                  placeholder="본문… (Tip: '[ ] 할일' 형식 사용 가능)"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {/* AI PANEL */}
          {aiOpen && (
            <div className="rounded-lg border border-sky-900/40 bg-sky-950/10 overflow-hidden flex flex-col max-h-[80vh]">
              <div className="px-4 py-3 border-b border-sky-900/40 flex items-center justify-between">
                <div className="text-xs font-semibold text-sky-200">🤖 AI 도우미</div>
                <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer">
                  <input type="checkbox" checked={aiDeep} onChange={(e) => setAiDeep(e.target.checked)} className="accent-sky-500" />
                  Opus
                </label>
              </div>

              <div className="px-3 py-2 border-b border-sky-900/40 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">빠른 액션</div>
                <button
                  onClick={transferToTodos}
                  disabled={!selectedId || transferBusy}
                  className="w-full text-left text-xs px-2 py-1.5 rounded border border-sky-800/60 bg-sky-900/30 text-sky-100 hover:bg-sky-800/50 disabled:opacity-50"
                >
                  ✅ → /todos 할일로 추출
                </button>
                <button
                  onClick={() => sendAi("이 메모를 3줄로 요약해줘.")}
                  disabled={!selectedId || aiBusy}
                  className="w-full text-left text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800/50 disabled:opacity-50"
                >
                  📝 3줄 요약
                </button>
                <button
                  onClick={() => sendAi("이 메모의 핵심 액션 아이템 5개를 뽑아줘.")}
                  disabled={!selectedId || aiBusy}
                  className="w-full text-left text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800/50 disabled:opacity-50"
                >
                  🎯 액션 아이템 추출
                </button>
                <button
                  onClick={() => sendAi("이 메모를 영어로 자연스럽게 번역해줘.")}
                  disabled={!selectedId || aiBusy}
                  className="w-full text-left text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800/50 disabled:opacity-50"
                >
                  🌐 영어 번역
                </button>
                {transferMsg && (
                  <div className="mt-2 text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded px-2 py-1">
                    {transferMsg}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs">
                {aiHistory.length === 0 && (
                  <div className="text-zinc-600 text-center mt-6">
                    현재 메모를 컨텍스트로 자유롭게 물어보세요.
                    <div className="mt-2 text-zinc-700">예: &quot;핵심만 정리&quot;, &quot;다음 미팅 안건 만들어&quot;</div>
                  </div>
                )}
                {aiHistory.map((m, i) => (
                  <div key={i} className={`rounded px-2 py-1.5 ${m.role === "user" ? "bg-zinc-800/60 text-zinc-100" : "bg-sky-900/20 text-sky-100"}`}>
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-0.5">{m.role === "user" ? "나" : "AI"}</div>
                    <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  </div>
                ))}
                {aiBusy && <div className="text-zinc-500 text-center">생각 중…</div>}
              </div>

              <div className="px-3 py-2 border-t border-sky-900/40">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!aiBusy) sendAi(aiPrompt);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder={selectedId ? "AI에게 명령..." : "먼저 메모 선택"}
                    disabled={!selectedId || aiBusy}
                    className="flex-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!selectedId || aiBusy || !aiPrompt.trim()}
                    className="text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white border border-sky-500 disabled:opacity-40"
                  >
                    →
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
