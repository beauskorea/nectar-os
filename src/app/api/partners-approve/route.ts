import { NextRequest } from "next/server";
import { readFile, writeFile } from "fs/promises";

const SUPP = "/root/projects/nectar-os/public/partners_supplement.json";

// POST { name }
// supplement.additional_partners[name] 의 autoIngested 를 false 로 변경
// + reviewedAt timestamp 마킹 — 검토 완료 표시
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    if (!name) {
      return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
    }

    const supp = JSON.parse(await readFile(SUPP, "utf-8"));
    let touched = false;
    for (const p of supp.additional_partners || []) {
      if (p.name === name) {
        p.autoIngested = false;
        p.reviewedAt = Math.floor(Date.now() / 1000);
        touched = true;
      }
    }
    if (!touched) {
      return new Response(JSON.stringify({ error: "not found", name }), { status: 404 });
    }
    supp.updatedAt = Math.floor(Date.now() / 1000);
    await writeFile(SUPP, JSON.stringify(supp, null, 2));

    return new Response(
      JSON.stringify({ ok: true, name, reviewedAt: Math.floor(Date.now() / 1000) }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500 },
    );
  }
}
