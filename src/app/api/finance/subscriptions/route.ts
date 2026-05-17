import { SAMPLE_TRANSACTIONS, SAMPLE_SUBSCRIPTIONS, listSubscriptions } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET() {
  // 1) 카드 표시용 정적 구독 리스트 (UI 호환 — moneyKpi.subscriptions 그대로)
  // 2) 트랜잭션 기반 derived 리스트 (recurring=true 거래의 latest)
  const derived = listSubscriptions(SAMPLE_TRANSACTIONS);
  const monthlyTotal = SAMPLE_SUBSCRIPTIONS.reduce((s, x) => s + x.monthly, 0);
  return Response.json({
    monthly_total_krw: monthlyTotal,
    subscriptions: SAMPLE_SUBSCRIPTIONS,
    derived_from_transactions: derived,
    source: "mock",
  });
}
