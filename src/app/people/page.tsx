"use client";
import { useEffect, useMemo, useState } from "react";

type Person = {
  name: string; role: string;
  kind: "internal" | "external-press" | "external-analyst" | "external";
  handle: string;
  lastContact: string; lastContactTs: number; lastContactSource: string;
  overdue: boolean; freqDays: number;
  note: string;
  matchKeywords?: string[];
  matchEmails?: string[];
};
type PeopleFile = { updatedAt: number; people: Person[] };
type CalEvent = { id: string; title: string; start: string; end: string; cal?: string };
type MetEntry = { ts: number; date: string; title: string; cal?: string; matched: Person[] };

const KIND_LABEL: Record<string, string> = {
  internal: "내부", exec: "임원", ceo: "대표",
  "external-press": "기자", press: "기자",
  "external-analyst": "애널", analyst: "애널",
  mentor: "멘토", vc: "투자", lawyer: "변호사",
  brand: "브랜드", client: "클라이언트", creator: "크리에이터",
  friend: "친구", external: "외부",
};
const KIND_COLOR: Record<string, string> = {
  internal: "bg-cyan-900/40 text-cyan-300 border-cyan-900/60",
  exec: "bg-cyan-900/40 text-cyan-300 border-cyan-900/60",
  ceo: "bg-blue-900/40 text-blue-300 border-blue-900/60",
  "external-press": "bg-violet-900/40 text-violet-300 border-violet-900/60",
  press: "bg-violet-900/40 text-violet-300 border-violet-900/60",
  "external-analyst": "bg-amber-900/40 text-amber-300 border-amber-900/60",
  analyst: "bg-amber-900/40 text-amber-300 border-amber-900/60",
  mentor: "bg-emerald-900/40 text-emerald-300 border-emerald-900/60",
  vc: "bg-orange-900/40 text-orange-300 border-orange-900/60",
  lawyer: "bg-slate-900/40 text-slate-300 border-slate-700",
  brand: "bg-pink-900/40 text-pink-300 border-pink-900/60",
  client: "bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-900/60",
  creator: "bg-rose-900/40 text-rose-300 border-rose-900/60",
  friend: "bg-teal-900/40 text-teal-300 border-teal-900/60",
  external: "bg-zinc-800/60 text-zinc-300 border-zinc-800",
};

function ago(ts: number) {
  if (!ts) return "";
  const s = Math.floor(Date.now()/1000) - ts;
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s/60)}분 전`;
  if (s < 86400) return `${Math.floor(s/3600)}시간 전`;
  return `${Math.floor(s/86400)}일 전`;
}
function parseEventTs(s: string): number { if(!s) return 0; const t=new Date(s).getTime(); return Number.isNaN(t)?0:Math.floor(t/1000); }
function fmtDate(ts: number): string { const d=new Date(ts*1000); return `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; }
function yearStartTs(): number { return Math.floor(new Date(new Date().getFullYear(),0,1).getTime()/1000); }

function splitRole(role: string): { company: string; title: string } {
  if (!role) return { company: '', title: '' };
  const seps = [' / ', ' · ', '|', ',', ' - '];
  for (const sep of seps) {
    if (role.includes(sep)) {
      const [c, ...rest] = role.split(sep).map(s => s.trim());
      return { company: c, title: rest.join(' · ') };
    }
  }
  return { company: role, title: '' };
}
function extractPhone(p: Person): string {
  const re = /(0\d{1,2}-?\d{3,4}-?\d{4})/;
  if (p.handle) { const m = p.handle.match(re); if (m) return m[1]; }
  for (const kw of (p.matchKeywords||[])) { const m = kw.match(re); if (m) return m[1]; }
  if (p.note) { const m = p.note.match(re); if (m) return m[1]; }
  return p.handle && !p.handle.includes('@') ? p.handle : '';
}

function buildTimeline(events: CalEvent[], people: Person[]): MetEntry[] {
  const now=Math.floor(Date.now()/1000), cutoff=yearStartTs();
  const out: MetEntry[]=[];
  for (const ev of events) {
    const ts = parseEventTs(ev.start);
    if (ts<=0 || ts>now || ts<cutoff) continue;
    const title = ev.title || "";
    const matched: Person[] = [];
    for (const p of people) {
      const kws = p.matchKeywords||[];
      if (kws.some(kw => kw && title.includes(kw))) matched.push(p);
    }
    if (matched.length) out.push({ ts, date: fmtDate(ts), title, cal: ev.cal, matched });
  }
  return out.sort((a,b)=>b.ts-a.ts);
}

export default function PeoplePage() {
  const [data, setData] = useState<PeopleFile|null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tab, setTab] = useState<'dashboard'|'overdue'|'all'|'timeline'>('dashboard');
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<any>(null);
  const [aiError, setAiError] = useState('');

  async function refresh() {
    const r = await fetch('/people.json', { cache: 'no-store' });
    setData(await r.json());
  }
  async function previewAI() {
    setAiLoading(true); setAiError(''); setAiPreview(null);
    try {
      const r = await fetch('/api/people-ingest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: aiText })});
      const j = await r.json();
      if (j.error) setAiError(j.error); else setAiPreview(j.parsed);
    } catch (e:any) { setAiError(e.message); }
    finally { setAiLoading(false); }
  }
  async function commitAI() {
    setAiLoading(true); setAiError('');
    try {
      const r = await fetch('/api/people-ingest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ commit:true, parsed: aiPreview })});
      const j = await r.json();
      if (j.error) setAiError(j.error);
      else { setAiText(''); setAiPreview(null); await refresh(); }
    } catch (e:any) { setAiError(e.message); }
    finally { setAiLoading(false); }
  }

  useEffect(() => {
    fetch("/people.json",{cache:"no-store"}).then(r=>r.json()).then(setData).catch(()=>null);
    fetch("/events.json",{cache:"no-store"}).then(r=>r.json()).then(j=>setEvents(Array.isArray(j)?j:[])).catch(()=>null);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.people;
    if (kindFilter !== 'all') list = list.filter(p => p.kind === kindFilter);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter(p => p.name.toLowerCase().includes(qq) || (p.role||'').toLowerCase().includes(qq) || (p.handle||'').toLowerCase().includes(qq));
    return list;
  }, [data, q, kindFilter]);

  if (!data) return <div className="px-6 py-8 max-w-[1400px] mx-auto"><p className="text-sm text-zinc-500">로딩...</p></div>;

  const overdueList = filtered.filter(p=>p.overdue).sort((a,b)=>(a.lastContactTs||0)-(b.lastContactTs||0));
  const onTrack = filtered.filter(p=>!p.overdue).sort((a,b)=>(b.lastContactTs||0)-(a.lastContactTs||0));
  const timeline = buildTimeline(events, data.people);

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">people · Dex-style CRM</p>
        <h1 className="text-2xl font-semibold mt-1">인맥</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-zinc-500">
          <span>총 <span className="text-zinc-200 font-semibold">{data.people.length}</span>명</span>
          <span className="text-rose-400">⚑ overdue {data.people.filter(p=>p.overdue).length}</span>
          <span>on track {data.people.filter(p=>!p.overdue).length}</span>
          <span>업데이트 {ago(data.updatedAt)}</span>
        </div>
      </header>

      <section className="mb-5 rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-sm font-semibold text-cyan-300">🤖 AI 등록</span>
          <span className="text-[10px] text-zinc-500">자유롭게 입력 → 검수 → 등록</span>
        </div>
        <textarea
          value={aiText} onChange={e=>setAiText(e.target.value)}
          placeholder="예: 김매니저 (큐브엔터 영업팀, kim@cube.co.kr, 010-1234-5678) — 분기 1회 컨택"
          rows={2}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={previewAI} disabled={!aiText.trim()||aiLoading}
            className="text-xs px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white">
            {aiLoading?'검수 중...':'🔍 AI 검수'}
          </button>
          {aiPreview && (
            <button onClick={commitAI} disabled={aiLoading}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white">✓ 등록</button>
          )}
          {aiError && <span className="text-xs text-rose-400">{aiError}</span>}
        </div>
        {aiPreview && (
          <div className="mt-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
            <p className="text-zinc-400 mb-1">검수 결과 · 등록 누르면 people.json에 저장</p>
            <pre className="text-zinc-200 whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(aiPreview,null,2)}</pre>
          </div>
        )}
      </section>

      <div className="flex gap-2 mb-4 border-b border-zinc-800">
        <button onClick={()=>setTab('dashboard')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='dashboard'?'border-violet-500 text-violet-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>📊 대시보드</button>
        <button onClick={()=>setTab('overdue')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='overdue'?'border-rose-500 text-rose-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>⚑ 연락 필요 ({data.people.filter(p=>p.overdue).length})</button>
        <button onClick={()=>setTab('all')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='all'?'border-cyan-500 text-cyan-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>전체 인맥</button>
        <button onClick={()=>setTab('timeline')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='timeline'?'border-emerald-500 text-emerald-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>📅 올해 ({timeline.length})</button>
      </div>

      {tab === 'dashboard' && (() => {
        const KIND_GROUP: Record<string, string> = {
          internal:'사내',
          exec:'외부 임원', ceo:'외부 임원',
          press:'미디어','external-press':'미디어',
          analyst:'리서치','external-analyst':'리서치',
          mentor:'멘토·자문', vc:'멘토·자문', lawyer:'멘토·자문',
          brand:'브랜드·파트너', client:'브랜드·파트너', creator:'브랜드·파트너',
          friend:'친구', external:'기타',
        };
        const GROUP_COLOR: Record<string,string> = {
          '사내':'border-cyan-900/60 bg-cyan-950/20',
          '외부 임원':'border-blue-900/60 bg-blue-950/20',
          '미디어':'border-violet-900/60 bg-violet-950/20',
          '리서치':'border-amber-900/60 bg-amber-950/20',
          '멘토·자문':'border-emerald-900/60 bg-emerald-950/20',
          '브랜드·파트너':'border-pink-900/60 bg-pink-950/20',
          '친구':'border-teal-900/60 bg-teal-950/20',
          '기타':'border-zinc-700 bg-zinc-900/40',
        };
        const now = Math.floor(Date.now()/1000);
        const WK = 7*86400, MO = 30*86400;
        const recentWeek = data.people.filter(p => p.lastContactTs && now - p.lastContactTs < WK).sort((a,b)=>b.lastContactTs-a.lastContactTs);
        const recentMonth = data.people.filter(p => p.lastContactTs && now - p.lastContactTs < MO);
        const mailRecent = data.people.filter(p => p.lastContactSource?.toLowerCase().includes('mail') && p.lastContactTs && now - p.lastContactTs < MO).sort((a,b)=>b.lastContactTs-a.lastContactTs).slice(0,15);
        const overdueTop = data.people.filter(p=>p.overdue).sort((a,b)=>(a.lastContactTs||0)-(b.lastContactTs||0)).slice(0,15);
        const groups: Record<string, Person[]> = {};
        for (const p of data.people) (groups[KIND_GROUP[p.kind]||'기타'] ||= []).push(p);

        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-[10px] uppercase text-zinc-500 mb-1">총 인맥</p>
                <p className="text-2xl font-semibold text-zinc-100">{data.people.length}</p>
              </div>
              <div className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-4">
                <p className="text-[10px] uppercase text-rose-400 mb-1">연락 필요</p>
                <p className="text-2xl font-semibold text-rose-300">{data.people.filter(p=>p.overdue).length}</p>
              </div>
              <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4">
                <p className="text-[10px] uppercase text-emerald-400 mb-1">최근 7일 컨택</p>
                <p className="text-2xl font-semibold text-emerald-300">{recentWeek.length}</p>
              </div>
              <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4">
                <p className="text-[10px] uppercase text-cyan-400 mb-1">최근 30일 메일</p>
                <p className="text-2xl font-semibold text-cyan-300">{mailRecent.length}</p>
              </div>
            </div>

            <div>
              <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">분류 그룹</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                {['사내','외부 임원','미디어','리서치','멘토·자문','브랜드·파트너','친구','기타'].map(g => {
                  const arr = groups[g] || [];
                  return (
                    <button key={g} onClick={()=>{setTab('all'); setKindFilter('all'); setQ('');}}
                      className={`rounded-lg border p-3 text-left ${GROUP_COLOR[g]} hover:brightness-125`}>
                      <p className="text-[10px] uppercase text-zinc-400">{g}</p>
                      <p className="text-xl font-semibold text-zinc-100">{arr.length}</p>
                      <p className="text-[10px] text-zinc-500">overdue {arr.filter(p=>p.overdue).length}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h3 className="text-sm font-semibold text-emerald-300 mb-3">🕐 최근 7일 컨택 ({recentWeek.length})</h3>
                {recentWeek.length === 0 ? <p className="text-xs text-zinc-500">없음</p> : (
                  <ul className="space-y-1.5">
                    {recentWeek.slice(0,15).map(p => (
                      <li key={p.name} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-zinc-100">{p.name}</span>
                        <span className="text-[10px] text-zinc-500 truncate flex-1 ml-2">{splitRole(p.role).company}</span>
                        <span className="text-[10px] text-emerald-400 font-mono">{p.lastContact}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/10 p-4">
                <h3 className="text-sm font-semibold text-cyan-300 mb-3">✉ 최근 메일 인박스 ({mailRecent.length})</h3>
                {mailRecent.length === 0 ? <p className="text-xs text-zinc-500">없음</p> : (
                  <ul className="space-y-1.5">
                    {mailRecent.map(p => (
                      <li key={p.name} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-zinc-100">{p.name}</span>
                        <span className="text-[10px] text-zinc-500 truncate flex-1 ml-2">{splitRole(p.role).company}</span>
                        <span className="text-[10px] text-cyan-400 font-mono">{p.lastContact}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-rose-900/60 bg-rose-950/10 p-4">
              <h3 className="text-sm font-semibold text-rose-300 mb-3">⚑ 가장 오래 미연락 TOP 15</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                {overdueTop.map(p => (
                  <li key={p.name} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-zinc-100">{p.name}</span>
                    <span className="text-[10px] text-zinc-500 truncate flex-1 ml-2">{splitRole(p.role).company || p.role}</span>
                    <span className="text-[10px] text-rose-400">{p.lastContact || '기록 없음'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })()}

      {tab !== 'timeline' && tab !== 'dashboard' && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·역할·핸들 검색" className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm w-64"/>
          <select value={kindFilter} onChange={e=>setKindFilter(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm">
            <option value="all">전체 종류 ({data.people.length})</option>
            {Array.from(new Set(data.people.map(p=>p.kind))).sort((a,b) => data.people.filter(p=>p.kind===b).length - data.people.filter(p=>p.kind===a).length).map(k => (
              <option key={k} value={k}>{(KIND_LABEL[k]||k)} ({data.people.filter(p=>p.kind===k).length})</option>
            ))}
          </select>
        </div>
      )}

      {tab === 'timeline' && (
        <ul className="space-y-1.5">
          {timeline.map((m,i) => (
            <li key={`${m.ts}-${i}`} className="flex items-baseline gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
              <span className="font-mono text-xs text-emerald-400 w-12 shrink-0">{m.date}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{m.title}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {m.matched.map(p => (
                    <span key={p.name} className={`text-[10px] px-1.5 py-0.5 rounded border ${KIND_COLOR[p.kind]}`}>{p.name}</span>
                  ))}
                </div>
              </div>
              {m.cal && <span className="text-[10px] text-zinc-600 font-mono shrink-0">{m.cal}</span>}
            </li>
          ))}
        </ul>
      )}

      {tab === 'overdue' && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">이름</th>
                <th className="text-left px-3 py-2 font-medium">회사</th>
                <th className="text-left px-3 py-2 font-medium">직책</th>
                <th className="text-left px-3 py-2 font-medium">전화</th>
                <th className="text-left px-3 py-2 font-medium">분류</th>
                <th className="text-left px-3 py-2 font-medium">마지막 컨택</th>
                <th className="text-left px-3 py-2 font-medium">권장</th>
                <th className="text-left px-3 py-2 font-medium">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {overdueList.map(p => {
                const { company, title } = splitRole(p.role);
                const phone = extractPhone(p);
                return (
                <tr key={p.name} className="hover:bg-rose-950/20">
                  <td className="px-3 py-2 text-zinc-100 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-zinc-300 text-xs">{company || '-'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{title || '-'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs font-mono">{phone || '-'}</td>
                  <td className="px-3 py-2"><span className={`text-[9px] uppercase border px-1.5 py-0.5 rounded ${KIND_COLOR[p.kind]}`}>{KIND_LABEL[p.kind]}</span></td>
                  <td className="px-3 py-2 text-rose-400 text-xs">{p.lastContact || '기록 없음'}</td>
                  <td className="px-3 py-2 text-zinc-500 text-xs font-mono">{p.freqDays}일</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <a
                      href={`/outreach?name=${encodeURIComponent(p.name)}&email=${encodeURIComponent((p.matchEmails && p.matchEmails[0]) || "")}&note=${encodeURIComponent(`${p.role || ""} · 마지막 컨택 ${p.lastContact || "기록 없음"}`)}`}
                      className="text-sky-400 hover:text-sky-300"
                      title="외부 발송 메일 draft 작성"
                    >📧</a>
                  </td>
                </tr>
              )})}
              {overdueList.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">놓친 사람 없음 ✓</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'all' && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">이름</th>
                <th className="text-left px-3 py-2 font-medium">회사</th>
                <th className="text-left px-3 py-2 font-medium">직책</th>
                <th className="text-left px-3 py-2 font-medium">전화</th>
                <th className="text-left px-3 py-2 font-medium">분류</th>
                <th className="text-left px-3 py-2 font-medium">마지막 컨택</th>
                <th className="text-left px-3 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {[...overdueList, ...onTrack].map(p => {
                const { company, title } = splitRole(p.role);
                const phone = extractPhone(p);
                return (
                <tr key={p.name} className="hover:bg-zinc-900/50">
                  <td className="px-3 py-2 text-zinc-100 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-zinc-300 text-xs">{company || '-'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{title || '-'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs font-mono">{phone || '-'}</td>
                  <td className="px-3 py-2"><span className={`text-[9px] uppercase border px-1.5 py-0.5 rounded ${KIND_COLOR[p.kind]}`}>{KIND_LABEL[p.kind]}</span></td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{p.lastContact}</td>
                  <td className="px-3 py-2 text-xs">{p.overdue ? <span className="text-rose-400">⚑</span> : <span className="text-emerald-400">✓</span>}</td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
