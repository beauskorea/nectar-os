import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENAI_MODEL = "gpt-4o-mini";
const PERPLEXITY_MODEL = "sonar-pro";
const ANTHROPIC_MODEL = "claude-opus-4-7";

const SYSTEM = `너는 NECTAR(와인잔 회사) 대표 황수연의 외부 발송용 인사 메일 본문 INTRO만 한국어로 작성한다.
("[채널 및 소개]" / "[보도기사]" 링크 블록과 "황수연 드림." 서명은 시스템이 자동으로 뒤에 붙이니 본문에서 작성하지 마라.)

상황: 황수연이 외부에서 만난 사람에게 회사 소개서 / 제품 소개서를 첨부로 보낸다.

⚠️ 절대 지킬 것:
- **회사 통계·숫자 자체적으로 만들지 마라**. 회사 소개는 첨부 소개서와 footer 링크가 한다.
- 외부 web 검색 정보 사용 금지. 사용자 메모만 신뢰.
- 끝맺음 인사 후 절대 서명 쓰지 말 것 ("황수연 드림" 자동 부착).
- 채널·보도기사 링크 절대 본문에 쓰지 말 것 (자동 부착).

INTRO 구조 (4~7문장):
1) "안녕하세요. NECTAR 황수연입니다." 같은 짧은 인사.
2) "지난번 / 어제 / 최근 [만난자리]에서 뵙게 되어 반가웠습니다" — 만남 환기 (메모 반영). 메모가 없으면 "인사드릴 기회가 있어 메일 드립니다" 정도.
3) "약속드린 [첨부 자료명]을 전달드립니다" — 첨부 안내.
4) (선택) 만난 자리에서 나온 한 가지 키워드 짧게 언급 (메모에서 자연스럽게).
5) "검토 후 편하실 때 자리 한번 더 잡고 싶습니다" 류 다음 액션 1줄.
6) "감사합니다" 마무리.

톤: 정중·진솔, 군더더기 X. 영어 만남이면 영문으로.`;

// 외부 발송 메일의 기본 부착 채널/보도기사 리스트. 본문 textarea에 합쳐 들어가서 사용자가 자유롭게 편집 가능.
const FOOTER_LINKS: Array<{ title: string; url: string }> = [
  { title: "고려대·NECTAR, K-뷰티 유튜브 논문 SSCI 저널 발표", url: "https://www.datanews.co.kr/news/article.html?no=140958" },
  { title: "NECTAR, IP 기반 글로벌 커머스 본격화", url: "https://www.dailypop.kr/news/articleView.html?idxno=90430" },
  { title: "NECTAR, 2024년 매출 136억원·전년 대비 58% ↑", url: "https://www.businesskorea.co.kr/news/articleView.html?idxno=243540" },
  { title: "NECTAR, 자문위원에 고려대 김성철 교수 위촉", url: "https://www.businesskorea.co.kr/news/articleView.html?idxno=240550" },
  { title: "황수연 대표, '2024 화해 올인원 비즈니스 세미나' 뷰티 마케팅 트렌드 강연", url: "https://www.bizwnews.com/news/articleView.html?idxno=85434" },
  { title: "NECTAR, 제1회 크리에이터 행사 ' 데이' 성황리 개최", url: "https://www.sentv.co.kr/article/view/sentv202404020047" },
  { title: "NECTAR, MCN 브랜드 '' 설립", url: "https://news.nate.com/view/20240329n05682" },
  { title: "황수연 대표, 포브스코리아 2030 파워리더 선정", url: "http://www.forbeskorea.co.kr/news/articleView.html?idxno=335380" },
];

const CHANNEL_LINKS: Array<{ title: string; url?: string; note?: string }> = [
  { title: "⭐ NECTAR 회사소개서", note: "본 메일 첨부 PDF 참고" },
  { title: "💡 뷰티업계 인사이트 (황수연 IG)", url: "https://www.instagram.com/jinhorus" },
  { title: "🎬 (BROUND) 크리에이터 채널", url: "https://www.instagram.com/b_round_official" },
];

// 본문 textarea에 들어갈 plain text 버전 — URL은 평문 (대부분 메일 클라이언트가 자동 인식)
function buildFooterText(): string {
  const channels = CHANNEL_LINKS
    .map((c) => c.url ? `${c.title} : ${c.url}` : `${c.title} : ${c.note}`)
    .join("\n");
  const press = FOOTER_LINKS.map((l) => `· ${l.title}\n  ${l.url}`).join("\n");
  return `

감사합니다.
황수연 드림.

────────────────────────

📎 [채널 및 소개]

${channels}

📰 [보도기사]

${press}
`;
}

const FOOTER = buildFooterText();

async function callOpenAI(apiKey: string, userMsg: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 800,
      temperature: 0.5,
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return { draft: j.choices?.[0]?.message?.content?.trim() || "(빈 응답)", model: OPENAI_MODEL };
}

async function callPerplexity(apiKey: string, userMsg: string) {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 800,
      temperature: 0.4,
    }),
  });
  if (!r.ok) throw new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return { draft: j.choices?.[0]?.message?.content?.trim() || "(빈 응답)", model: PERPLEXITY_MODEL };
}

async function callAnthropic(apiKey: string, userMsg: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  return {
    draft: j.content.filter((c) => c.type === "text" && c.text).map((c) => c.text as string).join("\n").trim(),
    model: ANTHROPIC_MODEL,
  };
}

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; meetingNote?: string; materials?: string[]; engine?: string; tone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.name || !body.email) return NextResponse.json({ error: "name & email required" }, { status: 400 });

  const materials = body.materials?.length ? body.materials : ["회사 소개서"];
  const toneMap: Record<string, string> = {
    formal: "톤: **정중·격식체** (~합니다, ~드립니다, ~송구하나). 처음 인사하는 자리.",
    casual: "톤: **친근·구어체** (~해요, ~예요, ~드릴게요). 박람회/이벤트에서 이미 가볍게 만난 관계.",
    english: "톤: **영문 메일로 작성**. 한국어 사용 금지. Polite business English, 3-5 sentences.",
  };
  const toneLine = toneMap[body.tone || ""] || "톤: 정중하되 군더더기 없는 비즈니스 톤.";
  const userMsg =
    `받는 사람: ${body.name} <${body.email}>\n` +
    `만난 자리 / 메모: ${body.meetingNote || "(메모 없음)"}\n` +
    `첨부할 자료: ${materials.join(", ")}\n` +
    `${toneLine}\n\n` +
    `위 정보로 본문 작성. 회사 통계·소개 boilerplate 절대 금지 (소개서가 알아서 함).`;

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;

  // 우선순위: 1) 명시 engine 2) Anthropic api key 3) OpenAI (search-free, default) 4) Perplexity (web grounded)
  const useEngine =
    body.engine === "openai" ? "openai" :
    body.engine === "anthropic" ? "anthropic" :
    body.engine === "perplexity" ? "perplexity" :
    (anthropicKey && anthropicKey.startsWith("sk-ant-api")) ? "anthropic" :
    openaiKey ? "openai" :
    perplexityKey ? "perplexity" :
    "none";

  const t0 = Date.now();
  try {
    let result;
    if (useEngine === "anthropic" && anthropicKey) result = await callAnthropic(anthropicKey, userMsg);
    else if (useEngine === "openai" && openaiKey) result = await callOpenAI(openaiKey, userMsg);
    else if (useEngine === "perplexity" && perplexityKey) result = await callPerplexity(perplexityKey, userMsg);
    else return NextResponse.json({ error: "no API key" }, { status: 500 });

    const subject = `[넥타] ${body.name}님께 — 인사드립니다`;
    // intro + 자동 footer (서명 + 채널/보도기사 list)
    const fullDraft = (result.draft || "").replace(/\s+$/, "") + FOOTER;
    return NextResponse.json({
      ...result,
      draft: fullDraft,
      subject,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
