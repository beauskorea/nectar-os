import { SAMPLE_TRANSACTIONS } from "@/lib/finance";
import type { FinanceCategory, FinanceKind } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // "2026-05"
  const category = url.searchParams.get("category") as FinanceCategory | null;
  const kind = url.searchParams.get("kind") as FinanceKind | null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 500);

  let items = [...SAMPLE_TRANSACTIONS];
  if (month) items = items.filter((t) => t.date.startsWith(month));
  if (category) items = items.filter((t) => t.category === category);
  if (kind) items = items.filter((t) => t.business_or_personal === kind);

  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  items = items.slice(0, limit);

  return Response.json({
    count: items.length,
    items,
    filters: { month, category, kind, limit },
    source: "mock",
  });
}
