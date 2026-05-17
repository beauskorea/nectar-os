"use client";
import { useEffect, useState } from "react";

type Person = {
  name: string;
  role: string;
  kind: string;
  handle: string;
  lastContact: string;
  lastContactTs: number;
  overdue: boolean;
  note?: string;
};

type PeopleFile = { updatedAt?: number; people?: Person[] };

// 홈 카드 사이즈 — 컴팩트 (top 3)
export default function OverduePeopleCard() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/people.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: PeopleFile) => {
          if (!alive) return;
          if (Array.isArray(d?.people)) setPeople(d.people);
          setLoaded(true);
        })
        .catch(() => alive && setLoaded(true));
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const overdue = people
    .filter((p) => p.overdue)
    .sort((a, b) => (a.lastContactTs || 0) - (b.lastContactTs || 0));
  const top = overdue.slice(0, 3);

  return (
    <a
      href="/todos"
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-600 transition"
      title="전체 리스트는 /todos 하단"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">👥 챙길 인맥</h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          {loaded ? `${overdue.length} overdue` : "로딩…"}
        </span>
      </div>
      {!loaded ? (
        <p className="text-sm text-zinc-600">로딩…</p>
      ) : top.length === 0 ? (
        <p className="text-sm text-zinc-500">놓친 사람 없음 ✓</p>
      ) : (
        <ul className="space-y-2">
          {top.map((p) => (
            <li
              key={p.name + p.handle}
              className="flex items-baseline gap-3 text-sm"
            >
              <span className="text-zinc-200 w-24 shrink-0 truncate">{p.name}</span>
              <span className="text-xs text-zinc-500 flex-1 truncate">{p.role}</span>
              <span className="text-xs text-rose-400 shrink-0">{p.lastContact}</span>
            </li>
          ))}
        </ul>
      )}
    </a>
  );
}
