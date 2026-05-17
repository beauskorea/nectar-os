"use client";
import ReviewPromptItem from "@/components/ReviewPromptItem";

// 인라인 데이터 (mockData.ts 청산) — Phase 2에 실데이터로 매핑 예정
const WEEKLY_PROMPTS = [
  { id: "w1", q: "이번 주 가장 큰 진전 1개?", helper: "SEED Phase / 매거진 / 신규 클라이언트 등" },
  { id: "w2", q: "이번 주 실패·미완료 1개?", helper: "이유와 다음 주 어떻게 처리할지" },
  { id: "w3", q: "다음 주 1순위?", helper: "월요일 09:00에 무엇부터 시작?" },
  { id: "w4", q: "에너지 평균?", helper: "1-5점 (5=완전 충전, 1=완전 방전)" },
  { id: "w5", q: "이번 주 배운 점 1개?", helper: "비즈 / 사람 / 본인 어느 영역이든" },
];

const ENERGY_TREND_4W = [4.0, 4.1, 4.0, 4.0]; // TODO: monthlyKpiTrend.energy_avg.slice(-4) 실데이터화

function getWeekRange() {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;
  return { range: `${fmt(monday)} ~ ${fmt(sunday)}`, monday };
}

function isoWeekKey(d: Date): string {
  // 2026-W20 형식
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export default function Weekly() {
  const now = new Date();
  const { range } = getWeekRange();
  const period = isoWeekKey(now);
  const weekNum = parseInt(period.split("W")[1], 10);

  return (
    <div className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-zinc-500">weekly review</p>
        <h1 className="text-3xl font-semibold mt-1">
          {weekNum}주차 <span className="text-zinc-500 text-xl ml-2">({range})</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-2">
          Lattice 회고 패턴 — 매주 일요일 22:00 자동 prompt. 자동 저장 (브라우저 / period={period}).
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">✍ 회고 5문답</h2>
        <ul className="space-y-3">
          {WEEKLY_PROMPTS.map((p) => (
            <ReviewPromptItem key={p.id} kind="weekly" period={period} prompt={p} rows={2} />
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">⚡ 최근 4주 에너지 평균</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-end gap-4 h-20">
            {ENERGY_TREND_4W.map((n, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-sm ${
                    n >= 4 ? "bg-emerald-500/70" : n >= 3 ? "bg-zinc-500/60" : "bg-rose-500/60"
                  }`}
                  style={{ height: `${(n / 5) * 100}%` }}
                />
                <span className="text-[10px] text-zinc-500 font-mono">{n.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-2 font-mono">최근 → 이번 주 (※ mock — 실데이터 매핑 대기)</p>
        </div>
      </section>

      <div className="text-xs text-zinc-600 font-mono">Lattice + Range + Reflect 영감</div>
    </div>
  );
}
