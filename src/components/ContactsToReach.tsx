"use client";
import { useEffect, useState } from "react";

type Person = {
  name: string;
  role: string;
  kind: string;
  handle: string;
  lastContact: string;
  lastContactTs: number;
  lastContactSource: string;
  overdue: boolean;
  freqDays: number;
  note: string;
};

type PeopleFile = {
  updatedAt?: number;
  people?: Person[];
};

const KIND_LABEL: Record<string, string> = {
  internal: "내부",
  client: "클라",
  press: "기자",
  analyst: "애널",
  external: "외부",
  family: "가족",
};

const KIND_COLOR: Record<string, string> = {
  internal: "text-sky-300 bg-sky-500/15 border-sky-700/40",
  client: "text-emerald-300 bg-emerald-500/15 border-emerald-700/40",
  press: "text-amber-300 bg-amber-500/15 border-amber-700/40",
  analyst: "text-violet-300 bg-violet-500/15 border-violet-700/40",
  external: "text-zinc-300 bg-zinc-700/30 border-zinc-700",
  family: "text-rose-300 bg-rose-500/15 border-rose-700/40",
};

export default function ContactsToReach() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/people.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: PeopleFile) => {
          if (!alive) return;
          if (Array.isArray(d?.people)) {
            setPeople(d.people);
            setErr(null);
          } else {
            setErr("schema invalid");
          }
          setLoaded(true);
        })
        .catch((e) => {
          if (!alive) return;
          setErr(String(e?.message || e));
          setLoaded(true);
        });
    };
    load();
    const t = setInterval(load, 5 * 60_000); // 5분 폴링
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // overdue 인 사람 우선, 그 다음 lastContactTs 오래된 순. 최대 8명.
  const overdue = people
    .filter((p) => p.overdue)
    .sort((a, b) => (a.lastContactTs || 0) - (b.lastContactTs || 0));
  const list = overdue.slice(0, 8);

  function copyHandle(h: string) {
    if (!h) return;
    navigator.clipboard?.writeText(h).then(() => {
      setCopied(h);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-zinc-100 font-semibold text-[15px]">
            👥 컨택해야 할 사람
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            overdue · 오래된 순 · freqDays 초과
          </p>
        </div>
        <a
          href="/people"
          className="text-xs text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
        >
          전체 인맥 →
        </a>
      </header>

      {!loaded ? (
        <p className="text-xs text-zinc-600">로딩…</p>
      ) : err ? (
        <p className="text-xs text-rose-400">불러오기 실패: {err}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-zinc-500">놓친 사람 없음 ✓</p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {list.map((p) => (
            <li
              key={p.name + p.handle}
              className="py-2 flex items-center gap-3 text-sm"
            >
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0 ${
                  KIND_COLOR[p.kind] || KIND_COLOR.external
                }`}
              >
                {KIND_LABEL[p.kind] || p.kind}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-zinc-100 font-medium truncate">{p.name}</span>
                  <span className="text-[11px] text-zinc-500 truncate">{p.role}</span>
                </div>
                {p.note && (
                  <p className="text-[11px] text-zinc-600 truncate mt-0.5">{p.note}</p>
                )}
              </div>
              <span className="text-[11px] text-rose-300 shrink-0 font-mono">
                {p.lastContact}
              </span>
              {p.handle && (
                <button
                  onClick={() => copyHandle(p.handle)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-100 px-2 py-0.5 rounded hover:bg-zinc-800 font-mono shrink-0"
                  title="핸들 복사"
                >
                  {copied === p.handle ? "✓" : p.handle}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
