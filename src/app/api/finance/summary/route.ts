import { getDefaultMoneyKpi, DEFAULT_MONTH } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? DEFAULT_MONTH;
  const kpi = getDefaultMoneyKpi(month);
  return Response.json({
    month,
    source: "mock",
    kpi,
  });
}
