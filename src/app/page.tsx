import { getDefaultMoneyKpi } from "@/lib/finance";
const moneyKpi = getDefaultMoneyKpi();
import InboxRecentCard from "@/components/InboxRecentCard";
import OverduePeopleCard from "@/components/OverduePeopleCard";
import TodayIntention from "@/components/TodayIntention";
import NextEventsCard from "@/components/NextEventsCard";
import MailDigestWidget from "@/components/MailDigestWidget";
import ActionStrip from "@/components/ActionStrip";
import DayBrief from "@/components/DayBrief";
import QuickCapture from "@/components/QuickCapture";
import HomeMeetingPulse from "@/components/HomeMeetingPulse";
import HighlightsCard from "@/components/HighlightsCard";

function Card({
  title,
  href,
  hint,
  external,
  children,
}: {
  title: string;
  href?: string;
  hint?: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const header = (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
      {hint && <span className="text-[10px] text-zinc-600 font-mono">{hint}</span>}
    </div>
  );
  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-600 transition h-full"
      >
        {header}
        {children}
      </a>
    );
  }
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-700 transition h-full">
      {header}
      {children}
    </div>
  );
}

function SectionLabel({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  return (
    <div className="mt-8 mb-3 flex items-baseline justify-between">
      <div className="flex items-baseline gap-2">
        <span className="text-base">{emoji}</span>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">{title}</h2>
      </div>
      {hint && <span className="text-[10px] text-zinc-600 font-mono">{hint}</span>}
    </div>
  );
}

export default function Today() {
  const date = new Date();
  const formatted = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  const day = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  const spentPct = Math.round((moneyKpi.spent / moneyKpi.budget) * 100);

  return (
    <div className="px-6 lg:px-8 py-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500">today</p>
        <h1 className="text-3xl font-semibold mt-1">
          {formatted} <span className="text-zinc-500">({day})</span>
        </h1>
        <TodayIntention />
      </header>

      {/* ───── 🌅 오늘 모드 — 브리핑 + 액션 + 캡처 ───── */}
      <SectionLabel emoji="🌅" title="오늘 모드" hint="brief · action · capture" />
      <DayBrief />
      <ActionStrip />
      <QuickCapture />

      {/* ───── 📅 일정 & 미팅 펄스 ───── */}
      <SectionLabel emoji="📅" title="일정 & 미팅" hint="다음 일정 · 이번주 패턴" />
      <section className="grid grid-cols-1 lg:grid-cols-3 auto-rows-fr gap-4 mb-4">
        <div className="lg:col-span-2 h-full"><NextEventsCard /></div>
        <div className="h-full"><HomeMeetingPulse /></div>
      </section>

      {/* ───── 👥 사람 & 인박스 ───── */}
      <SectionLabel emoji="👥" title="사람 & 인박스" hint="overdue · mail · inbox" />
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">
        <OverduePeopleCard />
        <Card title="📧 메일 다이제스트" hint="live">
          <MailDigestWidget />
        </Card>
        <InboxRecentCard />
      </section>

      {/* ───── 🧭 운영 · 재무 · 분석 ───── */}
      <SectionLabel emoji="🧭" title="운영 · 재무 · 분석" hint="체크 · money · brand" />
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">

        <Card title="💰 이번 달" href="/money" hint={`${moneyKpi.monthLabel}`}>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-zinc-100">
                ₩{(moneyKpi.spent / 10_000).toFixed(0)}만
              </span>
              <span className="text-xs text-zinc-500">
                / ₩{(moneyKpi.budget / 10_000).toFixed(0)}만 예산
              </span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${spentPct > 80 ? "bg-rose-400" : "bg-emerald-400"}`}
                style={{ width: `${Math.min(spentPct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">{spentPct}% 사용</p>
          </div>
        </Card>
      </section>

      {/* ───── 🎯 신경 써야 할 것 (맨 아래) ───── */}
      <SectionLabel emoji="🎯" title="신경 써야 할 것" hint="risk / issue / win" />
      <HighlightsCard />
    </div>
  );
}
