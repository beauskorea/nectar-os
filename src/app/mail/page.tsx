"use client";
import { useEffect, useState, useMemo, useRef } from "react";

type Msg = {
  id: string;
  ts: number;
  date: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  snippet: string;
  body: string;
  unread: boolean;
  priority: "high" | "med" | "low" | null;
  category: Category | null;
  aiSummary: string | null;
  aiInsight?: string | null;
  aiFullSummary?: string | null;
  bodyHtml?: string | null;
  attachments?: Array<{ name: string; mime: string; size: number; url?: string }> | null;
  trashed?: boolean;
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type Category =
  | "sales"
  | "client"
  | "finance"
  | "urgent"
  | "event"
  | "lecture"
  | "news"
  | "noise"
  // 레거시 (재분류 전 폴백)
  | "action"
  | "info";

type MailFile = {
  account: string;
  count: number;
  updatedAt: number;
  days?: number;
  messages: Msg[];
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-400",
  med: "bg-amber-400",
  low: "bg-zinc-700",
};

const CATEGORY_META: Record<string, { label: string; emoji: string; badge: string; dot: string }> = {
  sales:   { label: "영업",   emoji: "🤝", badge: "bg-indigo-900/40 text-indigo-300 border-indigo-900/60",   dot: "bg-indigo-400" },
  client:  { label: "클라",   emoji: "💼", badge: "bg-emerald-900/40 text-emerald-300 border-emerald-900/60", dot: "bg-emerald-400" },
  finance: { label: "정산",   emoji: "💰", badge: "bg-amber-900/40 text-amber-300 border-amber-900/60",       dot: "bg-amber-400" },
  urgent:  { label: "긴급",   emoji: "🚨", badge: "bg-rose-900/40 text-rose-300 border-rose-900/60",          dot: "bg-rose-400" },
  event:   { label: "행사",   emoji: "🎤", badge: "bg-violet-900/40 text-violet-300 border-violet-900/60",    dot: "bg-violet-400" },
  lecture: { label: "강의",   emoji: "🎓", badge: "bg-teal-900/40 text-teal-300 border-teal-900/60",          dot: "bg-teal-400" },
  news:    { label: "정보",   emoji: "📰", badge: "bg-sky-900/40 text-sky-300 border-sky-900/60",             dot: "bg-sky-400" },
  noise:   { label: "노이즈", emoji: "🗑", badge: "bg-zinc-800/60 text-zinc-500 border-zinc-800",            dot: "bg-zinc-600" },
  // 레거시 폴백 (재분류 진행 중)
  action:  { label: "처리",   emoji: "⚑", badge: "bg-rose-900/40 text-rose-300 border-rose-900/60",          dot: "bg-rose-400" },
  info:    { label: "참고",   emoji: "ℹ", badge: "bg-sky-900/40 text-sky-300 border-sky-900/60",             dot: "bg-sky-400" },
};

const FILTER_MODES = [
  "all", "unread", "sales", "client", "finance", "urgent", "event", "lecture", "news", "noise", "suspect", "trashed",
] as const;
type FilterMode = (typeof FILTER_MODES)[number];

// 스팸 의심 휴리스틱
const SPAM_SUBJECT_RE = /^[\s\[(]*(광고|ad|sponsored)[\s\])]/i;
const SPAM_BODY_RE = /(unsubscribe|opt[- ]?out|구독\s*해지|click here|follow[- ]?ups?|reply within (a |one )?day|invitation to (contribute|submit|publish)|prior to the date|wrong|fix it|예약\s*신청|혜택|할인|쿠폰|이벤트 안내|마케팅 수신|광고성 정보)/i;
const SPAM_FROM_PATTERNS = [
  /articlesquality/i,
  /journal[a-z]*\d*\./i,
  /no[-_]?reply/i,
  /newsletter@/i,
  /marketing@/i,
];
const SAFE_FROM_DOMAINS = new Set([
  "beaus.co.kr", "gmail.com", "naver.com", "kakaocorp.com", "google.com",
  "kakao.com", "daum.net", "youtube.com", "instagram.com",
]);

function isSuspect(m: { category?: string | null; subject?: string; body?: string; snippet?: string; fromAddr?: string; aiSummary?: string | null; trashed?: boolean }): boolean {
  if (m.trashed) return false;
  // category 기반
  if (m.category === "noise") return true;
  const subj = m.subject || "";
  const body = (m.body || m.snippet || "");
  const aiS = (m.aiSummary || "").toLowerCase();
  const fromAddr = (m.fromAddr || "").toLowerCase();
  const fromDomain = fromAddr.split("@")[1] || "";
  // 안전 도메인은 제외 (단 광고 제목/본문 패턴이면 다시 suspect)
  const safeFrom = SAFE_FROM_DOMAINS.has(fromDomain);
  if (SPAM_SUBJECT_RE.test(subj)) return true;
  if (SPAM_FROM_PATTERNS.some((re) => re.test(fromAddr))) return true;
  // AI 한줄 요약에 스팸 신호
  if (/(스팸|광고|뉴스레터|구독\s*안내|이벤트 안내|마케팅)/.test(aiS)) return true;
  if (!safeFrom && SPAM_BODY_RE.test(body)) return true;
  return false;
}

// 본문 렌더 — HTML 있으면 iframe sandbox로, 없으면 plain text. plain/HTML 토글.
function BodyView({ m }: { m: Msg }) {
  const [mode, setMode] = useState<"html" | "text">(m.bodyHtml ? "html" : "text");
  const [iframeHeight, setIframeHeight] = useState(400);
  const hasHtml = !!m.bodyHtml;
  // 메일 바뀌면 mode 재설정
  useEffect(() => {
    setMode(m.bodyHtml ? "html" : "text");
    setIframeHeight(400);
  }, [m.id, m.bodyHtml]);

  const htmlDoc = useMemo(() => {
    if (!m.bodyHtml) return "";
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#222;background:#fff;margin:14px;}
      img{max-width:100%;height:auto;}
      a{color:#2563eb;}
      blockquote{border-left:3px solid #ddd;padding-left:10px;color:#666;margin:8px 0;}
      table{max-width:100%;border-collapse:collapse;}
      pre{white-space:pre-wrap;word-break:break-word;}
    </style></head><body>${m.bodyHtml}<script>
      // 부모로 높이 알리기 (postMessage)
      try{const h=document.body.scrollHeight; parent.postMessage({type:'mail-iframe-h',h:h},'*');}catch(e){}
      window.addEventListener('load',()=>{try{const h=document.body.scrollHeight; parent.postMessage({type:'mail-iframe-h',h:h},'*');}catch(e){}});
    </script></body></html>`;
  }, [m.bodyHtml]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (d && d.type === "mail-iframe-h" && typeof d.h === "number") {
        setIframeHeight(Math.max(200, Math.min(d.h + 40, 3000)));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <div>
      <div className="flex gap-1.5 mb-2">
        {hasHtml && (
          <button
            onClick={() => setMode("html")}
            className={`text-[10px] px-2 py-0.5 rounded transition ${
              mode === "html" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            title="HTML 렌더 (이미지·서식 포함)"
          >
            🖼 HTML
          </button>
        )}
        <button
          onClick={() => setMode("text")}
          className={`text-[10px] px-2 py-0.5 rounded transition ${
            mode === "text" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          📝 TEXT
        </button>
      </div>
      {mode === "html" && hasHtml ? (
        <iframe
          srcDoc={htmlDoc}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="w-full rounded bg-white"
          style={{ height: iframeHeight, border: 0 }}
          title="email body"
        />
      ) : (
        <div className="text-[14px] text-zinc-200 leading-7 whitespace-pre-wrap break-words font-sans">
          {m.body || m.snippet}
        </div>
      )}
    </div>
  );
}

export default function MailPage() {
  const [data, setData] = useState<MailFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterMode>("unread");
  const [cmdVisible, setCmdVisible] = useState(false);
  const [selected, setSelected] = useState<Msg | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftHint, setDraftHint] = useState("");
  const [draftMeta, setDraftMeta] = useState<{ model?: string; elapsedMs?: number } | null>(null);
  const [mailCmdInput, setMailCmdInput] = useState("");
  const [mailCmdLoading, setMailCmdLoading] = useState(false);
  type MailCmdTurn = { q: string; a: string; suggestedAction?: string | null; model?: string; ms?: number; err?: string };
  const [mailCmdHistory, setMailCmdHistory] = useState<MailCmdTurn[]>([]);
  // 4컬럼 너비 (px) — localStorage 저장
  const COL_KEY = "jinho-mail-cols-v1";
  const COL_DEFAULTS = [280, 640, 540];
  const [colWidths, setColWidths] = useState<number[]>(COL_DEFAULTS);
  const [resizingIdx, setResizingIdx] = useState<number | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((n) => typeof n === "number" && n >= 120 && n <= 1400)) {
          setColWidths(parsed);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (resizingIdx === null) return;
    const onMove = (e: MouseEvent) => {
      setColWidths((prev) => {
        const next = [...prev];
        const delta = e.movementX;
        // 왼쪽 컬럼은 +delta, 오른쪽 컬럼은 -delta (왼쪽 늘리면 오른쪽 줄어듦).
        // 단순 clamp만 — 한쪽이 한계여도 다른 한쪽은 자유롭게 움직임.
        next[resizingIdx] = Math.max(160, Math.min(1400, next[resizingIdx] + delta));
        next[resizingIdx + 1] = Math.max(160, Math.min(1400, next[resizingIdx + 1] - delta));
        return next;
      });
    };
    const onUp = () => {
      setResizingIdx(null);
      // 최신 colWidths를 함수형 setColWidths로 읽어 저장
      setColWidths((latest) => {
        try { localStorage.setItem(COL_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingIdx]);
  const resetCols = () => {
    setColWidths(COL_DEFAULTS);
    try { localStorage.setItem(COL_KEY, JSON.stringify(COL_DEFAULTS)); } catch {}
  };
  const [cmd, setCmd] = useState("");
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdLog, setCmdLog] = useState<string[]>([]);
  const [triageBusy, setTriageBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<{ model?: string; elapsedMs?: number } | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  function pushLog(line: string) {
    setCmdLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString("ko-KR")} ${line}`]);
  }

  async function runAdminAction(action: "fetch" | "classify" | "insight" | "refresh") {
    setCmdBusy(true);
    pushLog(`▶ ${action} 시작...`);
    try {
      if (action === "refresh") {
        const r = await fetch("/mail.json", { cache: "no-store" });
        const j = await r.json();
        setData(j);
        pushLog(`✓ refresh: ${j.count}건 로드`);
      } else {
        const r = await fetch("/api/mail/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const j = await r.json();
        if (!r.ok) pushLog(`✗ ${action}: ${j.error || r.status}`);
        else pushLog(`✓ ${action}: ${j.summary || "OK"}`);
        // 새 데이터로 갱신
        const r2 = await fetch("/mail.json", { cache: "no-store" });
        setData(await r2.json());
      }
    } catch (e) {
      pushLog(`✗ ${action}: ${String(e)}`);
    } finally {
      setCmdBusy(false);
    }
  }

  async function execCommand() {
    const c = cmd.trim().toLowerCase();
    if (!c) return;
    if (c === "fetch" || c === "f") return runAdminAction("fetch");
    if (c === "classify" || c === "c") return runAdminAction("classify");
    if (c === "insight" || c === "i") return runAdminAction("insight");
    if (c === "refresh" || c === "r") return runAdminAction("refresh");
    if (c.startsWith("/")) {
      // 카테고리 필터 단축 (/sales, /client, /trashed 등)
      const f = c.slice(1) as FilterMode;
      if ((FILTER_MODES as readonly string[]).includes(f)) {
        setFilter(f);
        pushLog(`✓ filter → ${f}`);
        setCmd("");
        return;
      }
    }
    // 검색어로 fallback
    setQ(cmd.trim());
    pushLog(`✓ search → "${cmd.trim()}"`);
    setCmd("");
  }

  async function bulkTriage(action: "trash" | "spam" | "restore") {
    if (!filtered.length) return;
    const ids = filtered.map((m) => m.id);
    const verb = action === "trash" ? "휴지통으로 이동" : action === "spam" ? "스팸으로 이동" : "복구";
    if (!window.confirm(`${ids.length}건을 ${verb}할까요?\n실제 Naver Works 메일함에서 이동되며 되돌리려면 한 건씩 복구해야 합니다.`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/mail/triage-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageIds: ids, action }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        pushLog(`✗ 일괄 ${action}: ${j.error || r.status}`);
        alert(`일괄 처리 실패: ${j.error || r.status}`);
      } else {
        const processed: string[] = j.processed || [];
        const failed: Array<{ messageId: string; reason: string }> = j.failed || [];
        pushLog(`✓ 일괄 ${action}: ${processed.length}건 완료${failed.length ? `, 실패 ${failed.length}건` : ""}`);
        // 로컬 데이터 즉시 갱신
        const processedSet = new Set(processed);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((x) => {
              if (!processedSet.has(x.id)) return x;
              if (action === "restore") return { ...x, trashed: false };
              return { ...x, trashed: true };
            }),
          };
        });
        setSelected(null);
      }
    } catch (e) {
      pushLog(`✗ 일괄 ${action}: ${e}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function markReadIfNeeded(m: Msg) {
    if (!m.unread) return;
    try {
      const r = await fetch("/api/mail/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: m.id }),
      });
      if (!r.ok) return;
      // 로컬 상태 즉시 반영
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((x) => x.id === m.id ? { ...x, unread: false } : x),
        };
      });
    } catch {
      // silent
    }
  }

  async function triage(action: "trash" | "spam" | "restore") {
    if (!selected) return;
    await quickTriage(selected, action, true);
  }

  // 단일 메일 빠른 처리 (확인 dialog 없음, 옵션으로 auto-advance)
  async function quickTriage(m: Msg, action: "trash" | "spam" | "restore", advance = true) {
    setTriageBusy(true);
    try {
      const r = await fetch("/api/mail/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: m.id, action }),
      });
      const j = await r.json();
      if (!r.ok) {
        pushLog(`✗ ${action}: ${j.error || r.status}`);
        return;
      }
      pushLog(`✓ ${action} → ${m.fromName || m.fromAddr}: ${(m.subject || "").slice(0, 40)}`);
      // 로컬 데이터 즉시 반영
      let nextId: string | null = null;
      if (data) {
        // 자동 다음 메일 찾기 (현재 필터 안에서)
        if (advance) {
          const idx = filtered.findIndex((x) => x.id === m.id);
          const next = filtered[idx + 1] || filtered[idx - 1];
          if (next && next.id !== m.id) nextId = next.id;
        }
        const updated = data.messages.map((x) =>
          x.id === m.id
            ? { ...x, trashed: action !== "restore", category: action === "spam" ? "noise" : x.category, unread: false }
            : x,
        );
        setData({ ...data, messages: updated as Msg[] });
      }
      // 처리된 메일이 선택돼 있으면 다음으로 이동 또는 deselect
      if (selected?.id === m.id) {
        if (advance && nextId) {
          const next = data?.messages.find((x) => x.id === nextId);
          if (next) {
            setSelected(next);
            markReadIfNeeded(next);
          } else {
            setSelected(null);
          }
        } else {
          setSelected(null);
        }
      }
    } catch (e) {
      pushLog(`✗ ${action}: ${String(e)}`);
    } finally {
      setTriageBusy(false);
    }
  }

  // 다른 메일 선택 시 초안/요약 리셋 + 요약 자동 생성
  useEffect(() => {
    setDraftText(null);
    setDraftErr(null);
    setDraftHint("");
    setDraftMeta(null);
    setSummary(null);
    setSummaryErr(null);
    setSummaryMeta(null);
    setMailCmdInput("");
    setMailCmdHistory([]);
    // 캐시 hit이면 즉시 표시, 없으면 자동으로 생성 호출
    if (selected) {
      if (selected.aiFullSummary) {
        setSummary(selected.aiFullSummary);
        setSummaryMeta({ model: "cached" });
      } else if (selected.body || selected.snippet) {
        void generateSummary(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  async function generateSummary(force = false) {
    if (!selected) return;
    setSummaryLoading(true);
    setSummaryErr(null);
    try {
      const r = await fetch("/api/mail/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: selected.id, force }),
      });
      const j = await r.json();
      if (!r.ok) setSummaryErr(j.error || `error ${r.status}`);
      else {
        setSummary(j.summary);
        setSummaryMeta({ model: j.cached ? `${j.model || ""} (cached)` : j.model, elapsedMs: j.elapsedMs });
        // 로컬 selected에도 저장해서 다음 진입 시 즉시 hit
        setSelected((prev) => prev && prev.id === selected.id ? { ...prev, aiFullSummary: j.summary } : prev);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((x) => x.id === selected.id ? { ...x, aiFullSummary: j.summary } : x),
          };
        });
      }
    } catch (e) {
      setSummaryErr(String(e));
    } finally {
      setSummaryLoading(false);
    }
  }

  async function generateDraft() {
    if (!selected) return;
    setDraftLoading(true);
    setDraftErr(null);
    setDraftText(null);
    try {
      const r = await fetch("/api/mail/draft-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: selected.id, hint: draftHint.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) {
        setDraftErr(j.error || `error ${r.status}`);
      } else {
        setDraftText(j.draft);
        setDraftMeta({ model: j.model, elapsedMs: j.elapsedMs });
      }
    } catch (e) {
      setDraftErr(String(e));
    } finally {
      setDraftLoading(false);
    }
  }

  async function runMailCmd(commandText: string) {
    if (!selected || !commandText.trim() || mailCmdLoading) return;
    const q = commandText.trim();
    setMailCmdInput("");
    setMailCmdLoading(true);
    setMailCmdHistory((h) => [...h, { q, a: "" }]);
    try {
      const r = await fetch("/api/mail/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: selected.id, command: q }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setMailCmdHistory((h) => h.map((t, i) =>
        i === h.length - 1 ? { ...t, a: j.answer, suggestedAction: j.suggestedAction, model: j.model, ms: j.elapsed_ms } : t
      ));
    } catch (e) {
      setMailCmdHistory((h) => h.map((t, i) =>
        i === h.length - 1 ? { ...t, err: String(e) } : t
      ));
    } finally {
      setMailCmdLoading(false);
    }
  }

  async function copyDraft() {
    if (!draftText) return;
    try {
      await navigator.clipboard.writeText(draftText);
    } catch {
      // ignore
    }
  }

  const [replyBusy, setReplyBusy] = useState(false);
  const [replyResult, setReplyResult] = useState<string | null>(null);
  const [replyErr, setReplyErr] = useState<string | null>(null);

  // 다른 메일 선택 시 발송 상태 리셋
  useEffect(() => {
    setReplyResult(null);
    setReplyErr(null);
  }, [selected?.id]);

  async function sendReply() {
    if (!selected || !draftText) return;
    if (!window.confirm(`${selected.fromAddr}에게 답장 발송할까요?\n제목: Re: ${selected.subject}`)) return;
    setReplyBusy(true);
    setReplyResult(null);
    setReplyErr(null);
    try {
      const r = await fetch("/api/mail/send-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageId: selected.id,
          bodyText: draftText,
          includeQuote: true,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setReplyErr(j.error || `error ${r.status}`);
      } else {
        setReplyResult(`✓ 발송 완료 → ${j.to}`);
      }
    } catch (e) {
      setReplyErr(String(e));
    } finally {
      setReplyBusy(false);
    }
  }

  useEffect(() => {
    fetch("/mail.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  // ?id=<msgId> / ?q=<keyword> 으로 들어오면 해당 메일을 자동 선택 / 검색
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const qParam = sp.get("q");
    if (qParam) setQ(qParam);
    const id = sp.get("id");
    if (!id) return;
    const hit = data.messages.find((m) => m.id === id);
    if (hit) {
      setSelected(hit);
      markReadIfNeeded(hit);
      // 휴지통 항목이면 trashed 필터로 자동 전환
      if (hit.trashed) setFilter("trashed");
      // 다음 페인트 후 디테일 패널로 스크롤
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let xs = data.messages;
    // Hide trashed by default (except in 'trashed' filter)
    if (filter !== "trashed") xs = xs.filter((m) => !m.trashed);
    if (filter === "unread") xs = xs.filter((m) => m.unread);
    else if (filter === "trashed") xs = xs.filter((m) => m.trashed);
    else if (filter === "suspect") xs = xs.filter((m) => isSuspect(m));
    else if (filter !== "all") xs = xs.filter((m) => m.category === filter);
    if (q.trim()) {
      const Q = q.toLowerCase();
      xs = xs.filter(
        (m) =>
          m.subject.toLowerCase().includes(Q) ||
          m.fromName.toLowerCase().includes(Q) ||
          m.fromAddr.toLowerCase().includes(Q) ||
          m.body.toLowerCase().includes(Q) ||
          (m.aiSummary || "").toLowerCase().includes(Q),
      );
    }
    return xs;
  }, [data, q, filter]);

  const counts = useMemo(() => {
    const empty = { unread: 0, sales: 0, client: 0, finance: 0, urgent: 0, event: 0, lecture: 0, news: 0, noise: 0, trashed: 0, action: 0, info: 0, suspect: 0 };
    if (!data) return empty;
    const live = data.messages.filter((m) => !m.trashed);
    const c = { ...empty };
    c.unread = live.filter((m) => m.unread).length;
    c.trashed = data.messages.filter((m) => m.trashed).length;
    c.suspect = live.filter((m) => isSuspect(m)).length;
    for (const m of live) {
      if (m.category && m.category in c) (c as Record<string, number>)[m.category]++;
    }
    return c;
  }, [data]);

  // 키보드 단축키 — j/k 탐색, x trash, s spam, esc 닫기 (filtered 선언 이후에 정의)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!["j", "k", "x", "s", "escape"].includes(key)) return;
      e.preventDefault();
      if (key === "escape") { setSelected(null); return; }
      const list = filtered;
      const idx = selected ? list.findIndex((m) => m.id === selected.id) : -1;
      if (key === "j") {
        const next = list[idx + 1] || list[0];
        if (next) { setSelected(next); markReadIfNeeded(next); }
      } else if (key === "k") {
        const prev = list[idx - 1] || list[list.length - 1];
        if (prev) { setSelected(prev); markReadIfNeeded(prev); }
      } else if (key === "x" && selected) {
        void quickTriage(selected, "trash");
      } else if (key === "s" && selected) {
        void quickTriage(selected, "spam");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, filtered]);

  // 카테고리 필터 (한 row로 통합)
  const FILTER_PILLS = [
    { key: "all" as FilterMode, label: "ALL", color: "text-zinc-300" },
    { key: "unread" as FilterMode, label: "안 읽음", color: "text-zinc-100", count: "unread" as keyof typeof counts },
    { key: "sales" as FilterMode, label: "🤝 영업", color: "text-indigo-300", count: "sales" as keyof typeof counts },
    { key: "client" as FilterMode, label: "💼 클라", color: "text-emerald-300", count: "client" as keyof typeof counts },
    { key: "finance" as FilterMode, label: "💰 정산", color: "text-amber-300", count: "finance" as keyof typeof counts },
    { key: "urgent" as FilterMode, label: "🚨 긴급", color: "text-rose-300", count: "urgent" as keyof typeof counts },
    { key: "event" as FilterMode, label: "🎤 행사", color: "text-violet-300", count: "event" as keyof typeof counts },
    { key: "lecture" as FilterMode, label: "🎓 강의", color: "text-teal-300", count: "lecture" as keyof typeof counts },
    { key: "news" as FilterMode, label: "📰 정보", color: "text-sky-300", count: "news" as keyof typeof counts },
    { key: "suspect" as FilterMode, label: "🚨 스팸의심", color: "text-orange-300", count: "suspect" as keyof typeof counts },
    { key: "noise" as FilterMode, label: "🗑 노이즈", color: "text-zinc-400", count: "noise" as keyof typeof counts },
    { key: "trashed" as FilterMode, label: "🗑 휴지통", color: "text-zinc-500", count: "trashed" as keyof typeof counts },
  ];

  return (
    <div className="px-4 py-3 w-full max-w-none">
      {/* ROW 1: 타이틀 + 메타 + ⚙ */}
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-semibold leading-none">📧 메일</h1>
        <span className="text-[11px] text-zinc-500 font-mono leading-none">{data?.account}</span>
        <span className="ml-auto text-[11px] text-zinc-600 leading-none">
          {data ? `총 ${data.count}건 · ${data.days ?? 90}일 · 업데이트 ${ago(data.updatedAt)}` : "로딩 중..."}
        </span>
        <button
          onClick={() => setCmdVisible((v) => !v)}
          className={`text-[11px] px-2.5 h-7 rounded transition leading-none ${cmdVisible ? "bg-zinc-700 text-zinc-100" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}
          title="명령창 (fetch · classify · insight · 컬럼 리셋) · 단축키: J/K 탐색 · S 스팸 · X 휴지통"
        >
          ⚙ 명령
        </button>
      </div>

      {/* ROW 2: 검색 (단독 row) */}
      <div className="mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔎 검색 — 발신자, 제목, 본문, AI 요약 (단축키: J/K 탐색 · S 스팸 · X 휴지통)"
          className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
      </div>

      {/* 명령창 — 토글로 펼침 */}
      {cmdVisible && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500 font-mono">$</span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && execCommand()}
            placeholder="fetch · classify · insight · refresh · /sales /trashed · 검색어"
            className="flex-1 min-w-[200px] bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          <button onClick={() => runAdminAction("fetch")} disabled={cmdBusy} className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition">📥 fetch</button>
          <button onClick={() => runAdminAction("classify")} disabled={cmdBusy} className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition">🏷 분류</button>
          <button onClick={() => runAdminAction("insight")} disabled={cmdBusy} className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition">🔍 인사이트</button>
          <button onClick={() => runAdminAction("refresh")} disabled={cmdBusy} className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition">↻ 새로고침</button>
          <button onClick={resetCols} className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition" title="컬럼 너비 기본값">↺ 컬럼</button>
          {cmdBusy && <span className="text-[11px] text-amber-400 animate-pulse">실행 중...</span>}
          {cmdLog.length > 0 && (
            <details className="basis-full mt-1">
              <summary className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300">로그 ({cmdLog.length})</summary>
              <pre className="mt-1 text-[10px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">{cmdLog.join("\n")}</pre>
            </details>
          )}
        </div>
      )}

      {/* 필터 + 카운트 한 row (uniform alignment) */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTER_PILLS.map((p) => {
          const active = filter === p.key;
          const cnt = p.count ? (counts as Record<string, number>)[p.count] : null;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setFilter(p.key)}
              className={`inline-flex items-center gap-1 whitespace-nowrap leading-none px-2.5 h-7 rounded-md text-[11px] transition ${
                active
                  ? "bg-zinc-100 text-zinc-900 font-semibold"
                  : `bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 ${p.color}`
              }`}
            >
              <span>{p.label}</span>
              {cnt != null && (
                <span className={`tabular-nums text-[10px] ${active ? "opacity-70" : "opacity-60"}`}>{cnt}</span>
              )}
            </button>
          );
        })}
      </div>

      {err && (
        <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
          mail.json 로드 실패: {err}
        </div>
      )}

      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {filter !== "all" && filtered.length > 0 && (
            <>
              <span className="text-xs text-zinc-500">필터 결과 {filtered.length}건</span>
              {filter !== "trashed" && (
                <>
                  <button
                    onClick={() => bulkTriage("spam")}
                    disabled={bulkBusy}
                    className="text-[11px] px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-900/60 disabled:opacity-50 transition"
                    title="필터 결과 전체를 IMAP Junk 폴더로 이동"
                  >
                    🚨 전체 스팸 ({filtered.length})
                  </button>
                  <button
                    onClick={() => bulkTriage("trash")}
                    disabled={bulkBusy}
                    className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 disabled:opacity-50 transition"
                    title="필터 결과 전체를 IMAP Deleted Messages 폴더로 이동"
                  >
                    🗑 전체 휴지통 ({filtered.length})
                  </button>
                </>
              )}
              {filter === "trashed" && (
                <button
                  onClick={() => bulkTriage("restore")}
                  disabled={bulkBusy}
                  className="text-[11px] px-2 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-100 border border-emerald-900/60 disabled:opacity-50 transition"
                >
                  ↩️ 전체 복구 ({filtered.length})
                </button>
              )}
              {bulkBusy && <span className="text-xs text-zinc-500">처리 중...</span>}
            </>
          )}
        </div>
      </div>
      <div
        className="grid gap-0"
        style={{
          gridTemplateColumns: `${colWidths[0]}px 8px minmax(0, ${colWidths[1]}px) 8px minmax(0, ${colWidths[2]}px)`,
        }}
      >
        {/* 모바일: selected 있을 때 목록 숨김 */}
        <section className={`rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800 max-h-[75vh] overflow-y-auto ${selected ? "hidden lg:block" : ""}`}>
          {!data && <div className="p-6 text-sm text-zinc-500">로딩...</div>}
          {data && filtered.length === 0 && (
            <div className="p-6 text-sm text-zinc-500">결과 없음</div>
          )}
          {filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => { setSelected(m); markReadIfNeeded(m); }}
              className={`group relative w-full text-left px-4 py-3 hover:bg-zinc-800/40 cursor-pointer transition ${
                selected?.id === m.id ? "bg-zinc-800/60" : ""
              }`}
            >
              <div className="flex items-center gap-2 leading-none">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    m.category && CATEGORY_META[m.category]
                      ? CATEGORY_META[m.category].dot
                      : m.priority
                        ? PRIORITY_DOT[m.priority]
                        : m.unread
                          ? "bg-sky-400"
                          : "bg-transparent"
                  }`}
                />
                <span className={`text-sm w-32 truncate ${m.unread ? "text-zinc-100 font-medium" : "text-zinc-400"}`}>
                  {m.fromName || m.fromAddr.split("@")[0]}
                </span>
                {m.category && CATEGORY_META[m.category] && (
                  <span
                    className={`inline-flex items-center text-[9px] uppercase tracking-wider border px-1.5 h-4 rounded ${CATEGORY_META[m.category].badge}`}
                  >
                    {CATEGORY_META[m.category].emoji} {CATEGORY_META[m.category].label}
                  </span>
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <span className="text-[10px] text-zinc-500 tabular-nums" title={m.attachments.map(a => a.name).join(", ")}>
                    📎{m.attachments.length}
                  </span>
                )}
                <span className="text-xs text-zinc-600 ml-auto shrink-0 tabular-nums">{ago(m.ts)}</span>
              </div>
              <div className={`mt-1 text-sm truncate ${m.unread ? "text-zinc-100" : "text-zinc-400"}`}>
                {m.subject || "(제목 없음)"}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500 truncate">
                {m.aiSummary || m.snippet}
              </div>
              {/* 인라인 빠른 액션 — 호버 시 노출 */}
              {!m.trashed && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); void quickTriage(m, "spam"); }}
                    className="p-1.5 rounded bg-rose-900/80 hover:bg-rose-700 text-rose-100 text-[11px]"
                    title="스팸 (S) — Junk 폴더로 이동"
                  >
                    🚨
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void quickTriage(m, "trash"); }}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px]"
                    title="휴지통 (X) — Deleted Messages로 이동"
                  >
                    🗑
                  </button>
                </div>
              )}
              {m.trashed && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={(e) => { e.stopPropagation(); void quickTriage(m, "restore"); }}
                    className="p-1.5 rounded bg-emerald-900/80 hover:bg-emerald-700 text-emerald-100 text-[11px]"
                    title="복구"
                  >
                    ↩️
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>

        <div
          onMouseDown={(e) => { e.preventDefault(); setResizingIdx(0); }}
          onDoubleClick={resetCols}
          className={`group relative cursor-col-resize transition select-none flex items-center justify-center ${resizingIdx === 0 ? "bg-indigo-500/30" : "hover:bg-indigo-500/15"}`}
          title="드래그로 너비 조정 · 더블클릭으로 기본값"
        >
          <span className={`block w-0.5 h-8 rounded-full transition ${resizingIdx === 0 ? "bg-indigo-400" : "bg-zinc-700 group-hover:bg-indigo-400"}`} />
        </div>

        {/* 컬럼 2: 메일 내용 */}
        <section ref={detailRef} className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 max-h-[75vh] overflow-y-auto ${!selected ? "hidden lg:block" : ""}`}>
          {!selected && (
            <div className="text-sm text-zinc-500">← 왼쪽에서 메일 선택</div>
          )}
          {selected && (
            <div>
              <button
                onClick={() => setSelected(null)}
                className="lg:hidden mb-3 px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
              >
                ← 목록으로
              </button>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {selected.category && CATEGORY_META[selected.category] && (
                  <span
                    className={`text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded ${CATEGORY_META[selected.category].badge}`}
                  >
                    {CATEGORY_META[selected.category].emoji} {CATEGORY_META[selected.category].label}
                  </span>
                )}
                {selected.priority && (
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
                    {selected.priority}
                  </span>
                )}
                <div className="ml-auto flex gap-1.5">
                  {!selected.trashed ? (
                    <>
                      <button
                        onClick={() => triage("spam")}
                        disabled={triageBusy}
                        className="px-2 py-0.5 rounded text-[10px] bg-rose-950/60 hover:bg-rose-900/60 text-rose-200 border border-rose-900/40 disabled:opacity-50 transition"
                        title="스팸 → Junk 폴더로 이동 (실제 메일함)"
                      >
                        🚨 스팸
                      </button>
                      <button
                        onClick={() => triage("trash")}
                        disabled={triageBusy}
                        className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 disabled:opacity-50 transition"
                        title="휴지통 → Deleted Messages로 이동 (실제 메일함)"
                      >
                        🗑
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => triage("restore")}
                      disabled={triageBusy}
                      className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-900/40 disabled:opacity-50 transition"
                    >
                      ↩️ 복구
                    </button>
                  )}
                </div>
              </div>
              <h2 className="text-lg font-medium text-zinc-100">
                {selected.subject || "(제목 없음)"}
              </h2>
              <div className="mt-2 text-xs text-zinc-500 space-y-1">
                <p>
                  <span className="text-zinc-600">From:</span>{" "}
                  <span className="text-zinc-300">{selected.fromName}</span>{" "}
                  <span className="text-zinc-500">&lt;{selected.fromAddr}&gt;</span>
                </p>
                <p>
                  <span className="text-zinc-600">Date:</span>{" "}
                  <span className="text-zinc-400">{selected.date}</span>
                </p>
              </div>
              {selected.attachments && selected.attachments.length > 0 && (
                <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-950/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">
                    📎 첨부 ({selected.attachments.length})
                  </div>
                  {/* 이미지 미리보기 그리드 */}
                  {selected.attachments.some((a) => a.url && a.mime.startsWith("image/")) && (
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {selected.attachments
                        .filter((a) => a.url && a.mime.startsWith("image/"))
                        .map((a, i) => (
                          <a
                            key={i}
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded border border-zinc-700 overflow-hidden hover:border-zinc-500 transition"
                            title={`${a.name} · ${fmtSize(a.size)}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.url}
                              alt={a.name}
                              className="w-full h-24 object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {selected.attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-zinc-500">
                          {a.mime.startsWith("image/") ? "🖼" : a.mime.includes("pdf") ? "📄" : "📎"}
                        </span>
                        {a.url ? (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-200 truncate hover:underline"
                          >
                            {a.name}
                          </a>
                        ) : (
                          <span className="text-zinc-200 truncate">{a.name}</span>
                        )}
                        <span className="text-zinc-600 font-mono shrink-0">{fmtSize(a.size)}</span>
                      </li>
                    ))}
                  </ul>
                  {selected.attachments.some((a) => !a.url && a.mime.startsWith("image/")) && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      ⚠️ 일부 이미지는 다음 fetch 이후 표시 (5MB 이하만 저장)
                    </p>
                  )}
                </div>
              )}
              <hr className="border-zinc-800 my-4" />
              <BodyView m={selected} />
              <p className="mt-4 text-xs text-zinc-600 font-mono">
                full body indexed · 검색 OK · 답장은 → AI 패널 (오른쪽)
              </p>
            </div>
          )}
        </section>

        <div
          onMouseDown={(e) => { e.preventDefault(); setResizingIdx(1); }}
          onDoubleClick={resetCols}
          className={`group relative cursor-col-resize transition select-none flex items-center justify-center ${resizingIdx === 1 ? "bg-indigo-500/30" : "hover:bg-indigo-500/15"}`}
          title="드래그로 너비 조정 · 더블클릭으로 기본값"
        >
          <span className={`block w-0.5 h-8 rounded-full transition ${resizingIdx === 1 ? "bg-indigo-400" : "bg-zinc-700 group-hover:bg-indigo-400"}`} />
        </div>

        {/* 컬럼 3: AI 패널 (요약 + 인사이트 + 답장 초안) */}
        <section className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 max-h-[75vh] overflow-y-auto space-y-3 ${!selected ? "hidden lg:block" : ""}`}>
          {!selected && (
            <div className="text-sm text-zinc-500">← 메일 선택 시 AI 분석</div>
          )}
          {selected && (
            <>
              {selected.aiSummary && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">AI 한줄</div>
                  <p className="text-sm text-zinc-200 italic">{selected.aiSummary}</p>
                </div>
              )}

              {/* AI 상세 요약 — 메일 클릭 시 자동 */}
              <div className="rounded-lg border border-indigo-900/60 bg-indigo-950/30 p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-indigo-300">
                    🔮 AI 상세 요약
                  </span>
                  {summaryMeta?.elapsedMs && (
                    <span className="text-[10px] text-zinc-600 font-mono">
                      {(summaryMeta.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <button
                    onClick={() => generateSummary(!!summary)}
                    disabled={summaryLoading}
                    className="ml-auto px-2 py-0.5 rounded text-[10px] bg-indigo-700/60 hover:bg-indigo-600 text-zinc-100 disabled:opacity-50 transition"
                    title={summary ? "↻ 재생성 (캐시 무시)" : "AI 상세 요약 생성"}
                  >
                    {summaryLoading ? "..." : summary ? "↻ 재생성" : "🤖 요약"}
                  </button>
                </div>
                {summaryLoading && !summary && (
                  <p className="text-xs text-zinc-500 italic">본문 분석 중...</p>
                )}
                {summaryErr && <p className="text-xs text-rose-300">에러: {summaryErr}</p>}
                {summary && (
                  <div className="text-[13px] text-zinc-100 whitespace-pre-wrap leading-relaxed">
                    {summary}
                  </div>
                )}
                {!summary && !summaryLoading && !summaryErr && (
                  <p className="text-xs text-zinc-500">"🤖 요약" 클릭으로 생성</p>
                )}
              </div>

              {selected.aiInsight && (
                <div className="rounded-lg border border-sky-900/60 bg-sky-950/30 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-sky-300 mb-1.5">
                    🔍 뉴스레터 인사이트
                  </div>
                  <p className="text-[13px] text-zinc-200 whitespace-pre-wrap leading-relaxed">
                    {selected.aiInsight}
                  </p>
                </div>
              )}

              {/* 🪄 AI 명령 — 자주 사용 (이전 컬럼 4 위치에서 이동) */}
              <div className="rounded-lg border border-violet-900/40 bg-violet-950/20 p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-violet-300">🪄 AI 명령</span>
                  <span className="text-[10px] text-zinc-600">정리·요약·분류 (답장 X)</span>
                </div>
                {mailCmdHistory.length > 0 && (
                  <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1 mb-2">
                    {mailCmdHistory.map((t, i) => (
                      <div key={i} className="space-y-1">
                        <div className="text-xs text-zinc-400">
                          <span className="text-zinc-600 mr-1">›</span>{t.q}
                        </div>
                        {t.err ? (
                          <div className="text-xs text-rose-300">⚠ {t.err}</div>
                        ) : t.a ? (
                          <div className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-violet-700/50">
                            {t.a}
                            <div className="text-[10px] text-zinc-600 mt-1 font-mono flex gap-2 items-center flex-wrap">
                              {t.model && <span>{t.model}</span>}
                              {t.ms !== undefined && <span>{Math.round(t.ms / 1000)}s</span>}
                              {t.suggestedAction && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/40">
                                  ⚡ {t.suggestedAction}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-500 pl-3">… 생성 중</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(e) => { e.preventDefault(); void runMailCmd(mailCmdInput); }}
                  className="flex gap-2"
                >
                  <input
                    value={mailCmdInput}
                    onChange={(e) => setMailCmdInput(e.target.value)}
                    placeholder="이 메일에 대해 명령…"
                    disabled={mailCmdLoading}
                    className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-700 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={mailCmdLoading || !mailCmdInput.trim()}
                    className="px-3 py-1.5 rounded text-[11px] bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-50 transition"
                  >
                    {mailCmdLoading ? "…" : "실행"}
                  </button>
                </form>
                {mailCmdHistory.length === 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {["한 줄 요약", "발신자 누구야?", "답장 필요해?", "분류 맞아?", "휴지통 후보?"].map((s) => (
                      <button
                        key={s}
                        onClick={() => runMailCmd(s)}
                        disabled={mailCmdLoading}
                        className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 🤖 AI 답장 (병합 — 컬럼 3 내부에 카드로) */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400">🤖 AI 답장</span>
                  <span className="text-[10px] text-zinc-600">SMTP 직접 발송 · 원본 인용 자동</span>
                  {draftMeta?.elapsedMs && (
                    <span className="text-[10px] text-zinc-600 font-mono ml-auto">
                      {(draftMeta.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <textarea
                  value={draftHint}
                  onChange={(e) => setDraftHint(e.target.value)}
                  placeholder="(선택) 답장에 반영할 메모"
                  rows={2}
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
                />
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button
                    onClick={generateDraft}
                    disabled={draftLoading}
                    className="px-2.5 py-1 rounded text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition"
                  >
                    {draftLoading ? "..." : draftText ? "↻ 재생성" : "초안 생성"}
                  </button>
                  {draftText && (
                    <>
                      <button
                        onClick={sendReply}
                        disabled={replyBusy}
                        className="px-2.5 py-1 rounded text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition font-semibold"
                        title={`${selected.fromAddr}에게 SMTP로 직접 발송 (원본 인용 자동 포함)`}
                      >
                        {replyBusy ? "발송 중..." : "🚀 답장 발송"}
                      </button>
                      <button
                        onClick={copyDraft}
                        className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                      >
                        📋
                      </button>
                      <a
                        href="https://mail.worksmobile.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                      >
                        ↗ Works
                      </a>
                    </>
                  )}
                </div>
                {draftErr && <p className="mt-2 text-xs text-rose-300">에러: {draftErr}</p>}
                {replyResult && (
                  <p className="mt-2 text-xs text-emerald-300 border border-emerald-900/60 bg-emerald-950/30 rounded px-2 py-1">
                    {replyResult}
                  </p>
                )}
                {replyErr && (
                  <p className="mt-2 text-xs text-rose-300 border border-rose-900/60 bg-rose-950/30 rounded px-2 py-1">
                    ✗ 발송 실패: {replyErr}
                  </p>
                )}
                {draftText && (
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={Math.min(16, Math.max(6, draftText.split("\n").length + 1))}
                    className="mt-2 w-full bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-2 text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-600 resize-y leading-relaxed whitespace-pre-wrap"
                  />
                )}
              </div>

            </>
          )}
        </section>
      </div>

      <p className="mt-6 text-xs text-zinc-600 font-mono">
        Source: Mail · 최근 {data?.days ?? 90}일 · fetch */15min · classify */30min
      </p>
    </div>
  );
}
