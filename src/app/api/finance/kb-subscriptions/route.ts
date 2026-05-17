// /api/finance/kb-subscriptions
// 반복 결제 감지 — 같은 vendor가 매월 ±35일 간격으로 결제 + amount 편차 적으면 구독.
// 결과: 활성 구독, 휴면(최근 60일 결제 X), 의심 (1회만)
import { loadKbTransactions } from "@/lib/finance/kb-loader";

export const dynamic = "force-dynamic";

type Tx = { date: string; vendor: string; amount: number; category: string; subcategory?: string | null; business_or_personal: "biz" | "personal" };

export async function GET() {
  const txs = await loadKbTransactions() as Tx[];
  // vendor + amount(반올림) 그룹
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    const key = t.vendor;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const today = new Date();
  const subs = [];
  for (const [vendor, list] of groups.entries()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    // 결제 간격 분석
    const intervals: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const d1 = new Date(list[i - 1].date).getTime();
      const d2 = new Date(list[i].date).getTime();
      intervals.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
    if (intervals.length === 0) continue;
    const avgInterval = intervals.reduce((s, n) => s + n, 0) / intervals.length;
    const monthlyLike = intervals.filter((d) => d >= 25 && d <= 40).length;
    const yearlyLike = intervals.filter((d) => d >= 330 && d <= 400).length;
    // 매월 결제 + 결제 빈도가 60% 이상이면 구독
    const monthRatio = monthlyLike / intervals.length;
    const yearRatio = yearlyLike / intervals.length;
    if (monthRatio < 0.5 && yearRatio < 0.5) continue;

    const amounts = list.map((t) => t.amount);
    const avgAmount = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const variance = Math.sqrt(amounts.reduce((s, n) => s + (n - avgAmount) ** 2, 0) / amounts.length);
    const varRatio = avgAmount > 0 ? variance / avgAmount : 1;
    // 금액 편차 50% 이내
    if (varRatio > 0.5) continue;

    const lastTx = list[list.length - 1];
    const daysSinceLast = Math.round((today.getTime() - new Date(lastTx.date).getTime()) / (1000 * 60 * 60 * 24));
    const period = yearRatio >= monthRatio ? "yearly" : "monthly";
    const monthlyEquiv = period === "monthly" ? avgAmount : avgAmount / 12;
    const annualEquiv = monthlyEquiv * 12;

    // 활성 / 휴면 / 종료 분류
    let status: "active" | "dormant" | "ended";
    if (period === "monthly" && daysSinceLast > 60) status = "ended";
    else if (period === "yearly" && daysSinceLast > 400) status = "ended";
    else if (daysSinceLast > 40 && period === "monthly") status = "dormant";
    else status = "active";

    subs.push({
      vendor,
      category: list[0].category,
      subcategory: list[0].subcategory ?? null,
      kind: list[0].business_or_personal,
      period,
      count: list.length,
      avg_amount: Math.round(avgAmount),
      monthly_equiv: Math.round(monthlyEquiv),
      annual_equiv: Math.round(annualEquiv),
      avg_interval_days: Math.round(avgInterval),
      first_date: list[0].date,
      last_date: lastTx.date,
      days_since_last: daysSinceLast,
      status,
      total_paid: amounts.reduce((s, n) => s + n, 0),
    });
  }

  subs.sort((a, b) => b.monthly_equiv - a.monthly_equiv);
  const active = subs.filter((s) => s.status === "active");
  const dormant = subs.filter((s) => s.status === "dormant");
  const ended = subs.filter((s) => s.status === "ended");

  return Response.json({
    total_count: subs.length,
    active_count: active.length,
    dormant_count: dormant.length,
    ended_count: ended.length,
    active_monthly_total: active.reduce((s, x) => s + x.monthly_equiv, 0),
    active_annual_total: active.reduce((s, x) => s + x.annual_equiv, 0),
    active,
    dormant,
    ended,
  });
}
