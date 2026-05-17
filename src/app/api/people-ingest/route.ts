import { NextRequest } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const SRC = '/root/projects/nectar-os/src/data/people.json';
const PUB = '/root/projects/nectar-os/public/people.json';

const SYSTEM_PROMPT = `You parse free-form Korean text about a contact (인맥) into structured JSON.

Output ONLY one JSON object with this shape:
{
  "name": string,
  "role": string,
  "kind": "internal" | "external-press" | "external-analyst" | "external",
  "handle": string,
  "freqDays": number,
  "note": string,
  "matchKeywords": string[],
  "matchEmails": string[]
}

Rules:
- kind: "internal" 뷰스컴퍼니/비라운드 내부 직원, "external-press" 기자/매체, "external-analyst" 애널리스트/리서치, "external" 그 외 모든 외부 (브랜드, 친구, 멘토, 파트너 등).
- freqDays: 권장 컨택 주기. 가까운 친구 14, 정례 30, 일반 외부 60, 가끔 90. 명시 없으면 30.
- handle: 인스타/텔레그램 @핸들 또는 전화번호.
- matchKeywords: 이름 자체 + 별명. 캘린더/메일 매칭용. 한국 이름은 한국어 그대로.
- matchEmails: 이메일 주소.
- Output JSON only, no commentary, no markdown fences.`;

async function parseWithClaude(text: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error('claude api: ' + res.status + ' ' + await res.text());
  const j = await res.json();
  let raw = j?.content?.[0]?.text || '';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON in response: ' + raw.slice(0, 200));
  return JSON.parse(raw.slice(start, end + 1));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = body?.text || '';
    const commit: boolean = !!body?.commit;
    const parsed: any = body?.parsed;

    if (!commit) {
      if (!text.trim()) return new Response(JSON.stringify({ error: 'empty text' }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, parsed: await parseWithClaude(text) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!parsed?.name) return new Response(JSON.stringify({ error: 'invalid parsed' }), { status: 400 });
    const doc = JSON.parse(await readFile(SRC, 'utf-8'));
    if (doc.people.some((p: any) => p.name === parsed.name)) {
      return new Response(JSON.stringify({ error: '이미 등록된 이름: ' + parsed.name }), { status: 409 });
    }
    doc.people.push({
      name: parsed.name,
      role: parsed.role || '',
      kind: parsed.kind || 'external',
      handle: parsed.handle || '',
      lastContact: '',
      lastContactTs: 0,
      lastContactSource: '',
      overdue: true,
      freqDays: parsed.freqDays || 30,
      note: parsed.note || '',
      matchKeywords: parsed.matchKeywords || [parsed.name],
      matchEmails: parsed.matchEmails || [],
    });
    doc.updatedAt = Math.floor(Date.now() / 1000);
    const out = JSON.stringify(doc, null, 2);
    await writeFile(SRC, out);
    await writeFile(PUB, out);
    return new Response(JSON.stringify({ ok: true, people: doc.people.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
