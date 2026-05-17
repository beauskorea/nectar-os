"use client";
import { Fragment, useEffect, useMemo, useState } from "react";

type Cat = "client" | "sales" | "finance" | "urgent" | "event" | "lecture" | "news" | "noise" | "pending";

const CAT_META: Record<Cat, { label: string; emoji: string; color: string }> = {
  client:  { label: "클라",     emoji: "💼", color: "text-emerald-400" },
  sales:   { label: "영업",     emoji: "🤝", color: "text-indigo-400"  },
  finance: { label: "정산",     emoji: "💰", color: "text-amber-400"   },
  urgent:  { label: "긴급",     emoji: "🚨", color: "text-rose-400"    },
  event:   { label: "행사",     emoji: "🎤", color: "text-violet-400"  },
  lecture: { label: "강의",     emoji: "🎓", color: "text-teal-400"    },
  news:    { label: "정보",     emoji: "📰", color: "text-sky-400"     },
  noise:   { label: "노이즈",   emoji: "🗑",  color: "text-zinc-500"    },
  pending: { label: "미분류",   emoji: "·",   color: "text-zinc-600"   },
};
const CAT_ORDER: Cat[] = ["client","sales","finance","urgent","event","lecture","news","noise","pending"];

type MatrixRow = { date: string; total: number } & Record<Cat, number>;
type Sender = { sender: string; n: number };
type Brand = { tag: string; n: number };
type DaySubject = { sender: string; subject: string; cat?: string | null };
type DayDetail = {
  date: string;
  top_brands: Brand[];
  top_senders: Sender[];
  subjects: {
    client: DaySubject[];
    event: DaySubject[];
    sales: DaySubject[];
    high_priority: DaySubject[];
  };
  summary: string | null;
  summary_model: string | null;
  summary_created_at: number | null;
};
type Insights = {
  updated_at: number;
  totals: { total: number; classified: number; pending: number; coverage_pct: number };
  today: Array<{ id: string; ts: number; from: string; subject: string; category: Cat | null; priority: string | null; summary: string }>;
  today_hours: Array<{ hour: number; n: number }>;
  weekday_30d: Array<{ w: number; n: number }>;
  matrix_14d: MatrixRow[];
  matrix_30d: MatrixRow[];
  brands_30d: Brand[];
  top_senders: Record<"client" | "sales" | "finance" | "event", Sender[]>;
  days: DayDetail[];
  cleanup: {
    noise_to_trash: Array<{ id: string; ts: number; sender: string; subject: string }>;
    newsletters: Array<{ sender: string; from_addr: string; n: number }>;
    mass_blasters: Array<{ sender: string; from_addr: string; n: number }>;
    pending_uncategorized: number;
  };
  sales_inbox: {
    total: number;
    legacy_total?: number;
    window_days?: number;
    last_activity_ts: number | null;
    companies_count?: number;
    recent: Array<{ company: string; n: number; last_ts: number; last_subject: string; last_sender: string; days_since?: number }>;
    today_actions: Array<{ company: string; action: string; last_ts: number; last_subject: string; days_since: number }>;
    recent_mails: Array<{ id: string; ts: number; sender: string; subject: string }>;
  };
};

type Proposal = {
  message_id: string;
  date_ts: number;
  source_subject: string;
  source_sender: string;
  brand: string | null;
  budget: string | null;
  conditions: string | null;
  deadline: string | null;
  summary: string;
  status: string;
  model: string;
  created_at: number;
};

function BrandProposalsSection() {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  const fetchCached = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/mail/insights/brand-proposals", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setItems(j.proposals || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const extract = async () => {
    setLoading(true);
    setErr(null);
    setExtractStatus("LLM 추출 중… (메일당 ~3초)");
    try {
      const r = await fetch("/api/mail/insights/brand-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setItems(j.proposals || []);
      setExtractStatus(`+${j.added}건 (검사 ${j.examined}, skip ${j.skipped}) · ${Math.round((j.elapsed_ms || 0) / 1000)}s`);
    } catch (e) {
      setErr(String(e));
      setExtractStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCached(); }, []);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">🆕 신규 브랜드 제안 — 예산·조건 추출</h2>
        <div className="flex items-center gap-2 text-[10px]">
          {extractStatus && <span className="text-zinc-500">{extractStatus}</span>}
          <button
            onClick={extract}
            disabled={loading}
            className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-200 border border-emerald-800/50 disabled:opacity-50"
          >
            {loading ? "추출 중…" : "🤖 새 메일 8건 추출"}
          </button>
        </div>
      </div>
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      {!items && loading && <p className="text-xs text-zinc-500">로딩…</p>}
      {items && items.length === 0 && (
        <p className="text-xs text-zinc-500">
          아직 추출된 제안이 없어요. &quot;새 메일 추출&quot; 버튼을 누르면 sales/미분류 메일 중 예산·조건 키워드 있는 건을 LLM이 분석합니다.
        </p>
      )}
      {items && items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((p) => (
            <div key={p.message_id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-emerald-300 truncate">
                  {p.brand || "(브랜드 미상)"}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                  {new Date(p.date_ts * 1000).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                </span>
              </div>
              <div className="text-zinc-300">{p.summary}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                {p.budget && <div><span className="text-zinc-500">💰 </span><span className="text-amber-300">{p.budget}</span></div>}
                {p.deadline && <div><span className="text-zinc-500">⏰ </span><span className="text-rose-300">{p.deadline}</span></div>}
                {p.conditions && <div className="col-span-2"><span className="text-zinc-500">📋 </span><span className="text-zinc-300">{p.conditions}</span></div>}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
                <span className="text-[10px] text-zinc-600 truncate">{p.source_sender}</span>
                <span className="text-[10px] text-zinc-700 font-mono">{p.model.replace("claude-", "").replace("sonar-", "")}</span>
              </div>
              <div className="text-[10px] text-zinc-600 truncate">{p.source_subject}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function isoKST(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function SummaryBlock({ text }: { text: string }) {
  return (
    <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed font-[450]">
      {text}
    </div>
  );
}

// FNV-1a hash → short stable id
function hashLine(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type Decision = { date: string; line_hash: string; decision: "done" | "skip" | "ignore"; line_text?: string; decided_at?: number };

function ActionableSummary({ text, date }: { text: string; date: string }) {
  const [decisions, setDecisions] = useState<Record<string, Decision["decision"]>>({});
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/mail/insights/decisions?date=${date}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const map: Record<string, Decision["decision"]> = {};
        for (const d of j.decisions || []) map[d.line_hash] = d.decision;
        setDecisions(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { alive = false; };
  }, [date]);

  const sync = async (hash: string, lineText: string, decision: Decision["decision"]) => {
    setBusyHash(hash);
    const prev = decisions[hash];
    setDecisions((d) => ({ ...d, [hash]: decision }));
    try {
      if (prev === decision) {
        // 같은 결정 다시 누르면 해제 (toggle off)
        await fetch("/api/mail/insights/decisions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date, line_hash: hash }),
        });
        setDecisions((d) => {
          const next = { ...d };
          delete next[hash];
          return next;
        });
      } else {
        await fetch("/api/mail/insights/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date, line_hash: hash, decision, line_text: lineText }),
        });
      }
    } catch {
      setDecisions((d) => ({ ...d, [hash]: prev as Decision["decision"] }));
    } finally {
      setBusyHash(null);
    }
  };

  const lines = text.split("\n");
  // 액션 라인 = "-" 로 시작 (불릿)
  const isActionLine = (s: string) => /^\s*-\s+/.test(s);

  return (
    <div className="text-sm text-zinc-200 leading-relaxed font-[450] space-y-0.5">
      {lines.map((ln, idx) => {
        if (!isActionLine(ln)) {
          return <div key={idx} className="whitespace-pre-wrap">{ln}</div>;
        }
        const content = ln.replace(/^\s*-\s+/, "").trim();
        const hash = hashLine(content);
        const decision = decisions[hash];
        const isBusy = busyHash === hash;
        const decoStyle = decision === "done" ? "line-through text-zinc-500"
          : decision === "ignore" ? "line-through text-zinc-700"
          : "";
        return (
          <div key={idx} className="flex items-start gap-2 group py-0.5">
            <span className="text-zinc-600 select-none shrink-0">-</span>
            <span className={`flex-1 whitespace-pre-wrap ${decoStyle}`}>{content}</span>
            <span className={`flex gap-0.5 shrink-0 transition ${loaded ? (decision ? "opacity-100" : "opacity-30 group-hover:opacity-100") : "opacity-0"}`}>
              <button
                onClick={() => sync(hash, content, "done")}
                disabled={isBusy}
                title="처리 완료 — 다음 요약에서 영구 제외"
                className={`px-2 py-0.5 rounded text-[10px] transition flex items-center gap-1 ${decision === "done" ? "bg-emerald-700 text-white" : "bg-zinc-800 hover:bg-emerald-800/60 text-zinc-400"}`}
              >
                ✅<span className="text-[10px]">완료</span>
              </button>
              <button
                onClick={() => sync(hash, content, "ignore")}
                disabled={isBusy}
                title="무시 — 다음 요약에서 영구 제외"
                className={`px-2 py-0.5 rounded text-[10px] transition flex items-center gap-1 ${decision === "ignore" ? "bg-rose-700 text-white" : "bg-zinc-800 hover:bg-rose-800/60 text-zinc-400"}`}
              >
                🚫<span className="text-[10px]">무시</span>
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DailySummaryCard({ label, date, autoLoad }: { label: string; date: string; autoLoad: boolean }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/mail/insights/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, force }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setSummary(j.summary);
      setModel(j.model);
      setCreatedAt(j.created_at || Math.floor(Date.now() / 1000));
      setCached(!!j.cached);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (autoLoad) load(false); }, [autoLoad, date]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-zinc-200">🤖 {label} 요약 <span className="text-zinc-500 font-normal text-xs ml-1">{date}</span></h2>
        <div className="flex items-center gap-1.5 text-[10px]">
          {model && <span className="text-zinc-600 font-mono">{model}</span>}
          {cached === true && createdAt && <span className="text-zinc-500">캐시 · {ago(createdAt)}</span>}
          {cached === false && <span className="text-emerald-500">방금 생성</span>}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="ml-2 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
            title="강제 재생성"
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {loading && !summary && <p className="text-xs text-zinc-500">Sonnet 4.6 생성 중…</p>}
      {!autoLoad && !summary && !loading && (
        <button
          onClick={() => load(false)}
          className="text-xs px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 self-start"
        >
          요약 생성
        </button>
      )}
      {summary && <ActionableSummary text={summary} date={date} />}
      {summary && <ChatBox date={date} label={label} />}
    </section>
  );
}

function ChatBox({ date, label }: { date: string; label: string }) {
  type Turn = { q: string; a: string; model?: string; ms?: number; err?: string };
  const [history, setHistory] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  const SUGGESTIONS = [
    "오늘 회신해야 할 메일은?",
    "정산 관련 건 있어?",
    "어떤 브랜드가 가장 급해?",
  ];

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || loading) return;
    setQuestion("");
    setLoading(true);
    const turn: Turn = { q: text, a: "" };
    setHistory((h) => [...h, turn]);
    try {
      const r = await fetch("/api/mail/insights/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, date }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setHistory((h) => h.map((t, i) => (i === h.length - 1 ? { ...t, a: j.answer, model: j.model, ms: j.elapsed_ms } : t)));
    } catch (e) {
      setHistory((h) => h.map((t, i) => (i === h.length - 1 ? { ...t, err: String(e) } : t)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800/60 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">💬 {label} 메일에 대해 질문</p>
      {history.length > 0 && (
        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
          {history.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-600 mr-1">Q.</span>{t.q}
              </div>
              {t.err ? (
                <div className="text-xs text-rose-400">⚠ {t.err}</div>
              ) : t.a ? (
                <div className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-indigo-800/60">
                  {t.a}
                  {t.model && <span className="block text-[10px] text-zinc-600 mt-1 font-mono">{t.model} · {t.ms ? Math.round(t.ms / 1000) : 0}s</span>}
                </div>
              ) : (
                <div className="text-xs text-zinc-500 pl-3">… 생성 중</div>
              )}
            </div>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`${label} 메일에 대해 질문…`}
          disabled={loading}
          className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-1.5 text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-3 py-1.5 rounded text-xs bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-50 transition"
        >
          {loading ? "…" : "전송"}
        </button>
      </form>
      {history.length === 0 && (
        <div className="flex flex-wrap gap-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DayDetailPanel({ detail }: { detail: DayDetail }) {
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<string | null>(detail.summary);
  const [model, setModel] = useState<string | null>(detail.summary_model);
  const [createdAt, setCreatedAt] = useState<number | null>(detail.summary_created_at);
  const [cached, setCached] = useState<boolean | null>(detail.summary ? true : null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadSummary = async (force = false) => {
    setLoading(true);
    setErr(null);
    setShowSummary(true);
    try {
      const r = await fetch("/api/mail/insights/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: detail.date, force }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setSummary(j.summary);
      setModel(j.model);
      setCreatedAt(j.created_at || Math.floor(Date.now() / 1000));
      setCached(!!j.cached);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-3 py-3 bg-zinc-900/40 border-t border-zinc-800/60 space-y-3">
      {/* AI summary toggle */}
      <div>
        {!showSummary && !summary && (
          <button
            onClick={() => loadSummary(false)}
            className="text-xs px-3 py-1.5 rounded bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-200 border border-indigo-800/50"
          >
            🤖 AI 일일 요약
          </button>
        )}
        {(showSummary || summary) && (
          <div className="rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-indigo-300">🤖 AI 요약</span>
              <div className="flex items-center gap-2 text-[10px]">
                {model && <span className="text-zinc-600 font-mono">{model}</span>}
                {cached === true && createdAt && <span className="text-zinc-500">캐시 · {ago(createdAt)}</span>}
                {cached === false && <span className="text-emerald-500">방금</span>}
                <button
                  onClick={() => loadSummary(true)}
                  disabled={loading}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
                >
                  {loading ? "…" : "↻"}
                </button>
              </div>
            </div>
            {err && <p className="text-xs text-rose-400">{err}</p>}
            {loading && !summary && <p className="text-xs text-zinc-500">생성 중…</p>}
            {summary && <SummaryBlock text={summary} />}
          </div>
        )}
      </div>

      {/* Brands + senders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-zinc-400 mb-1.5">🏢 브랜드 태그</p>
          {detail.top_brands.length === 0 ? (
            <p className="text-xs text-zinc-600">—</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.top_brands.map((b) => (
                <span key={b.tag} className="text-xs px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800/40">
                  [{b.tag}] <span className="font-mono text-emerald-500">{b.n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-400 mb-1.5">👤 발신 TOP</p>
          {detail.top_senders.length === 0 ? (
            <p className="text-xs text-zinc-600">—</p>
          ) : (
            <ul className="text-xs space-y-0.5">
              {detail.top_senders.map((s) => (
                <li key={s.sender} className="flex justify-between gap-2">
                  <span className="text-zinc-300 truncate">{s.sender}</span>
                  <span className="font-mono text-zinc-500">{s.n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sample subjects per category */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["high_priority", "client", "event", "sales"] as const).map((k) => {
          const rows = detail.subjects[k];
          if (!rows || rows.length === 0) return null;
          const label = k === "high_priority" ? "🚨 우선순위 high" : k === "client" ? "💼 클라" : k === "event" ? "🎤 행사" : "🤝 영업";
          const color = k === "high_priority" ? "text-rose-400" : k === "client" ? "text-emerald-400" : k === "event" ? "text-violet-400" : "text-indigo-400";
          return (
            <div key={k}>
              <p className={`text-xs font-semibold mb-1.5 ${color}`}>{label}</p>
              <ul className="text-xs space-y-1">
                {rows.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-zinc-500 truncate w-20 shrink-0">{s.sender}</span>
                    <span className="text-zinc-300 truncate flex-1">{s.subject}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtKDate(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function SalesInboxSection({ inbox }: { inbox: Insights["sales_inbox"] }) {
  if (!inbox || (inbox.total === 0 && (inbox.legacy_total || 0) === 0)) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-sm font-semibold text-zinc-200 mb-2">🎯 영업 인사이트 — 조아해 큐레이션 (최근 3개월)</h2>
        <p className="text-xs text-zinc-500">데이터 없음 (fetch 진행 중일 수 있음).</p>
      </section>
    );
  }

  const windowDays = inbox.window_days || 90;
  const lastDaysAgo = inbox.last_activity_ts
    ? Math.floor((Date.now() / 1000 - inbox.last_activity_ts) / 86400)
    : null;

  // 윈도우 내 활동이 0이면 비활성 상태 메시지만 표시
  if (inbox.total === 0) {
    return (
      <section className="rounded-xl border border-rose-800/40 bg-rose-950/10 p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">🎯 영업 인사이트 — 조아해 큐레이션 (최근 {windowDays}일)</h2>
          <a href="/mail" className="text-[11px] text-zinc-500 hover:text-zinc-200 underline">raw 메일 → 메일 탭 ↗</a>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-rose-300 text-xl font-semibold">⚠️ 최근 3개월 영업 활동 없음</span>
          {lastDaysAgo !== null && (
            <span className="text-zinc-500 text-xs">마지막 forwarding {lastDaysAgo}일 전 · 누적 {inbox.legacy_total || 0}건</span>
          )}
        </div>
        <p className="text-xs text-zinc-400 mt-2">
          조아해(ahaejo@beaus.co.kr) → beautysketchkorea@gmail.com 영업 큐레이션 forwarding 패턴이 3개월 이상 중단됨. 영업 활동 재개 또는 다른 라우팅 전환 검토 필요.
        </p>
      </section>
    );
  }

  const seriousLeads = inbox.recent.filter((c) => c.n >= 3);
  const topByVolume = [...inbox.recent].sort((a, b) => b.n - a.n).slice(0, 5);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-zinc-200">🎯 영업 인사이트 — 조아해 큐레이션 (최근 {windowDays}일)</h2>
        <a href="/mail" className="text-[11px] text-zinc-500 hover:text-zinc-200 underline">raw 메일 → 메일 탭 ↗</a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">최근 {windowDays}일 메일</p>
          <p className="text-xl font-semibold text-zinc-100 mt-0.5">{inbox.total}건</p>
          <p className="text-xs text-zinc-500 mt-1">{inbox.companies_count || 0}개 회사 · 누적 {inbox.legacy_total || 0}건</p>
        </div>
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">진지한 관심 (3건+)</p>
          <p className="text-xl font-semibold text-emerald-300 mt-0.5">{seriousLeads.length}개</p>
          <p className="text-xs text-zinc-500 mt-1">반복 접촉</p>
        </div>
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">마지막 활동</p>
          <p className="text-xl font-semibold text-zinc-100 mt-0.5">{lastDaysAgo !== null ? `${lastDaysAgo}일 전` : "—"}</p>
          <p className="text-xs text-zinc-500 mt-1">{inbox.today_actions.length}건 follow-up 대기</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-400 mb-2">💎 진지한 관심 표명 회사 (3건+)</p>
          {seriousLeads.length === 0 ? (
            <p className="text-xs text-zinc-600">없음</p>
          ) : (
            <ul className="text-xs space-y-1">
              {seriousLeads.slice(0, 8).map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-zinc-200 truncate flex-1">{c.company}</span>
                  <span className="font-mono text-zinc-400 w-10 text-right">{c.n}건</span>
                  <span className="text-zinc-600 font-mono text-[10px] w-14 text-right">{fmtKDate(c.last_ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-amber-400 mb-2">📊 메일 볼륨 TOP 5</p>
          {topByVolume.length === 0 ? (
            <p className="text-xs text-zinc-600">없음</p>
          ) : (
            <ul className="text-xs space-y-1.5">
              {topByVolume.map((c, i) => {
                const max = topByVolume[0]?.n || 1;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-zinc-300 truncate w-32 shrink-0">{c.company}</span>
                    <span className="flex-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
                      <span className="block h-full bg-amber-500/70" style={{ width: `${(c.n / max) * 100}%` }} />
                    </span>
                    <span className="font-mono text-zinc-400 w-8 text-right">{c.n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {inbox.today_actions.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800/60">
          <p className="text-xs font-semibold text-rose-400 mb-2">🎯 오늘 follow-up 필요 (최근 30일)</p>
          <ul className="text-xs space-y-1">
            {inbox.today_actions.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${a.action.includes("초기") ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>{a.action}</span>
                <span className="text-zinc-200 truncate w-32 shrink-0">{a.company}</span>
                <span className="text-zinc-500 flex-1 truncate">{a.last_subject}</span>
                <span className="text-zinc-600 font-mono text-[10px] shrink-0">{a.days_since}d</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 mt-3">
        💡 최근 {windowDays}일 window. 누적 {inbox.legacy_total || 0}건 중 옛날 메일은 분석에서 제외. raw 메일은 <a href="/mail" className="underline hover:text-zinc-300">메일 탭</a>.
      </p>
    </section>
  );
}

export default function MailInsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"14d" | "30d">("14d");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/mail/insights", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const matrix = useMemo(() => (range === "30d" ? data?.matrix_30d : data?.matrix_14d) || [], [data, range]);
  const matrixMax = useMemo(() => matrix.reduce((m, r) => Math.max(m, r.total), 0), [matrix]);
  const daysByDate = useMemo(() => {
    const m = new Map<string, DayDetail>();
    if (data?.days) for (const d of data.days) m.set(d.date, d);
    return m;
  }, [data]);

  const todayByCat = useMemo(() => {
    const out = new Map<Cat, number>();
    if (!data) return out;
    for (const m of data.today) {
      const c = (m.category || "pending") as Cat;
      out.set(c, (out.get(c) || 0) + 1);
    }
    return out;
  }, [data]);

  const toggle = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const today = isoKST(0);
  const yesterday = isoKST(-1);

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      <header className="mb-5 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">mail · analytics · ceo_mail.db</p>
          <h1 className="text-2xl font-semibold mt-1">📊 메일 분석기</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {data
              ? <>총 <span className="text-zinc-300 font-mono">{data.totals.total.toLocaleString()}</span> · 분류 <span className="text-zinc-300 font-mono">{data.totals.classified.toLocaleString()}</span> ({data.totals.coverage_pct}%) · 미분류 <span className="text-zinc-300 font-mono">{data.totals.pending.toLocaleString()}</span> · <span className="text-zinc-600">갱신 {ago(data.updated_at)}</span></>
              : "—"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition"
        >
          {loading ? "로딩…" : "↻ 새로고침"}
        </button>
      </header>

      {err && <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 p-4 mb-4 text-sm text-rose-300">로드 실패: {err}</div>}

      {data && (
        <div className="space-y-5">
          {/* AI 일일 요약: 오늘 + 어제 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <DailySummaryCard label="오늘" date={today} autoLoad={true} />
            <DailySummaryCard label="어제" date={yesterday} autoLoad={true} />
          </div>

          {/* 🆕 신규 브랜드 제안 */}
          <BrandProposalsSection />

          {/* 🎯 영업 인박스 — 조아해 큐레이션 */}
          <SalesInboxSection inbox={data.sales_inbox} />

          {/* 오늘 스냅샷 (메일 리스트) */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200">오늘 수신 ({data.today.length}건)</h2>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {CAT_ORDER.map((c) => {
                const n = todayByCat.get(c) || 0;
                if (!n) return null;
                const m = CAT_META[c];
                return <span key={c} className={`text-xs px-2 py-1 rounded bg-zinc-800/60 ${m.color}`}>{m.emoji} {m.label} {n}</span>;
              })}
              {data.today.length === 0 && <span className="text-xs text-zinc-500">오늘 수신 없음</span>}
            </div>
            <div className="divide-y divide-zinc-800/60 max-h-[40vh] overflow-y-auto">
              {data.today.map((m) => {
                const meta = CAT_META[(m.category || "pending") as Cat];
                return (
                  <div key={m.id} className="py-2 flex items-start gap-3 text-sm">
                    <span className="text-[10px] font-mono text-zinc-500 w-12 shrink-0 pt-0.5">{fmtTime(m.ts)}</span>
                    <span className={`text-xs shrink-0 w-14 ${meta.color}`}>{meta.emoji} {meta.label}</span>
                    <span className="text-xs text-zinc-400 shrink-0 w-28 truncate">{m.from}</span>
                    <span className="text-zinc-200 flex-1 truncate">{m.subject}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 매트릭스 (펼침형) */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200">일자 × 카테고리 · 클릭 펼침 → 일별 요약/브랜드/발신</h2>
              <div className="flex gap-1 text-xs">
                {(["14d", "30d"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`px-2 py-1 rounded ${range === r ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="text-left py-1.5 pr-3 font-normal w-8"></th>
                    <th className="text-left py-1.5 pr-3 font-normal">날짜</th>
                    {CAT_ORDER.map((c) => (
                      <th key={c} className={`text-center px-1.5 py-1.5 font-normal ${CAT_META[c].color}`}>
                        <span className="block text-sm leading-none">{CAT_META[c].emoji}</span>
                        <span className="block text-[9px] mt-0.5 opacity-80">{CAT_META[c].label}</span>
                      </th>
                    ))}
                    <th className="text-right pl-3 py-1.5 font-normal text-zinc-300">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((r) => {
                    const isOpen = expanded.has(r.date);
                    const detail = daysByDate.get(r.date);
                    return (
                      <Fragment key={r.date}>
                        <tr
                          key={r.date}
                          onClick={() => toggle(r.date)}
                          className="border-t border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer"
                        >
                          <td className="py-1.5 pr-3 text-center text-zinc-500">{isOpen ? "▼" : "▶"}</td>
                          <td className="py-1.5 pr-3 font-mono text-zinc-400">{r.date.slice(5)}</td>
                          {CAT_ORDER.map((c) => {
                            const v = (r as Record<string, number>)[c] || 0;
                            return (
                              <td key={c} className={`text-right px-1.5 py-1.5 font-mono ${v ? "text-zinc-200" : "text-zinc-700"}`}>
                                {v || "·"}
                              </td>
                            );
                          })}
                          <td className="text-right pl-3 py-1.5 font-mono">
                            <span className="text-zinc-200">{r.total}</span>
                            <span className="ml-2 inline-block w-16 h-1 bg-zinc-800 rounded align-middle overflow-hidden">
                              <span className="block h-full bg-zinc-400" style={{ width: `${matrixMax ? (r.total / matrixMax) * 100 : 0}%` }} />
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={r.date + "_d"}>
                            <td colSpan={CAT_ORDER.length + 3} className="p-0">
                              {detail ? <DayDetailPanel detail={detail} /> : (
                                <div className="px-3 py-3 text-xs text-zinc-500 bg-zinc-900/40 border-t border-zinc-800/60">
                                  이 날의 상세 데이터가 없습니다 (30일 윈도우 밖).
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 브랜드 + Top 발신자 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">🏢 브랜드 태그 리더보드 (30일, client/sales/event)</h2>
              {data.brands_30d.length === 0 ? (
                <p className="text-xs text-zinc-500">데이터 없음</p>
              ) : (
                <div className="space-y-1.5">
                  {(() => {
                    const max = data.brands_30d[0]?.n || 1;
                    return data.brands_30d.map((b) => (
                      <div key={b.tag} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-zinc-300 truncate flex-1">[{b.tag}]</span>
                        <span className="inline-block w-32 h-1.5 bg-zinc-800 rounded overflow-hidden">
                          <span className="block h-full bg-emerald-500/70" style={{ width: `${(b.n / max) * 100}%` }} />
                        </span>
                        <span className="font-mono text-zinc-400 w-6 text-right">{b.n}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">👤 Top 발신자 (30일)</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
                {(["client", "sales", "finance", "event"] as const).map((c) => {
                  const m = CAT_META[c];
                  const rows = data.top_senders[c] || [];
                  return (
                    <div key={c}>
                      <p className={`font-semibold mb-1.5 ${m.color}`}>{m.emoji} {m.label}</p>
                      {rows.length === 0 ? <p className="text-zinc-600">—</p> : (
                        <ul className="space-y-0.5">
                          {rows.slice(0, 8).map((s) => (
                            <li key={s.sender} className="flex justify-between gap-2">
                              <span className="text-zinc-300 truncate">{s.sender}</span>
                              <span className="font-mono text-zinc-500">{s.n}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* 시간대/요일 분포 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">⏰ 오늘 시간대 분포</h2>
              {(() => {
                const map = new Map(data.today_hours.map((h) => [h.hour, h.n]));
                const max = Math.max(1, ...data.today_hours.map((h) => h.n));
                return (
                  <div className="flex items-end gap-0.5 h-24">
                    {Array.from({ length: 24 }).map((_, h) => {
                      const n = map.get(h) || 0;
                      return (
                        <div key={h} className="flex-1 flex flex-col items-center justify-end gap-1">
                          <div className={`w-full rounded-t ${n ? "bg-sky-500/70" : "bg-zinc-800"}`} style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 1 }} title={`${h}시 ${n}건`} />
                          {h % 3 === 0 && <span className="text-[9px] text-zinc-600 font-mono">{h}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">📅 요일 분포 (30일)</h2>
              {(() => {
                const labels = ["일","월","화","수","목","금","토"];
                const map = new Map(data.weekday_30d.map((w) => [w.w, w.n]));
                const max = Math.max(1, ...data.weekday_30d.map((w) => w.n));
                return (
                  <div className="grid grid-cols-7 gap-2 text-xs">
                    {labels.map((lab, i) => {
                      const n = map.get(i) || 0;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <span className="text-zinc-500">{lab}</span>
                          <div className="w-full h-16 bg-zinc-800/50 rounded relative overflow-hidden">
                            <div className="absolute bottom-0 inset-x-0 bg-violet-500/60" style={{ height: `${(n / max) * 100}%` }} />
                          </div>
                          <span className="font-mono text-zinc-400">{n}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          </div>

          {/* 🗑 정리 후보 */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200">🗑 정리 후보 — 받은편지함 슬림화</h2>
              <span className="text-[10px] text-zinc-600 font-mono">미분류 {data.cleanup.pending_uncategorized}건 · 30일 기준</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-semibold text-sky-400 mb-2">📰 구독해지 후보 (뉴스/강의, 3건+)</p>
                {data.cleanup.newsletters.length === 0 ? <p className="text-xs text-zinc-600">—</p> : (
                  <ul className="text-xs space-y-1">
                    {data.cleanup.newsletters.map((n) => {
                      const dom = n.from_addr && n.from_addr.includes("@") ? n.from_addr.split("@")[1] : n.from_addr;
                      return (
                        <li key={n.from_addr || n.sender} className="flex items-center gap-2">
                          <span className="flex-1 truncate">
                            <span className="text-zinc-300">{n.sender}</span>
                            {dom && <span className="text-zinc-600 ml-1 font-mono text-[10px]">{dom}</span>}
                          </span>
                          <span className="font-mono text-zinc-500 w-8 text-right">{n.n}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-amber-400 mb-2">📢 막뿌리기 의심 (5건+, sales/news/미분류)</p>
                {data.cleanup.mass_blasters.length === 0 ? <p className="text-xs text-zinc-600">—</p> : (
                  <ul className="text-xs space-y-1">
                    {data.cleanup.mass_blasters.map((n) => {
                      const dom = n.from_addr && n.from_addr.includes("@") ? n.from_addr.split("@")[1] : n.from_addr;
                      return (
                        <li key={n.from_addr || n.sender} className="flex items-center gap-2">
                          <span className="flex-1 truncate">
                            <span className="text-zinc-300">{n.sender}</span>
                            {dom && <span className="text-zinc-600 ml-1 font-mono text-[10px]">{dom}</span>}
                          </span>
                          <span className="font-mono text-zinc-500 w-8 text-right">{n.n}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-rose-400 mb-2">🗑 노이즈 분류 미삭제 ({data.cleanup.noise_to_trash.length})</p>
                {data.cleanup.noise_to_trash.length === 0 ? (
                  <p className="text-xs text-zinc-600">없음 — 노이즈 자동 휴지통 처리됨 또는 분류 안 됨</p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {data.cleanup.noise_to_trash.map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <span className="text-zinc-500 truncate w-20 shrink-0">{m.sender}</span>
                        <span className="flex-1 truncate text-zinc-300">{m.subject}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="text-[10px] text-zinc-600 mt-3">
              💡 미분류 {data.cleanup.pending_uncategorized}건은 메일탭 &quot;🏷 분류&quot; 버튼으로 일괄 분류 → 정리 후보 정확도 ↑
            </p>
          </section>

          <p className="text-xs text-zinc-600 font-mono">
            Source: /root/projects/nectar-os/data/ceo_mail.db · 일일 요약: sonar-pro + daily_summaries 캐시
          </p>
        </div>
      )}
    </div>
  );
}
