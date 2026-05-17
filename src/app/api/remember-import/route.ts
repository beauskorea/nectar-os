import { NextRequest } from 'next/server';
import { writeFile } from 'fs/promises';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response('', { headers: CORS });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  await writeFile('/root/projects/nectar-os/data/remember_cards.json', body);
  return new Response(JSON.stringify({ ok: true, size: body.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
