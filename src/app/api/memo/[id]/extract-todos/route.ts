import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import * as gt from "@/lib/google-tasks";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/notes.db";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

function sqlite(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-bail", "-json", DB_PATH, sql]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `sqlite exit ${code}`))));
  });
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

async function loadNote(id: string): Promise<{ title: string; plain: string } | null> {
  const text = await sqlite(`SELECT title, plain FROM notes WHERE id = ${sqlQuote(id)} AND deleted = 0 LIMIT 1;`);
  if (!text.trim()) return null;
  const arr = JSON.parse(text) as { title: string; plain: string }[];
  return arr[0] || null;
}

type Extracted = { text: string; priority: "high" | "med" | "low"; board: "company" | "personal" };

async function extract(note: { title: string; plain: string }): Promise<Extracted[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) throw new Error("anthropic_key_missing");
  const sys = `메모에서 실제 액션 가능한 할 일(투두)을 추출해 JSON 배열로만 답하세요.
- 각 항목: {"text": "한 문장 액션", "priority": "high|med|low", "board": "company|personal"}
- 단순 정보/메모/이미 끝난 일은 제외
- 최대 8개
- 한국어로 간결하게
- 회사 업무는 board="company", 개인은 "personal"

출력 예: [{"text":"김대표 미팅 일정 잡기","priority":"high","board":"company"}]
출력은 JSON 배열만, 다른 텍스트 금지.`;
  const user = `[메모: ${note.title}]\n${note.plain}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { content?: { type: string; text?: string }[] };
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x: { text?: unknown; priority?: unknown; board?: unknown }) => ({
      text: String(x.text || "").trim(),
      priority: (["high", "med", "low"] as const).includes((x.priority as "high" | "med" | "low") ?? "med")
        ? ((x.priority as "high" | "med" | "low") ?? "med")
        : "med",
      board: (x.board === "personal" ? "personal" : "company") as "company" | "personal",
    }))
    .filter((x: Extracted) => x.text.length > 0);
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const note = await loadNote(id);
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const items = await extract(note);
    if (!items.length) return NextResponse.json({ ok: true, added: [], note: "추출된 할 일 없음" });

    const configured = await gt.isConfigured();
    if (!configured) return NextResponse.json({ ok: false, items, error: "tasks_not_configured" });

    const added: { text: string; id?: string }[] = [];
    for (const it of items) {
      try {
        const t = await gt.createTodo(it.text, it.priority, "todo", it.board);
        added.push({ text: it.text, id: (t as { id?: string }).id });
      } catch (e) {
        added.push({ text: it.text, id: undefined });
        console.error("createTodo failed", e);
      }
    }
    return NextResponse.json({ ok: true, added });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
