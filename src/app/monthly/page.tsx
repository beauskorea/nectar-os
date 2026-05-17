"use client";
import ReviewPromptItem from "@/components/ReviewPromptItem";

// 인라인 데이터 (mockData.ts 청산) — Phase 2에 실데이터로 매핑 예정
const MONTHLY_PROMPTS = [
  { id: "m1", q: "이번 달 가장 큰 진전 1개?", helper: "" },
  { id: "m2", q: "이번 달 실패·정체 1개?", helper: "이유와 다음 달 어떻게 처리할지" },
  { id: "m3", q: "다음 달 목표 1개?", helper: "가장 중요한 결과 1개로 좁히기" },
  { id: "m4", q: "이번 달 인사이트?", helper: "비즈/사람/본인 — 한 줄로 압축" },
];

const KPI_TREND = {
  months: [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11",
    "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  ],
  seed_applications: [0, 0, 0, 0, 270, 0, 122, 0, 0, 256, 75, 399],
  magazine_published: [3, 4, 5, 4, 6, 7, 5, 6, 8, 7, 9, 2],
  clients_active: [8, 8, 9, 9, 10, 10, 10, 11, 11, 11, 11, 11],
  energy_avg: [3.5, 3.8, 4.0, 3.6, 4.1, 4.3, 3.9, 4.0, 4.2, 4.0, 4.1, 4.0],
};

const NOW_KPI = {
  exclusive: 66,
  trainee: 38,
  clients_total: 11,
  active_campaigns: 4,
};

function MetricRow({
  label,
  data,
  color,
  format,
}: {
  label: string;
  data: number[];
  color: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...data, 1);
  const recent = data[data.length - 1];
  const prev = data[data.length - 2];
  const delta = recent - prev;
  const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">{label}</h3>
        <div className="text-right">
          <p className={`text-xl font-semibold ${color}`}>
            {format ? format(recent) : recent}
          </p>
          <p
            className={`text-xs ${
              delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-zinc-500"
            }`}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta)}{" "}
            {deltaPct !== 0 && `(${deltaPct > 0 ? "+" : ""}${deltaPct}%)`}
          </p>
        </div>
      </div>
      <div className="flex items-end gap-1 h-12">
        {data.map((n, i) => {
          const isLast = i === data.length - 1;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm ${
                isLast ? color.replace("text-", "bg-") : "bg-zinc-700/40"
              }`}
              style={{ height: `${(n / max) * 100}%` }}
              title={`${n}`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function Monthly() {
  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-zinc-500">monthly review</p>
        <h1 className="text-3xl font-semibold mt-1">{monthLabel}</h1>
        <p className="text-sm text-zinc-400 mt-2">
          이번 달 비즈 KPI · 12개월 트렌드 · 회고 4문답. 자동 저장 (브라우저 / period={period}).
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">📊 12개월 KPI 트렌드 (mock)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricRow label="🌱 SEED 신청자"     data={KPI_TREND.seed_applications} color="text-emerald-400" />
          <MetricRow label="📰 매거진 발행"     data={KPI_TREND.magazine_published} color="text-blue-400" />
          <MetricRow label="🏢 활성 클라이언트" data={KPI_TREND.clients_active}     color="text-rose-300" />
          <MetricRow
            label="⚡ 에너지 평균"
            data={KPI_TREND.energy_avg.map((n) => Math.round(n * 10))}
            color="text-violet-400"
            format={(n) => (n / 10).toFixed(1)}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">🎯 현재 상태 (mock)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase text-zinc-500">전속</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1">{NOW_KPI.exclusive}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase text-zinc-500">연습생</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1">{NOW_KPI.trainee}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase text-zinc-500">클라이언트</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1">{NOW_KPI.clients_total}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase text-zinc-500">활성 캠페인</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1">{NOW_KPI.active_campaigns}</p>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">✍ 월간 회고 4문답</h2>
        <ul className="space-y-3">
          {MONTHLY_PROMPTS.map((p) => (
            <ReviewPromptItem key={p.id} kind="monthly" period={period} prompt={p} rows={3} />
          ))}
        </ul>
      </section>

      <div className="text-xs text-zinc-600 font-mono">Lattice OKR + Notion CEO + Capacities 영감</div>
    </div>
  );
}
