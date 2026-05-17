import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const FILE_DIR = "/root/projects/nectar-os/public/files";
const MAX_SIZE = 30 * 1024 * 1024; // 30MB

const SLOT_FILENAME: Record<string, string> = {
  company: "company-deck.pdf",
  creators: "product-deck.pdf",
};

const ALLOWED_EXT = [".pdf", ".pptx", ".ppt", ".keynote", ".key"];

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const slot = url.searchParams.get("slot") || "";
  const targetName = SLOT_FILENAME[slot];
  if (!targetName) {
    return NextResponse.json({ error: `invalid slot: ${slot}` }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required (multipart form)" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `too large (max ${MAX_SIZE / 1024 / 1024}MB)` }, { status: 400 });
  }

  // 확장자 검증 (원본 파일명 기준)
  const ext = path.extname((file.name || "").toLowerCase());
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: `허용 확장자: ${ALLOWED_EXT.join(", ")}` }, { status: 400 });
  }
  // 슬롯은 PDF 고정 — 원본 확장자가 다르면 사용자에게 알리고 거부 (단순 정책)
  if (ext !== ".pdf") {
    return NextResponse.json({ error: "PDF만 업로드 가능합니다 (다른 형식은 직접 변환 후 업로드)" }, { status: 400 });
  }

  await mkdir(FILE_DIR, { recursive: true });
  const dest = path.join(FILE_DIR, targetName);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buf);

  return NextResponse.json({
    ok: true,
    slot,
    path: `/files/${targetName}`,
    size: buf.length,
    originalName: file.name,
  });
}

export async function GET() {
  // 슬롯별 파일 존재 여부
  const { stat } = await import("node:fs/promises");
  const result: Record<string, { exists: boolean; size?: number; path: string }> = {};
  for (const [slot, filename] of Object.entries(SLOT_FILENAME)) {
    const p = path.join(FILE_DIR, filename);
    try {
      const s = await stat(p);
      result[slot] = { exists: s.isFile() && s.size > 0, size: s.size, path: `/files/${filename}` };
    } catch {
      result[slot] = { exists: false, path: `/files/${filename}` };
    }
  }
  return NextResponse.json(result);
}
