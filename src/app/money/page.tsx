"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type MoneyKpi = {
  monthLabel: string; income: number; spent: number; budget: number;
  topCategories: Array<{ name: string; amount: number; share: number; kind: "biz" | "personal" }>;
  trend: number[]; trendMonths: string[];
  subscriptions: unknown[];
  bigTransactions: Array<{ date: string; merchant: string; amount: number; kind: "biz" | "personal" }>;
  burnRatePerDay?: number; projectedMonthEnd?: number;
};
type SummaryResp = {
  month: string; available_months: string[]; kpi: MoneyKpi; record_count: number;
  housing_monthly?: number; housing_monthly_count?: number; housing_total?: number;
  housing_top_this_month?: Array<{ date: string; vendor: string; amount: number }>;
  subscriptions_monthly?: number; subscriptions_annual?: number;
  subscriptions_monthly_items?: Array<{ date: string; vendor: string; amount: number; category: string }>;
};
type VendorRow = { vendor: string; total: number; count: number };
type SearchItem = { id?: string; date: string; vendor: string; amount: number; category: string; subcategory?: string; business_or_personal: "biz" | "personal"; card?: string };
type ChatMsg = { role: "user" | "model"; text: string };
type DetailFilter = { kind: "category"; name: string } | { kind: "vendor"; name: string } | null;
type Sub = {
  vendor: string; category: string; subcategory: string | null;
  kind: "biz" | "personal"; period: "monthly" | "yearly";
  count: number; avg_amount: number; monthly_equiv: number; annual_equiv: number;
  avg_interval_days: number; first_date: string; last_date: string;
  days_since_last: number; status: "active" | "dormant" | "ended"; total_paid: number;
};
type SubsResp = {
  active_monthly_total: number; active_annual_total: number;
  active: Sub[]; dormant: Sub[]; ended: Sub[];
};

const kindColor: Record<string, string> = { biz: "text-violet-400", personal: "text-emerald-400" };
type View = "month" | "year" | "subs" | "search";

function mdToHtml(md: string): string {
  let h = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-emerald-300 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold text-emerald-200 mt-3 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-semibold text-emerald-100 mt-3 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-100">$1</strong>')
    .replace(/\n\n/g, '</p><p class="mt-2">').replace(/\n/g, '<br/>');
  return `<p>${h}</p>`;
}

export default function MoneyPage() {
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState<string | null>(null);
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [query, setQuery] = useState(""); const [committedQuery, setCommittedQuery] = useState("");

  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [search, setSearch] = useState<SearchItem[] | null>(null);
  const [subs, setSubs] = useState<SubsResp | null>(null);
  const [subsTab, setSubsTab] = useState<"active" | "dormant" | "ended">("active");
  const [loading, setLoading] = useState(true);

  const [aiText, setAiText] = useState<string>(""); const [aiCached, setAiCached] = useState(false);
  const [aiLoading, setAiLoading] = useState(false); const [aiError, setAiError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const [detail, setDetail] = useState<DetailFilter>(null);
  const [detailItems, setDetailItems] = useState<SearchItem[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [vendorGuide, setVendorGuide] = useState<string>("");
  const [vendorGuideLoading, setVendorGuideLoading] = useState(false);

  useEffect(() => {
    if (view !== "month") return;
    const q = month ? `?month=${month}` : "";
    setLoading(true);
    fetch(`/api/finance/kb-summary${q}`).then(r => r.json()).then(d => { setSummary(d); if (!month) setMonth(d.month); }).finally(() => setLoading(false));
  }, [month, view]);

  useEffect(() => {
    if (view !== "month" || !month) return;
    setAiLoading(true); setAiError(null); setAiText(""); setChatMessages([]);
    fetch(`/api/finance/ai-analyze?month=${month}`).then(r => r.json()).then(d => {
      if (d.error) setAiError(d.error);
      setAiText(d.analysis ?? ""); setAiCached(!!d.cached);
    }).catch(e => setAiError(String(e))).finally(() => setAiLoading(false));
  }, [month, view]);

  async function fetchVendorGuide(vendor: string) {
    setVendorGuideLoading(true); setVendorGuide("");
    try {
      const r = await fetch("/api/finance/ai-vendor-guide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor }),
      });
      const d = await r.json();
      setVendorGuide(d.guide ?? d.error ?? "");
    } catch (e) { setVendorGuide(`에러: ${String(e)}`); }
    finally { setVendorGuideLoading(false); }
  }

  function refreshAi() {
    if (!month) return;
    setAiLoading(true); setAiError(null);
    fetch(`/api/finance/ai-analyze?month=${month}&refresh=1`).then(r => r.json()).then(d => {
      if (d.error) setAiError(d.error);
      setAiText(d.analysis ?? ""); setAiCached(false);
    }).catch(e => setAiError(String(e))).finally(() => setAiLoading(false));
  }

  async function sendChat(saveAnalysis = false) {
    if (!chatInput.trim() || !month || chatBusy) return;
    const userMsg: ChatMsg = { role: "user", text: chatInput.trim() };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages); setChatInput(""); setChatBusy(true);
    try {
      const r = await fetch("/api/finance/ai-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, messages: newMessages, save: saveAnalysis }),
      });
      const d = await r.json();
      if (d.reply) {
        setChatMessages([...newMessages, { role: "model", text: d.reply }]);
        if (saveAnalysis && d.saved) { setAiText(d.reply); setAiCached(false); }
      } else if (d.error) {
        setChatMessages([...newMessages, { role: "model", text: `_에러: ${d.error}_` }]);
      }
    } catch (e) {
      setChatMessages([...newMessages, { role: "model", text: `_네트워크 에러: ${String(e)}_` }]);
    } finally {
      setChatBusy(false);
      setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }

  useEffect(() => { if (view !== "year") return; setLoading(true); fetch(`/api/finance/kb-vendors?year=${year}&limit=30`).then(r => r.json()).then(d => setVendors(d.top)).finally(() => setLoading(false)); }, [year, view]);
  useEffect(() => { if (view !== "search" || !committedQuery) { setSearch(null); return; } setLoading(true); fetch(`/api/finance/kb-search?q=${encodeURIComponent(committedQuery)}&limit=200`).then(r => r.json()).then(d => setSearch(d.items)).finally(() => setLoading(false)); }, [committedQuery, view]);
  useEffect(() => { if (view !== "subs") return; setLoading(true); fetch(`/api/finance/kb-subscriptions`).then(r => r.json()).then(d => setSubs(d)).finally(() => setLoading(false)); }, [view]);

  useEffect(() => {
    if (!detail) { setDetailItems(null); return; }
    setDetailLoading(true);
    const params = new URLSearchParams({ limit: "500" });
    if (month && view === "month") params.set("month", month);
    if (detail.kind === "category") params.set("category", detail.name);
    if (detail.kind === "vendor") params.set("q", detail.name);
    fetch(`/api/finance/kb-search?${params}`).then(r => r.json()).then(d => setDetailItems(d.items)).finally(() => setDetailLoading(false));
  }, [detail, month, view]);

  const months = summary?.available_months ?? [];
  const byYear = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const m of months) { const y = m.slice(0, 4); if (!g.has(y)) g.set(y, []); g.get(y)!.push(m); }
    return [...g.entries()].sort(([a],[b]) => b.localeCompare(a));
  }, [months]);
  const kpi = summary?.kpi;
  const idx = month ? months.indexOf(month) : -1;
  const spentPct = kpi && kpi.budget > 0 ? Math.round((kpi.spent / kpi.budget) * 100) : 0;
  const bizTotal = kpi?.topCategories.filter(c => c.kind === "biz").reduce((s, c) => s + c.amount, 0) ?? 0;
  const personalTotal = kpi?.topCategories.filter(c => c.kind === "personal").reduce((s, c) => s + c.amount, 0) ?? 0;
  const trendMax = useMemo(() => kpi ? Math.max(...kpi.trend, 1) : 1, [kpi]);
  const trendAvg = useMemo(() => kpi && kpi.trend.length > 0 ? kpi.trend.reduce((s, n) => s + n, 0) / kpi.trend.length : 0, [kpi]);
  const searchTotal = search?.reduce((s, t) => s + t.amount, 0) ?? 0;
  const vendorTotal = vendors.reduce((s, v) => s + v.total, 0);
  const detailTotal = detailItems?.reduce((s, t) => s + t.amount, 0) ?? 0;
  const subsList = subs ? (subsTab === "active" ? subs.active : subsTab === "dormant" ? subs.dormant : subs.ended) : [];

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500">money · KB+npay+xls 통합 · AI 분석/채팅 · 구독</p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-3xl font-semibold">재정</h1>
          <div className="flex gap-1 ml-2">
            {(["month","year","subs","search"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded text-xs font-mono transition ${
                view === v ? "bg-emerald-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              }`}>{v === "month" ? "월별" : v === "year" ? "연도별" : v === "subs" ? "🔁 구독" : "검색"}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-zinc-600 font-mono">{summary?.record_count.toLocaleString()}건 · {months.length}개월</span>
        </div>
      </header>

      {view === "month" && kpi && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold text-zinc-200">💬 분석 수정 / 질문 ({kpi.monthLabel})</h3>
                {chatMessages.length > 0 && (
                  <button onClick={() => setChatMessages([])} className="text-[10px] text-zinc-500 hover:text-zinc-200 font-mono">↺ 비우기</button>
                )}
              </div>
              <p className="text-[10px] text-zinc-600 font-mono mb-3">예: &quot;Apple 빼고 다시&quot; · &quot;이 가맹점 뭐야&quot; · &quot;골프 비용 추세&quot;</p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto mb-3 pr-1">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">아직 대화 없음.</p>
                ) : chatMessages.map((m, i) => (
                  <div key={i} className={`rounded-lg p-2.5 text-sm ${
                    m.role === "user" ? "bg-emerald-950/40 border border-emerald-900/40 ml-4" : "bg-zinc-800/40 border border-zinc-700/40 mr-4"
                  }`}>
                    <p className="text-[9px] text-zinc-500 font-mono mb-1">{m.role === "user" ? "Me" : "AI"}</p>
                    {m.role === "user" ? <p className="text-zinc-200 whitespace-pre-wrap">{m.text}</p> :
                      <div className="text-zinc-300 prose prose-sm prose-invert" dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />}
                  </div>
                ))}
                {chatBusy && <p className="text-xs text-zinc-500 italic ml-4">AI 답변 중...</p>}
                <div ref={chatEnd} />
              </div>
              <div className="space-y-2">
                <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(false); } }}
                  placeholder="질문 / 수정 요청..." rows={2}
                  className="w-full px-3 py-2 rounded bg-zinc-950 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600 resize-none"
                  disabled={chatBusy} />
                <div className="flex gap-2">
                  <button onClick={() => sendChat(false)} disabled={chatBusy || !chatInput.trim()}
                    className="flex-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-mono disabled:opacity-30">보내기 (⌘+Enter)</button>
                  <button onClick={() => sendChat(true)} disabled={chatBusy || !chatInput.trim()}
                    className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded text-xs font-mono disabled:opacity-30">💾 덮어쓰기</button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => idx > 0 && setMonth(months[idx - 1])} disabled={idx <= 0} className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 px-2 py-1">◀</button>
              <h2 className="text-xl font-semibold">{kpi.monthLabel}</h2>
              <button onClick={() => idx >= 0 && idx < months.length - 1 && setMonth(months[idx + 1])} disabled={idx >= months.length - 1} className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 px-2 py-1">▶</button>
            </div>
            <div className="space-y-1.5">
              {byYear.map(([y, ms]) => (
                <div key={y} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-600 font-mono w-12 shrink-0">{y}</span>
                  {ms.map(m => (
                    <button key={m} onClick={() => setMonth(m)} className={`px-2 py-0.5 rounded text-xs font-mono transition ${
                      m === month ? "bg-emerald-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}>{m.slice(5)}</button>
                  ))}
                </div>
              ))}
            </div>

            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase text-zinc-500">총 지출</p>
                <p className="text-2xl font-semibold mt-1">₩{(kpi.spent / 10_000).toFixed(0)}만</p>
                <div className="h-1 bg-zinc-800 rounded mt-2 overflow-hidden"><div className={`h-full ${spentPct > 80 ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(spentPct, 100)}%` }} /></div>
                <p className="text-xs text-zinc-500 mt-1">예산 ₩{(kpi.budget / 10_000).toFixed(0)}만 / {spentPct}%</p>
              </div>
              <div className="rounded-xl border border-violet-900/40 bg-violet-950/15 p-4">
                <p className="text-xs uppercase text-violet-400">💼 비즈</p>
                <p className="text-2xl font-semibold text-violet-300 mt-1">₩{(bizTotal / 10_000).toFixed(0)}만</p>
                <p className="text-xs text-violet-400/70 mt-1">burn ₩{((kpi.burnRatePerDay ?? 0) / 10_000).toFixed(1)}만/일</p>
              </div>
              <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-4">
                <p className="text-xs uppercase text-emerald-400">🏠 개인</p>
                <p className="text-2xl font-semibold text-emerald-300 mt-1">₩{(personalTotal / 10_000).toFixed(0)}만</p>
                <p className="text-xs text-emerald-400/70 mt-1">월말 ₩{((kpi.projectedMonthEnd ?? 0) / 10_000).toFixed(0)}만 예상</p>
              </div>
              <div className="rounded-xl border border-sky-900/40 bg-sky-950/15 p-4">
                <p className="text-xs uppercase text-sky-400">🔁 정기 구독</p>
                <p className="text-2xl font-semibold text-sky-300 mt-1">₩{((summary?.subscriptions_monthly ?? 0) / 10_000).toFixed(0)}만</p>
                <p className="text-xs text-sky-400/70 mt-1">SaaS+스트리밍+광고 · 4년 ₩{((summary?.subscriptions_annual ?? 0) / 10_000).toFixed(0)}만</p>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-medium text-zinc-300">📈 최근 {kpi.trend.length}개월</h3>
                <span className="text-xs text-zinc-500 font-mono">평균 ₩{trendAvg.toFixed(0)}만</span>
              </div>
              <div className="flex items-end gap-1.5 h-28">
                {kpi.trend.map((n, i) => {
                  const isThis = kpi.trendMonths[i] === kpi.monthLabel;
                  const above = n > trendAvg;
                  return (
                    <button key={i} onClick={() => setMonth(kpi.trendMonths[i])} className="flex-1 flex flex-col items-center justify-end gap-1 h-full hover:opacity-90">
                      <span className="text-[9px] text-zinc-300 font-mono">{n}</span>
                      <div className={`w-full rounded-t ${isThis ? "bg-emerald-500" : above ? "bg-rose-500/70" : "bg-zinc-500/60"}`} style={{ height: `${(n / trendMax) * 80}%`, minHeight: "6px" }} />
                      <span className="text-[8px] text-zinc-500 font-mono">{kpi.trendMonths[i].slice(2).replace("-", "/")}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <h3 className="text-sm font-medium text-zinc-300 mb-3">카테고리 비중 <span className="text-[10px] text-zinc-600 ml-1">클릭 = 디테일</span></h3>
                {(() => {
                  // 각 카테고리에 색상 + 누적 각도 계산
                  const palette = ["#34d399","#f87171","#a78bfa","#60a5fa","#fbbf24","#22d3ee","#fb923c","#e879f9","#a3e635","#f472b6","#94a3b8"];
                  const total = kpi.topCategories.reduce((s, c) => s + c.amount, 0) || 1;
                  let cum = 0;
                  const slices = kpi.topCategories.map((c, i) => {
                    const sharePct = (c.amount / total) * 100;
                    const start = cum;
                    cum += sharePct;
                    return { ...c, color: palette[i % palette.length], start, end: cum, sharePct };
                  });
                  const grad = slices.map((s) => `${s.color} ${s.start * 3.6}deg ${s.end * 3.6}deg`).join(", ");
                  return (
                    <div className="flex items-center gap-4">
                      <div className="shrink-0 relative w-32 h-32">
                        <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${grad})` }} />
                        <div className="absolute inset-3 rounded-full bg-zinc-900 flex flex-col items-center justify-center">
                          <span className="text-[10px] text-zinc-500">월 합계</span>
                          <span className="text-sm font-semibold text-zinc-200">₩{(total/10_000).toFixed(0)}만</span>
                        </div>
                      </div>
                      <ul className="flex-1 space-y-1.5 min-w-0">
                        {slices.map((s, i) => (
                          <li key={i}>
                            <button onClick={() => setDetail({ kind: "category", name: s.name })} className="w-full text-left hover:bg-zinc-800/40 rounded px-1 py-0.5 transition flex items-baseline justify-between gap-2 text-xs">
                              <span className="flex items-center gap-1.5 truncate"><span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} /><span className="text-zinc-200 truncate">{s.name}</span></span>
                              <span className="text-zinc-400 font-mono shrink-0">{s.sharePct.toFixed(0)}% · ₩{(s.amount/10_000).toFixed(0)}만</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <h3 className="text-sm font-medium text-zinc-300 mb-2">💸 큰 거래 <span className="text-[10px] text-zinc-600 ml-1">클릭 = 가맹점</span></h3>
                <ul className="space-y-1.5">
                  {kpi.bigTransactions.map((t, i) => (
                    <li key={i}>
                      <button onClick={() => setDetail({ kind: "vendor", name: t.merchant })} className="w-full text-left text-sm hover:bg-zinc-800/40 rounded px-1 py-0.5 transition">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-zinc-200 truncate"><span className="text-[10px] font-mono text-zinc-600 mr-1">{t.date}</span>{t.merchant}</span>
                          <span className="text-zinc-400 font-mono shrink-0 text-xs">₩{(t.amount / 10_000).toFixed(1)}만</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto pr-1">
            <div className="rounded-xl border border-emerald-900/50 bg-gradient-to-br from-emerald-950/40 to-zinc-900/40 p-4">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold text-emerald-300">🤖 AI 분석</h3>
                <div className="flex items-center gap-2">
                  {aiCached && <span className="text-[10px] text-zinc-500 font-mono">cached</span>}
                  <button onClick={refreshAi} disabled={aiLoading} className="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono disabled:opacity-30">{aiLoading ? "분석 중…" : "↻ 재분석"}</button>
                </div>
              </div>
              <p className="text-[10px] text-zinc-600 font-mono mb-3">Gemini 2.5 Flash</p>
              {aiLoading && !aiText && <p className="text-zinc-500 text-sm">분석 중... (5-15초)</p>}
              {aiError && <p className="text-rose-400 text-xs">에러: {aiError}</p>}
              {aiText && <div className="prose prose-sm prose-invert text-zinc-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(aiText) }} />}
            </div>
          </aside>
        </div>
      )}

      {/* SUBS VIEW */}
      {view === "subs" && (
        <>
          {subs && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/15 p-4">
                <p className="text-xs uppercase text-emerald-400">🔁 활성 구독</p>
                <p className="text-2xl font-semibold text-emerald-300 mt-1">{subs.active.length}건</p>
                <p className="text-xs text-emerald-400/70 mt-1">월 ₩{(subs.active_monthly_total / 10_000).toFixed(1)}만 / 연 ₩{(subs.active_annual_total / 10_000).toFixed(0)}만</p>
              </div>
              <div className="rounded-xl border border-amber-900/40 bg-amber-950/15 p-4">
                <p className="text-xs uppercase text-amber-400">😴 휴면 (60일 X)</p>
                <p className="text-2xl font-semibold text-amber-300 mt-1">{subs.dormant.length}건</p>
                <p className="text-xs text-amber-400/70 mt-1">자동 해지 직전 가능성</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase text-zinc-500">✋ 종료 추정</p>
                <p className="text-2xl font-semibold text-zinc-400 mt-1">{subs.ended.length}건</p>
                <p className="text-xs text-zinc-500 mt-1">과거에 정기였던 거래</p>
              </div>
            </section>
          )}
          <div className="flex gap-1 mb-4">
            {(["active","dormant","ended"] as const).map(t => (
              <button key={t} onClick={() => setSubsTab(t)} className={`px-3 py-1 rounded text-xs font-mono transition ${
                subsTab === t ? "bg-emerald-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              }`}>{t === "active" ? "🟢 활성" : t === "dormant" ? "🟡 휴면" : "⚪ 종료"}</button>
            ))}
          </div>
          {loading ? <p className="text-zinc-500 text-sm">로딩 중...</p> : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/80 text-zinc-500 text-xs">
                  <tr>
                    <th className="text-center px-2 py-2 w-10">취소?</th>
                    <th className="text-left px-3 py-2">Vendor</th>
                    <th className="text-right px-2">월 환산</th>
                    <th className="text-right px-2">연 환산</th>
                    <th className="text-right px-2">횟수</th>
                    <th className="text-right px-2">첫 결제</th>
                    <th className="text-right px-2">마지막</th>
                    <th className="text-center px-2">간격</th>
                    <th className="text-right px-3">누적</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {subsList.map((s, i) => {
                    const suspicious = s.status === "active" && /^자동결제|KCP\(자동|^자동$/.test(s.vendor);
                    const cancelKey = `sub_cancel_${s.vendor}`;
                    const isCancel = typeof window !== "undefined" && window.localStorage.getItem(cancelKey) === "1";
                    const intervalLabel = (() => {
                      const d = s.avg_interval_days;
                      if (d >= 28 && d <= 32) return "매월 ✓";
                      if (d >= 25 && d <= 35) return `${d}일`;
                      if (d >= 85 && d <= 95) return "분기";
                      if (d >= 350 && d <= 380) return "매년";
                      return `${d}일`;
                    })();
                    const dormant = s.days_since_last > 35 && s.period === "monthly";
                    return (
                      <tr key={i} className={`hover:bg-zinc-800/40 ${suspicious ? "bg-rose-950/20" : ""} ${dormant ? "bg-amber-950/15" : ""} ${isCancel ? "opacity-50 line-through" : ""}`}>
                        <td className="text-center px-2">
                          <input type="checkbox" defaultChecked={isCancel}
                            onChange={(e) => {
                              if (e.target.checked) window.localStorage.setItem(cancelKey, "1");
                              else window.localStorage.removeItem(cancelKey);
                              e.target.closest("tr")?.classList.toggle("opacity-50", e.target.checked);
                              e.target.closest("tr")?.classList.toggle("line-through", e.target.checked);
                            }}
                            className="accent-rose-500" />
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setDetail({ kind: "vendor", name: s.vendor })} className="text-left hover:text-emerald-300">
                            <span className={kindColor[s.kind]}>{s.kind === "biz" ? "💼" : "🏠"}</span> {s.vendor}
                            {suspicious && <span className="ml-2 text-[10px] text-rose-400">⚠ 정체 확인</span>}
                            {dormant && <span className="ml-2 text-[10px] text-amber-400">😴 휴면</span>}
                            <span className="block text-[10px] text-zinc-600 font-mono mt-0.5">{s.category}{s.subcategory ? ` · ${s.subcategory}` : ""}</span>
                          </button>
                        </td>
                        <td className="text-right font-mono text-zinc-300 px-2">₩{s.monthly_equiv.toLocaleString()}</td>
                        <td className="text-right font-mono text-zinc-400 px-2 text-xs">₩{(s.annual_equiv / 10_000).toFixed(0)}만</td>
                        <td className="text-right font-mono text-zinc-500 px-2 text-xs">{s.count}회</td>
                        <td className="text-right font-mono text-zinc-600 px-2 text-[10px]">{s.first_date.slice(2).replace(/-/g, "/")}</td>
                        <td className="text-right font-mono text-zinc-500 px-2 text-xs">{s.last_date.slice(2).replace(/-/g, "/")} ({s.days_since_last}일전)</td>
                        <td className="text-center font-mono text-zinc-500 px-2 text-xs">{intervalLabel}</td>
                        <td className="text-right font-mono text-zinc-400 px-3 text-xs">₩{(s.total_paid / 10_000).toFixed(0)}만</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-3 py-2 text-[10px] text-zinc-600 font-mono border-t border-zinc-800">
                ☑ 체크 = 취소 검토 중 (브라우저 저장, 본인만 보임). 마지막 결제 35일+ 휴면(노란색), 정체불명 = 빨간색.
              </div>
            </div>
          )}
        </>
      )}

      {view === "year" && (
        <>
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {["2022","2023","2024","2025","2026"].map(y => (
              <button key={y} onClick={() => setYear(y)} className={`px-3 py-1 rounded text-xs font-mono transition ${
                y === year ? "bg-emerald-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              }`}>{y}</button>
            ))}
            <span className="ml-auto text-xs text-zinc-600 font-mono">{year}년 합계 ₩{(vendorTotal / 10_000).toFixed(0)}만</span>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">{year}년 Top 30 가맹점 <span className="text-[10px] text-zinc-600 ml-1">클릭 = 거래</span></h3>
            {loading ? <p className="text-zinc-500 text-sm">로딩 중...</p> : (
              <ul className="space-y-1">
                {vendors.map((v, i) => (
                  <li key={v.vendor}>
                    <button onClick={() => { setDetail({ kind: "vendor", name: v.vendor }); }} className="w-full flex items-baseline justify-between text-sm py-1 px-2 border-b border-zinc-800/40 hover:bg-zinc-800/40 rounded transition text-left">
                      <span className="flex items-baseline gap-2 truncate"><span className="text-[10px] font-mono text-zinc-600 w-6">{i + 1}.</span><span className="text-zinc-200 truncate">{v.vendor}</span><span className="text-[10px] text-zinc-600 font-mono">{v.count}회</span></span>
                      <span className="text-zinc-300 font-mono shrink-0">₩{(v.total / 10_000).toFixed(0)}만</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {view === "search" && (
        <>
          <form onSubmit={(e) => { e.preventDefault(); setCommittedQuery(query.trim()); }} className="flex gap-2 mb-6">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="가맹점 (예: 스타벅스, 쿠팡, 숨고)"
              className="flex-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-sm focus:outline-none focus:border-emerald-600" />
            <button type="submit" className="px-4 py-2 bg-emerald-700 text-white rounded text-sm hover:bg-emerald-600">검색</button>
          </form>
          {committedQuery && <p className="text-xs text-zinc-500 mb-3 font-mono">&quot;{committedQuery}&quot; — {search?.length ?? 0}건 · ₩{(searchTotal / 10_000).toFixed(0)}만 (4년 누적)</p>}
          {loading ? <p className="text-zinc-500 text-sm">로딩 중...</p> : search && (
            <ul className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800/40">
              {search.map((t, i) => (
                <li key={i} className="px-4 py-2.5 flex items-baseline justify-between text-sm">
                  <span className="flex items-baseline gap-2 truncate"><span className="text-[10px] text-zinc-500 font-mono shrink-0">{t.date}</span><span className="text-zinc-200 truncate">{t.vendor}</span>{t.subcategory && <span className="text-[10px] text-zinc-600 truncate">· {t.subcategory}</span>}</span>
                  <span className={`font-mono shrink-0 ${kindColor[t.business_or_personal]}`}>₩{t.amount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => { setDetail(null); setDetailItems(null); setVendorGuide(""); }}>
          <div className="bg-zinc-950 border border-zinc-700 rounded-xl max-w-3xl w-full mt-12 mb-12 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-baseline justify-between sticky top-0 bg-zinc-950 rounded-t-xl">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">
                  {detail.kind === "category" ? `📂 ${detail.name}` : `🏪 ${detail.name}`}
                  {month && view === "month" && <span className="text-zinc-500 text-sm ml-2 font-mono">{month}</span>}
                  {view !== "month" && <span className="text-zinc-500 text-sm ml-2 font-mono">전체 기간</span>}
                </h3>
                {detailItems && <p className="text-xs text-zinc-500 font-mono mt-1">{detailItems.length}건 · 총 ₩{detailTotal.toLocaleString()} ({(detailTotal / 10_000).toFixed(0)}만)</p>}
              </div>
              <button onClick={() => { setDetail(null); setDetailItems(null); setVendorGuide(""); }} className="text-zinc-500 hover:text-zinc-200 text-2xl leading-none px-2">×</button>
            </div>
            <div className="overflow-y-auto p-4">
              {detailLoading && <p className="text-zinc-500 text-sm">로딩 중...</p>}
              {!detailLoading && detailItems && detailItems.length === 0 && <p className="text-zinc-500 text-sm">결과 없음.</p>}
              {!detailLoading && detailItems && detailItems.length > 0 && (
                <ul className="divide-y divide-zinc-800/60">
                  {detailItems.map((t, i) => (
                    <li key={i} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0">{t.date}</span>
                            <span className="text-zinc-200 truncate font-medium">{t.vendor}</span>
                          </div>
                          <div className="flex items-baseline gap-2 mt-0.5 text-[11px] text-zinc-500">
                            {t.subcategory && <span>{t.subcategory}</span>}
                            {t.card && <span className="text-zinc-600">· {t.card}</span>}
                            <span className={`${kindColor[t.business_or_personal]}`}>· {t.business_or_personal === "biz" ? "비즈" : "개인"}</span>
                          </div>
                        </div>
                        <span className="text-zinc-200 font-mono text-sm shrink-0">₩{t.amount.toLocaleString()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600 mt-8 font-mono">KB(SMS+xls) + 네이버페이 (1년) + 현대카드 통합 {summary?.record_count.toLocaleString()}건 · AI: Gemini 2.5 Flash</p>
    </div>
  );
}
