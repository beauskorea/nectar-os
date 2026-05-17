"use client";
import { useEffect, useMemo, useState } from "react";

type Member = {
  name: string;
  realName?: string;
  role?: string;
  born?: number;
  nationality?: string;
};

type Talent = {
  name: string;
  role?: string;
  members?: Member[];
  briefUrl?: string;
  status?: "available" | "busy" | "reviewing";
  manager?: string;
  contact?: string;
  youtube?: string;
  instagram?: string;
  email?: string;
  twitter?: string;
};

type Partner = {
  name: string;
  category: "talent" | "makeup" | "media" | "expansion" | "mentor";
  status: "active" | "watching" | "dormant";
  contact: string;
  note: string;
  lastTouch: string;
  nextAction: string;
  briefUrl?: string;
  introducedBy?: string;
  talents?: Talent[];
};

type Data = { updatedAt: number; partners: Partner[] };

const CAT_LABEL: Record<string, string> = {
  talent: "연예인 · 셀럽 섭외",
  makeup: "메이크업샵",
  media: "미디어 · 콘텐츠 회사",
  expansion: "사업 확장",
  mentor: "멘토 · 네트워크",
};
const CAT_EMOJI: Record<string, string> = { talent: "🎤", makeup: "💄", media: "📺", expansion: "🚀", mentor: "🧭" };
const CAT_ORDER = ["talent", "makeup", "media", "expansion", "mentor"];

const PSTATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-300 border-emerald-900/60",
  watching: "bg-amber-900/40 text-amber-300 border-amber-900/60",
  dormant: "bg-zinc-800 text-zinc-400 border-zinc-700",
};
const PSTATUS_LABEL: Record<string, string> = { active: "진행중", watching: "추적중", dormant: "휴면" };

const TSTATUS_COLOR: Record<string, string> = {
  available: "text-emerald-400",
  reviewing: "text-amber-400",
  busy: "text-rose-400",
};
const TSTATUS_LABEL: Record<string, string> = { available: "섭외 가능", reviewing: "검토중", busy: "섭외 곤란" };

function daysAgo(date: string): string {
  if (!date) return "기록 없음";
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return "";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d < 1) return "오늘";
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

type FlatTalent = Talent & { agency: string; agencyCat: string; introducedBy?: string };

export default function PartnersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<any>(null);
  const [aiError, setAiError] = useState<string>("");

  async function refresh() {
    // partners.json (메인) + partners_supplement.json (넥타 보강 데이터 — sweep 회피)
    // supplement 의 members_by_talent[talent.name] 이 partners.json 의 talent.members 가 없을 때만 채워줌
    const [mainR, suppR] = await Promise.all([
      fetch("/partners.json", { cache: "no-store" }),
      fetch("/partners_supplement.json", { cache: "no-store" }).catch(() => null),
    ]);
    const main: Data = await mainR.json();
    let mbt: Record<string, Member[]> = {};
    let additional: Partner[] = [];
    try {
      if (suppR && suppR.ok) {
        const sup = await suppR.json();
        if (sup && sup.members_by_talent) mbt = sup.members_by_talent;
        if (Array.isArray(sup?.additional_partners)) additional = sup.additional_partners;
      }
    } catch {}
    // 메인 partners 이름 set — 중복 회피 (메인에 같은 이름 있으면 supplement 무시)
    const mainNames = new Set((main.partners || []).map((p) => p.name));
    const extras = additional.filter((p) => !mainNames.has(p.name));
    const allPartners = [...(main.partners || []), ...extras];
    const merged: Data = {
      updatedAt: main.updatedAt,
      partners: allPartners.map((p) => ({
        ...p,
        talents: (p.talents || []).map((t) => ({
          ...t,
          members: (t.members && t.members.length) ? t.members : (mbt[t.name] || undefined),
        })),
      })),
    };
    setData(merged);
  }

  useEffect(() => { refresh().catch(() => null); }, []);

  async function previewAI() {
    setAiLoading(true); setAiError(""); setAiPreview(null);
    try {
      const r = await fetch("/api/partners-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText }),
      });
      const j = await r.json();
      if (j.error) setAiError(j.error); else setAiPreview(j.parsed);
    } catch (e: any) { setAiError(e.message); }
    finally { setAiLoading(false); }
  }

  async function commitAI() {
    setAiLoading(true); setAiError("");
    try {
      const r = await fetch("/api/partners-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: true, parsed: aiPreview }),
      });
      const j = await r.json();
      if (j.error) setAiError(j.error);
      else { setAiText(""); setAiPreview(null); await refresh(); }
    } catch (e: any) { setAiError(e.message); }
    finally { setAiLoading(false); }
  }

  const flatTalents: FlatTalent[] = useMemo(() => {
    if (!data) return [];
    const out: FlatTalent[] = [];
    for (const p of data.partners) {
      for (const t of p.talents || []) out.push({ ...t, agency: p.name, agencyCat: p.category, introducedBy: p.introducedBy, autoIngested: p.autoIngested });
    }
    return out;
  }, [data]);

  const celebs = flatTalents.filter((t) => t.agencyCat !== "makeup");
  const makeups = flatTalents.filter((t) => t.agencyCat === "makeup");

  if (!data) {
    return <div className="px-6 py-8 max-w-[1600px] mx-auto"><p className="text-sm text-zinc-500">로딩...</p></div>;
  }

  const partners = data.partners;
  const byCat: Record<string, Partner[]> = {};
  for (const p of partners) (byCat[p.category] ||= []).push(p);

  return (
    <div className="px-6 py-8 max-w-[1600px] mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">partners · 미디어 · 엔터 확장</p>
        <h1 className="text-2xl font-semibold mt-1">파트너</h1>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-zinc-500">
          <span>회사 {partners.length}개</span>
          <span>인물 {flatTalents.length}명</span>
          <span className="text-emerald-400">● 진행중 {partners.filter(p=>p.status==="active").length}</span>
          <span className="text-amber-400">● 추적중 {partners.filter(p=>p.status==="watching").length}</span>
        </div>
      </header>

      {/* AI INGEST BOX */}
      <section className="mb-6 rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-sm font-semibold text-cyan-300">🤖 AI 등록</span>
          <span className="text-[10px] text-zinc-500">자유롭게 입력 → 검수 → 등록</span>
        </div>
        <textarea
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          placeholder="예: 서인영 유튜브 — 스튜디오범접 / 은혜PD / 010-2584-4295"
          rows={2}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={previewAI}
            disabled={!aiText.trim() || aiLoading}
            className="text-xs px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white"
          >
            {aiLoading ? "검수 중..." : "🔍 AI 검수"}
          </button>
          {aiPreview && (
            <button onClick={commitAI} disabled={aiLoading} className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
              ✓ 등록
            </button>
          )}
          {aiError && <span className="text-xs text-rose-400">{aiError}</span>}
        </div>
        {aiPreview && (
          <div className="mt-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
            <p className="text-zinc-400 mb-1">검수 결과 · 등록 누르면 partners.json에 저장</p>
            <pre className="text-zinc-200 whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(aiPreview, null, 2)}</pre>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
        {/* LEFT */}
        <div>
          {CAT_ORDER.map((cat) => {
            const list = byCat[cat] || [];
            if (list.length === 0) return null;
            return (
              <section key={cat} className="mb-6">
                <h2 className="text-sm uppercase tracking-wider text-zinc-400 mb-3">
                  {CAT_EMOJI[cat]} {CAT_LABEL[cat]} <span className="text-zinc-600 font-mono">({list.length})</span>
                </h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {list.map((p) => {
                    const exp = expanded[p.name];
                    const hasTalents = (p.talents?.length || 0) > 0;
                    return (
                      <div key={p.name} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-medium text-zinc-100">{p.name}</h3>
                          <span className={`text-[9px] uppercase tracking-wider border px-1.5 py-0.5 rounded ${PSTATUS_COLOR[p.status]}`}>
                            {PSTATUS_LABEL[p.status]}
                          </span>
                        </div>
                        {p.contact && p.contact !== "-" && <p className="text-xs text-zinc-400 mt-1">{p.contact}</p>}
                        {p.introducedBy && <p className="text-[11px] text-amber-400 mt-1">🤝 소개: {p.introducedBy}</p>}
                        {p.note && <p className="text-xs text-zinc-500 mt-2 italic">{p.note}</p>}
                        <div className="flex items-center justify-between gap-2 mt-3">
                          <div className="flex items-center gap-2 text-[10px] font-mono">
                            {p.briefUrl ? (
                              <a href={p.briefUrl} target="_blank" rel="noopener" className="text-cyan-400 hover:text-cyan-300">📄 소개서</a>
                            ) : (
                              <span className="text-zinc-600">📄 없음</span>
                            )}
                            {hasTalents && (
                              <button onClick={() => setExpanded((s) => ({ ...s, [p.name]: !s[p.name] }))} className="text-violet-400 hover:text-violet-300">
                                👥 {p.talents!.length}명 {exp ? "▲" : "▼"}
                              </button>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-600 font-mono">{daysAgo(p.lastTouch)}</span>
                        </div>
                        {p.nextAction && p.nextAction !== "-" && (
                          <p className="mt-2 text-[10px] text-emerald-400 font-mono">→ {p.nextAction}</p>
                        )}
                        {exp && hasTalents && (
                          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1 text-xs">
                            {p.talents!.map((t) => (
                              <div key={t.name} className="flex items-baseline justify-between gap-2">
                                <span className="text-zinc-200">{t.name}</span>
                                {t.role && <span className="text-[10px] text-zinc-500">{t.role}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* RIGHT */}
        <aside className="lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto space-y-5">
          <TalentPanel title="🎬 연예인 · 인물" items={celebs} />
          <TalentPanel title="💄 메이크업" items={makeups} emptyHint="makeup 카테고리에 회사/아티스트 등록하세요 (AI 등록 박스에 'OOO 메이크업샵 ...' 입력)" />
        </aside>
      </div>
    </div>
  );
}

function TalentPanel({ title, items, emptyHint }: { title: string; items: FlatTalent[]; emptyHint?: string }) {
  const [q, setQ] = useState("");
  const filtered = items.filter(t => {
    if (!q.trim()) return true;
    const qq = q.toLowerCase();
    return (t.name||'').toLowerCase().includes(qq) || (t.agency||'').toLowerCase().includes(qq) || (t.role||'').toLowerCase().includes(qq);
  });
  return (
    <div>
      <h2 className="text-sm uppercase tracking-wider text-zinc-400 mb-2">{title} <span className="text-zinc-600 font-mono">({filtered.length}{q?`/${items.length}`:''})</span></h2>
      {items.length > 0 && (
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="검색"
          className="w-full mb-3 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600"/>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">{emptyHint || "등록된 항목 없음"}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={`${t.agency}__${t.name}`} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-zinc-100">{t.name}</h3>
                {t.status && <span className={`text-[10px] ${TSTATUS_COLOR[t.status]}`}>● {TSTATUS_LABEL[t.status]}</span>}
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {t.role && <span>{t.role} · </span>}
                <span className="text-violet-400">{t.agency}</span>
                {t.autoIngested && (
                  <>
                    <span className="ml-1.5 text-[9px] px-1 py-px rounded bg-sky-900/40 text-sky-300 border border-sky-700/40" title="메일에서 자동 인입 — 검토 필요">🤖 auto</span>
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const r = await fetch("/api/partners-approve", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: t.agency }),
                          });
                          if (r.ok) location.reload();
                          else alert("approve 실패: " + (await r.text()));
                        } catch (err) {
                          alert("approve 에러: " + String(err));
                        }
                      }}
                      className="ml-1 text-[9px] px-1 py-px rounded border border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-200"
                      title="검토 완료 — 🤖 배지 제거 + 데이터 유지"
                    >
                      ✓ ok
                    </button>
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!confirm(`'${t.agency}' 자동 인입 항목을 reject 하시겠습니까?\n(supplement 에서 제거 + 재인입 차단 ledger 등록)`)) return;
                        try {
                          const r = await fetch("/api/partners-reject", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: t.agency, reason: "user reject from /partners" }),
                          });
                          if (r.ok) location.reload();
                          else alert("reject 실패: " + (await r.text()));
                        } catch (err) {
                          alert("reject 에러: " + String(err));
                        }
                      }}
                      className="ml-1 text-[9px] px-1 py-px rounded border border-rose-800/50 text-rose-400 hover:bg-rose-900/40 hover:text-rose-200"
                      title="자동 인입 항목 제거 + 재인입 차단"
                    >
                      ⊘ reject
                    </button>
                  </>
                )}
              </p>
              {(t.manager || t.contact || t.introducedBy) && (
                <div className="mt-2 space-y-0.5 text-[11px]">
                  {t.manager && <p className="text-zinc-400">👤 담당: {t.manager}</p>}
                  {t.contact && <p className="text-zinc-400 font-mono">📞 {t.contact}</p>}
                  {t.introducedBy && <p className="text-amber-400">🤝 소개: {t.introducedBy}</p>}
                </div>
              )}
              {(t.email || t.youtube || t.instagram || t.twitter || t.briefUrl) && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
                  {t.youtube && <a href={t.youtube} target="_blank" rel="noopener" className="text-red-400 hover:text-red-300">▶ YouTube</a>}
                  {t.instagram && <a href={t.instagram} target="_blank" rel="noopener" className="text-pink-400 hover:text-pink-300">📷 Instagram</a>}
                  {t.twitter && <a href={t.twitter} target="_blank" rel="noopener" className="text-sky-400 hover:text-sky-300">𝕏 Twitter</a>}
                  {t.email && <a href={`mailto:${t.email}`} className="text-cyan-400 hover:text-cyan-300">✉ {t.email}</a>}
                  {t.briefUrl && t.briefUrl !== t.youtube && <a href={t.briefUrl} target="_blank" rel="noopener" className="text-violet-400 hover:text-violet-300">📄 프로필</a>}
                </div>
              )}
              {t.members && t.members.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] text-violet-400 mb-1">👥 멤버 {t.members.length}명</p>
                  <ul className="ml-1 pl-2 border-l border-zinc-800 space-y-1">
                    {t.members.map((m) => (
                      <li key={m.name} className="text-[11px]">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-zinc-100 font-medium">{m.name}</span>
                          {m.realName && <span className="text-zinc-500 text-[10px]">({m.realName})</span>}
                          {m.nationality && m.nationality !== "KR" && (
                            <span className="text-[10px] text-zinc-600 font-mono">{m.nationality}</span>
                          )}
                        </div>
                        {(m.role || m.born) && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            {m.role && <span>{m.role}</span>}
                            {m.role && m.born && <span> · </span>}
                            {m.born && <span className="font-mono">{m.born}년생</span>}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
