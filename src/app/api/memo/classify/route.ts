import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DB_PATH = "/root/projects/nectar-os/data/notes.db";
const MODEL = "claude-haiku-4-5-20251001";

const TEAMS = ["주간회의", "바이럴파트", "임원", "마케팅", "운영", "디자인", "개발", "재무"];

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

function sqliteRun(stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-bail", DB_PATH]);
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `sqlite exit ${code}`))));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

type NoteRow = { id: string; title: string; plain: string };
type Classification = { id: string; board: "company" | "personal" | ""; team: string };

async function classifyBatch(notes: NoteRow[]): Promise<Classification[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) throw new Error("anthropic_key_missing");
  const sys = `당신은 메모 분류기입니다. 주어진 메모들을 회사/개인으로 분류하고, 회사라면 팀을 정합니다.

[조직 컨텍스트 — 뷰스컴퍼니/비라운드 MCN]
- 임원: 성지영 상무, 박창현 전무
- 매니지먼트: 최정음 파트장 (전속), 김윤 (연습생)
- 바이럴파트: 신승아 파트장, 송주연, 이유경, 임채린, 강지원
- 클라이언트(11개 K-뷰티): 아누아, 메디필, 미샤, 라카, 어퓨, CKD, 리쥬란, 스킨1004, 티르티르, 아비브, 네이밍
- 경쟁사 MCN: 레페리, 디밀, 아이스크리에이티브, 숏뜨, ag-ent

[팀 옵션]
${TEAMS.map((t) => `- ${t}`).join("\n")}

[규칙]
- 회사 업무·미팅·결정·회사 사람·클라이언트·경쟁사 분석 = "company"
- 개인 일정·아이디어·메모·취미·일기 = "personal"
- 통화녹음·shell 명령·임시 메모로 분류 어려우면 board=""
- 회사 메모는 가장 적합한 team 하나만 선택 (확신 없으면 team="")
- "주간회의"는 회의록 형식인 경우만
- "바이럴파트" 키워드: 신승아·송주연·이유경·임채린·강지원 또는 인플루언서·릴스·캠페인
- "임원" 키워드: 성지영·박창현 또는 채용·법무·재무 결정
- "마케팅"은 클라이언트 캠페인·콘텐츠 기획
- "운영" = 일반 회사 운영
- "개발"·"디자인"·"재무" = 명확한 키워드만

JSON 배열만 반환. 다른 텍스트 금지.
형식: [{"id":"노트ID","board":"company|personal|","team":"팀명 or 빈문자열"}]`;

  const userPrompt = notes
    .map((n) => `[id=${n.id}]\n제목: ${n.title}\n본문: ${(n.plain || "").slice(0, 500)}`)
    .join("\n---\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: sys,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { content?: { type: string; text?: string }[] };
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x: { id?: unknown; board?: unknown; team?: unknown }): Classification | null => {
      const id = typeof x.id === "string" ? x.id : "";
      if (!id) return null;
      const b = x.board === "company" || x.board === "personal" ? x.board : "";
      const t = typeof x.team === "string" && TEAMS.includes(x.team) ? x.team : "";
      return { id, board: b, team: t };
    })
    .filter((x): x is Classification => x !== null);
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);
  const batchSize = Math.min(parseInt(url.searchParams.get("batch_size") || "20", 10) || 20, 30);

  try {
    const where = all ? "deleted = 0" : "deleted = 0 AND (board IS NULL OR board = '') AND id NOT LIKE 'local-%'";
    const text = await sqlite(`SELECT id, title, plain FROM notes WHERE ${where} ORDER BY modified_at DESC LIMIT ${limit};`);
    const notes = text.trim() ? (JSON.parse(text) as NoteRow[]) : [];
    if (!notes.length) return NextResponse.json({ ok: true, classified: 0, total: 0, note: "분류할 메모 없음" });

    let classified = 0;
    const errors: string[] = [];
    for (let i = 0; i < notes.length; i += batchSize) {
      const chunk = notes.slice(i, i + batchSize);
      try {
        const results = await classifyBatch(chunk);
        if (results.length) {
          const stmts: string[] = ["BEGIN;"];
          for (const r of results) {
            stmts.push(
              `UPDATE notes SET board = ${sqlQuote(r.board)}, team = ${sqlQuote(r.team)} WHERE id = ${sqlQuote(r.id)};`,
            );
          }
          stmts.push("COMMIT;");
          await sqliteRun(stmts.join("\n"));
          classified += results.length;
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }

    return NextResponse.json({ ok: true, classified, total: notes.length, errors });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
