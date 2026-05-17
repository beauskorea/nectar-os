"use client";
import { useEffect, useMemo, useState } from "react";

type Creator = { name: string; channel?: string; subscribers?: string; contact?: string; address?: string; agency?: string; sources?: string[] };
type Recipient = { recipient: string; status?: string };
type Campaign = { brand: string; kit: string; sheet: string; recipients: Recipient[]; count: number };
type Data = { updatedAt: number; creators: Creator[]; campaigns: Campaign[] };

const BRAND_COLOR: Record<string,string> = {
  '라카':'text-pink-300 border-pink-900/60 bg-pink-900/30',
  '더마픽스':'text-cyan-300 border-cyan-900/60 bg-cyan-900/30',
  '프롬바이오':'text-emerald-300 border-emerald-900/60 bg-emerald-900/30',
  '코드글로컬러':'text-violet-300 border-violet-900/60 bg-violet-900/30',
  '루아센시아':'text-amber-300 border-amber-900/60 bg-amber-900/30',
  '믹순':'text-rose-300 border-rose-900/60 bg-rose-900/30',
  '한스킨':'text-sky-300 border-sky-900/60 bg-sky-900/30',
  '미샤':'text-orange-300 border-orange-900/60 bg-orange-900/30',
};

function parseSubs(s?: string): number {
  if (!s) return 0;
  const t = String(s).replace(/[,\s]/g,'');
  const m = t.match(/^([\d.]+)(만|k|K|천)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === '만') return n * 10000;
  if (m[2] === '천') return n * 1000;
  if (m[2]?.toLowerCase() === 'k') return n * 1000;
  return n;
}

export default function SeedingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<'campaigns'|'creators'>('campaigns');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'subs'|'name'|'sources'>('subs');
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  useEffect(() => {
    fetch('/seeding.json', { cache: 'no-store' }).then(r=>r.json()).then(setData).catch(()=>null);
  }, []);

  const filteredCreators = useMemo(() => {
    if (!data) return [];
    const qq = q.trim().toLowerCase();
    let list = data.creators.filter(c => !qq || (c.name||'').toLowerCase().includes(qq) || (c.agency||'').toLowerCase().includes(qq));
    if (sort === 'subs') list = [...list].sort((a,b) => parseSubs(b.subscribers) - parseSubs(a.subscribers));
    else if (sort === 'name') list = [...list].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    else if (sort === 'sources') list = [...list].sort((a,b) => (b.sources?.length||0) - (a.sources?.length||0));
    return list;
  }, [data, q, sort]);

  if (!data) return <div className="px-6 py-8 max-w-[1600px] mx-auto"><p className="text-sm text-zinc-500">로딩...</p></div>;

  const totalSent = data.campaigns.reduce((s,c)=>s+c.count, 0);

  return (
    <div className="px-6 py-8 max-w-[1600px] mx-auto">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">seeding · 프레스키트 · 캠페인 트래커</p>
        <h1 className="text-2xl font-semibold mt-1">시딩</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-zinc-500">
          <span>크리에이터 마스터 <span className="text-zinc-200 font-semibold">{data.creators.length}</span>명</span>
          <span>캠페인 <span className="text-zinc-200 font-semibold">{data.campaigns.length}</span>개</span>
          <span>총 발송 <span className="text-zinc-200 font-semibold">{totalSent}</span>건</span>
        </div>
      </header>

      <div className="flex gap-2 mb-5 border-b border-zinc-800">
        <button onClick={()=>setTab('campaigns')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='campaigns'?'border-cyan-500 text-cyan-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>📦 캠페인</button>
        <button onClick={()=>setTab('creators')} className={`text-sm px-4 py-2 -mb-px border-b-2 ${tab==='creators'?'border-cyan-500 text-cyan-300':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>👥 크리에이터 마스터</button>
      </div>

      {tab === 'campaigns' && (
        <div className="space-y-2">
          {data.campaigns.map(c => {
            const key = c.sheet;
            const open = openCampaign === key;
            return (
              <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                <button
                  onClick={() => setOpenCampaign(open ? null : key)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/70"
                >
                  <span className={`text-[10px] uppercase font-semibold border px-2 py-0.5 rounded ${BRAND_COLOR[c.brand]||'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>{c.brand}</span>
                  <span className="text-sm text-zinc-100 flex-1">{c.kit}</span>
                  <span className="text-xs text-zinc-500 font-mono">{c.count}명</span>
                  <span className="text-xs text-zinc-600">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/40">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                      {c.recipients.map((r,i) => (
                        <div key={i} className="flex items-baseline justify-between gap-2 py-1 border-b border-zinc-800/40">
                          <span className="text-zinc-300 truncate">{r.recipient}</span>
                          {r.status && <span className="text-[10px] text-emerald-400 shrink-0">✓</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'creators' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·소속사 검색" className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm w-64"/>
            <select value={sort} onChange={e=>setSort(e.target.value as any)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm">
              <option value="subs">구독자 많은 순</option>
              <option value="name">이름 순</option>
              <option value="sources">캠페인 참여 많은 순</option>
            </select>
            <span className="text-xs text-zinc-500 ml-2">{filteredCreators.length}/{data.creators.length}</span>
          </div>
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">이름</th>
                  <th className="text-left px-3 py-2 font-medium">구독자</th>
                  <th className="text-left px-3 py-2 font-medium">소속사</th>
                  <th className="text-left px-3 py-2 font-medium">연락처</th>
                  <th className="text-left px-3 py-2 font-medium">주소</th>
                  <th className="text-left px-3 py-2 font-medium">캠페인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredCreators.map(c => (
                  <tr key={c.name} className="hover:bg-zinc-900/50">
                    <td className="px-3 py-2 text-zinc-100 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-zinc-400 font-mono">{c.subscribers || '-'}</td>
                    <td className="px-3 py-2 text-violet-400 text-xs">{c.agency || '-'}</td>
                    <td className="px-3 py-2 text-zinc-400 font-mono text-xs">{c.contact || '-'}</td>
                    <td className="px-3 py-2 text-zinc-500 text-xs truncate max-w-[200px]" title={c.address}>{c.address ? c.address.slice(0,30)+(c.address.length>30?'…':'') : '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(c.sources||[]).map(s => <span key={s} className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{s}</span>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
