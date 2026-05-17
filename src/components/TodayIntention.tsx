"use client";
import { useEffect, useState } from "react";

// 날짜별 인텐션 1줄 — KST 기준 YYYY-MM-DD 키로 localStorage 저장
// 자정 넘으면 새 인텐션 입력 받음 (어제 거 자동으로 "어제 인텐션" 으로 노출)

const STORAGE_KEY = "jinho-os:intention:v1";

type IntentionMap = Record<string, string>;

function todayKstKey(d: Date = new Date()): string {
  // Asia/Seoul 기준 YYYY-MM-DD
  const opts = { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" } as const;
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${dd}`;
}

function loadMap(): IntentionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IntentionMap) : {};
  } catch {
    return {};
  }
}

function saveMap(map: IntentionMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export default function TodayIntention() {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [yesterdayText, setYesterdayText] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const map = loadMap();
    const todayKey = todayKstKey();
    const yKey = todayKstKey(new Date(Date.now() - 86400_000));
    setText(map[todayKey] || "");
    setYesterdayText(map[yKey] || null);
    setMounted(true);
  }, []);

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    const map = loadMap();
    const key = todayKstKey();
    if (trimmed) map[key] = trimmed;
    else delete map[key];
    saveMap(map);
    setText(trimmed);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  if (!mounted) {
    return (
      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="text-[10px] uppercase text-zinc-500 mb-1">오늘의 인텐션</p>
        <p className="text-zinc-600 text-sm leading-relaxed">로딩…</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] uppercase text-zinc-500">오늘의 인텐션</p>
        {!editing && text && (
          <button
            onClick={startEdit}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            ✎ 수정
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                cancel();
              }
            }}
            placeholder="오늘 자기에게 거는 한 줄 — ⌘+Enter 저장, Esc 취소"
            rows={2}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              className="px-3 py-1 rounded text-xs bg-zinc-100 text-zinc-900 hover:bg-white"
            >
              저장
            </button>
            <button
              onClick={cancel}
              className="px-3 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200"
            >
              취소
            </button>
            <span className="ml-auto text-[10px] text-zinc-600 font-mono">
              ⌘+Enter / Esc
            </span>
          </div>
        </div>
      ) : text ? (
        <p className="text-zinc-100 text-sm leading-relaxed">{text}</p>
      ) : (
        <button
          onClick={startEdit}
          className="text-sm text-zinc-500 hover:text-zinc-300 italic"
        >
          + 오늘 자기에게 거는 한 줄
        </button>
      )}

      {yesterdayText && !editing && (
        <p className="mt-3 pt-3 border-t border-zinc-800/60 text-[11px] text-zinc-600 italic">
          어제: {yesterdayText}
        </p>
      )}
    </div>
  );
}
