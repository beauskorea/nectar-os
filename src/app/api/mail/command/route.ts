import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const PERPLEXITY_MODEL = "sonar-pro";
const MAX_BODY = 3500;
const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";

const SYSTEM = [
  "너는 박진호(뷰스컴퍼니 대표·ceo@beaus.co.kr) 메일 비서다.",
  "이 비서는 **답장 초안을 쓰지 않는다** (답장 초안은 별도 버튼이 처리한다).",
  "대신 박진호의 **메일 정리 명령**을 해석하고 실행한다.",
  "",
  "지원 명령 유형:",
  "1. 요약/분석: \"한 줄 요약\" / \"핵심 3가지\" / \"발신자 의도\" / \"왜 보낸 거야\"",
  "2. 분류 변경 제안: \"이거 노이즈로\" / \"영업으로 분류\" / \"finance 맞아?\"",
  "3. 액션 제안: \"휴지통\" / \"읽음 처리\" / \"이거 누구한테 위임\" / \"답장 필요해?\"",
  "4. 컨텍스트 질문: \"이 회사 누구야\" / \"전에도 메일 왔어?\" / \"우리 클라야?\"",
  "5. 일반 자유 질문",
  "",
  "출력 규칙:",
  "- 한국어, 간결 (한 문장 또는 불릿 2~4개)",
  "- 마크다운 헤더 # 금지",
  "- 본문에 없는 사실 만들지 말 것. 모르면 \"본문에 없음\"",
  "- 분류 변경/액션 제안 시 끝에 [추천 액션: <action>] 한 줄 추가 (예: [추천 액션: noise로 재분류], [추천 액션: 휴지통])",
  "- 영문 메일도 한국어로 답",
].join("\n");

type Msg = {
  id: string;
  ts: number;
  date?: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  snippet?: string;
  body?: string;
  category?: string | null;
  priority?: string | null;
  aiSummary?: string | null;
};

async function loadMail(id: string): Promise<Msg | null> {
  const p = path.join(process.cwd(), "public", "mail.json");
  const raw = await readFile(p, "utf-8");
  const data = JSON.parse(raw) as { messages: Msg[] };
  return data.messages.find((m) => m.id === id) ?? null;
}

function runPython(code: string, args: string[] = [], timeoutMs = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out, err });
    });
  });
}

const PY_SENDER_HISTORY = `import sqlite3, json, sys
db, addr = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db, timeout=10)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT date_ts, subject, ai_category, priority
  FROM messages
  WHERE from_addr = LOWER(?) AND trashed_at IS NULL
  ORDER BY date_ts DESC LIMIT 10
""", (addr,)).fetchall()
sys.stdout.write(json.dumps([dict(r) for r in rows]))
`;

async function callPerplexity(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
      max_tokens: 600,
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(apiKey: string, userMsg: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  return j.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string).join("").trim();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { messageId?: string; command?: string };
  const messageId = body.messageId;
  const command = (body.command || "").trim();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });
  if (!command) return NextResponse.json({ error: "command required" }, { status: 400 });

  const msg = await loadMail(messageId);
  if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });

  // 발신자 과거 메일 히스토리 (최대 10건)
  let history: Array<{ date_ts: number; subject: string; ai_category: string | null; priority: string | null }> = [];
  if (msg.fromAddr) {
    const hr = await runPython(PY_SENDER_HISTORY, [DB_PATH, msg.fromAddr]);
    if (hr.ok && hr.out.trim()) {
      try { history = JSON.parse(hr.out); } catch {}
    }
  }

  const histText = history.length > 1
    ? "\n\n--- 발신자 과거 메일 (최근 " + history.length + "건) ---\n" +
      history.slice(0, 8).map((h) => {
        const d = new Date(h.date_ts * 1000).toISOString().slice(0, 10);
        return `  [${d}] (${h.ai_category || "?"}) ${h.subject}`;
      }).join("\n")
    : "";

  const userMsg = [
    `From: ${msg.fromName} <${msg.fromAddr}>`,
    `Date: ${msg.date || ""}`,
    `Subject: ${msg.subject}`,
    `AI 분류: ${msg.category || "-"} / priority=${msg.priority || "-"}`,
    msg.aiSummary ? `AI 요약: ${msg.aiSummary}` : "",
    "",
    "--- 본문 ---",
    (msg.body || msg.snippet || "").slice(0, MAX_BODY),
    histText,
    "",
    `--- 박진호 명령 ---`,
    command,
  ].filter(Boolean).join("\n");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const preferAnthropic = !!anthropicKey && anthropicKey.startsWith("sk-ant-api");
  if (!preferAnthropic && !perplexityKey) {
    return NextResponse.json({ error: "no API key" }, { status: 500 });
  }

  const t0 = Date.now();
  try {
    let answer: string;
    let modelUsed: string;
    if (preferAnthropic) {
      answer = await callAnthropic(anthropicKey!, userMsg);
      modelUsed = ANTHROPIC_MODEL;
    } else {
      answer = await callPerplexity(perplexityKey!, userMsg);
      modelUsed = PERPLEXITY_MODEL;
    }
    // 액션 제안 파싱 — "[추천 액션: noise로 재분류]" 형태
    const m = answer.match(/\[추천 액션:\s*([^\]]+)\]/);
    const suggestedAction = m ? m[1].trim() : null;
    return NextResponse.json({
      messageId,
      command,
      answer,
      suggestedAction,
      model: modelUsed,
      historyCount: history.length,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
