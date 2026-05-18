// 진호 OS — Gmail fetcher 인터페이스 (mock mode 기본값)
//
// 실제 Gmail OAuth 는 이 파일에서 직접 호출하지 않는다.
// `process.env.GMAIL_FETCH_MODE === "live"` 일 때만 동적 import 로
// `./gmail-live.ts` (별도 파일, 아직 생성 안 함) 를 호출한다.
//
// 이 파일은 토큰을 절대 보관하지 않는다. 토큰은 .env / OS secrets manager.

import { parseEmailToTransaction } from "./parser";
import type { ParseInput, Transaction } from "./types";
import { GMAIL_EMAIL_SAMPLES } from "./samples/email-samples";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type GmailFetchMode = "mock" | "live";

export interface GmailFetchOptions {
  /** 'q' 쿼리 (Gmail 검색 문법). mock 모드에선 단순 substring 매칭. */
  query?: string;
  /** ISO date — 이 시점 이후 메일만 (mock 모드에선 무시) */
  since?: string;
  /** 최대 가져올 메일 개수 */
  limit?: number;
}

export interface GmailFetchResult {
  mode: GmailFetchMode;
  fetched: number;
  parsed_transactions: Transaction[];
  dropped: number;        // 파싱 실패해서 버려진 메일 개수
  note?: string;
}

function activeMode(): GmailFetchMode {
  return process.env.GMAIL_FETCH_MODE === "live" ? "live" : "mock";
}

// Mock 구현 — 샘플 이메일 텍스트들을 parser 에 흘려서 Transaction 목록 반환.
function fetchMock(opts: GmailFetchOptions): GmailFetchResult {
  const q = (opts.query ?? "").toLowerCase();
  const candidates = GMAIL_EMAIL_SAMPLES.filter((s) => {
    if (!q) return true;
    return (
      s.subject.toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q) ||
      s.from.toLowerCase().includes(q)
    );
  }).slice(0, opts.limit ?? 50);

  const parsed: Transaction[] = [];
  let dropped = 0;
  for (const s of candidates) {
    const input: ParseInput = {
      source: s.kind,
      subject: s.subject,
      body: s.body,
      received_at: s.received_at,
    };
    const tx = parseEmailToTransaction(input);
    if (tx) parsed.push(tx);
    else dropped++;
  }
  return {
    mode: "mock",
    fetched: candidates.length,
    parsed_transactions: parsed,
    dropped,
    note: "GMAIL_FETCH_MODE=mock — using src/lib/finance/samples/email-samples.ts",
  };
}

// 메인 진입점. live 모드는 아직 unimplemented — 에러 던지지 않고 mock fallback.
export async function fetchGmailTransactions(
  opts: GmailFetchOptions = {},
): Promise<GmailFetchResult> {
  const mode = activeMode();
  if (mode === "mock") return fetchMock(opts);

  // live 모드 — gmail-live.ts (Google API client) 를 동적 import.
  // 이 파일이 아직 없으면 catch 해서 mock fallback.
  try {
    const livePath = path.join(process.cwd(), "src", "lib", "finance", "gmail-live.ts");
    if (!existsSync(livePath)) throw new Error("gmail-live.ts missing");
    const live = await import(pathToFileURL(livePath).href);
    if (typeof live.fetchGmailLive === "function") {
      return (await live.fetchGmailLive(opts)) as GmailFetchResult;
    }
  } catch {
    // fallthrough to mock with note
  }
  const fallback = fetchMock(opts);
  fallback.note = "GMAIL_FETCH_MODE=live 였으나 gmail-live.ts 미구현 — mock fallback";
  return fallback;
}

// 외부에서 Mode 확인용
export function getGmailMode(): GmailFetchMode {
  return activeMode();
}
