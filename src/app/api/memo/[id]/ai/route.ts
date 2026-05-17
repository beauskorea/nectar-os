import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/notes.db";
const ANTHROPIC_MODEL_FAST = "claude-sonnet-4-6";
const ANTHROPIC_MODEL_DEEP = "claude-opus-4-7";

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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  let body: { prompt?: string; deep?: boolean; history?: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const prompt = (body.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) return NextResponse.json({ error: "anthropic_key_missing" }, { status: 503 });

  const note = await loadNote(id);
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sys = `당신은 넥타의 메모 도우미입니다. 사용자가 선택한 메모를 컨텍스트로 받아서 한국어로 짧고 실용적으로 답하세요.

[현재 메모: ${note.title || "제목 없음"}]
${note.plain}
`;

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  if (Array.isArray(body.history)) {
    for (const m of body.history) {
      if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: "user", content: prompt });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: body.deep ? ANTHROPIC_MODEL_DEEP : ANTHROPIC_MODEL_FAST,
        max_tokens: 1024,
        system: sys,
        messages,
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return NextResponse.json({ error: `anthropic_${r.status}`, detail: err.slice(0, 500) }, { status: 502 });
    }
    const j = (await r.json()) as { content?: { type: string; text?: string }[] };
    const answer = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim();
    return NextResponse.json({ ok: true, answer });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
