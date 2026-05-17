import { NextRequest } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const SRC = '/root/projects/nectar-os/src/data/partners.json';
const PUB = '/root/projects/nectar-os/public/partners.json';

const SYSTEM_PROMPT = `You parse free-form Korean text about media/entertainment partners into structured JSON.

Output ONLY a JSON object with this exact shape:
{
  "company": {
    "name": string,
    "category": "talent" | "makeup" | "media" | "expansion" | "mentor",
    "note": string,
    "introducedBy": string
  },
  "talent": {
    "name": string,
    "role": string,
    "manager": string,
    "contact": string,
    "status": "available" | "reviewing" | "busy"
  } | null
}

Rules:
- category: "talent" for celebrity/idol/influencer/엔터 agencies, "makeup" for 메이크업샵/메이크업 아티스트, "media" for 미디어/콘텐츠/유튜브 운영사, "expansion" for VC/투자/컨설팅/그로스, "mentor" for 멘토/고문/자문.
- introducedBy: 소개해 준 사람 이름. 본인이 직접 만난 경우면 "대표님". 명시 없으면 빈 문자열.
- Empty string for missing fields, never null inside company. talent can be null if input is only a company.
- Korean names stay Korean. Phone numbers as-is (e.g. 010-1234-5678).
- status defaults to "reviewing" unless input says otherwise.
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
      max_tokens: 1200,
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
      const result = await parseWithClaude(text);
      return new Response(JSON.stringify({ ok: true, parsed: result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // COMMIT
    if (!parsed?.company?.name) return new Response(JSON.stringify({ error: 'invalid parsed' }), { status: 400 });
    const doc = JSON.parse(await readFile(SRC, 'utf-8'));
    let comp = doc.partners.find((p: any) => p.name === parsed.company.name);
    if (!comp) {
      comp = {
        name: parsed.company.name,
        category: parsed.company.category || 'talent',
        status: 'watching',
        contact: '',
        note: parsed.company.note || '',
        introducedBy: parsed.company.introducedBy || '',
        lastTouch: '',
        nextAction: '',
        briefUrl: '',
        talents: [],
      };
      doc.partners.push(comp);
    } else if (parsed.company.introducedBy && !comp.introducedBy) {
      comp.introducedBy = parsed.company.introducedBy;
    }
    if (parsed.talent?.name && !comp.talents.some((t: any) => t.name === parsed.talent.name)) {
      comp.talents.push({
        name: parsed.talent.name,
        role: parsed.talent.role || '',
        manager: parsed.talent.manager || '',
        contact: parsed.talent.contact || '',
        status: parsed.talent.status || 'reviewing',
        briefUrl: '',
      });
    }
    doc.updatedAt = Math.floor(Date.now() / 1000);
    const out = JSON.stringify(doc, null, 2);
    await writeFile(SRC, out);
    await writeFile(PUB, out);
    return new Response(JSON.stringify({ ok: true, partners: doc.partners.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
