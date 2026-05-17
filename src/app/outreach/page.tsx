"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Material = "company" | "creators";

type FileStatus = Record<Material, { exists: boolean; size?: number; path: string }>;

const MATERIALS: { key: Material; label: string; file: string; emoji: string }[] = [
  { key: "company",  label: "회사 소개서", file: "/files/company-deck.pdf",     emoji: "🏢" },
  { key: "creators", label: "제품 소개서", file: "/files/product-deck.pdf",  emoji: "📦" },
];

export default function OutreachPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-zinc-500">로딩...</div>}>
      <OutreachPageInner />
    </Suspense>
  );
}

function OutreachPageInner() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [meetingNote, setMeetingNote] = useState("");
  const [picks, setPicks] = useState<Material[]>(["company"]);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileStatus, setFileStatus] = useState<FileStatus | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<Material | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetSlot, setUploadTargetSlot] = useState<Material | null>(null);
  const [tone, setTone] = useState<"formal" | "casual" | "english" | "default">("default");
  type LogItem = { id: number; sent_at: number; to_email: string; to_name: string | null; subject: string; tone: string | null; materials: string[] };
  const [logItems, setLogItems] = useState<LogItem[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  const refreshLog = async () => {
    setLogLoading(true);
    try {
      const r = await fetch("/api/outreach/log?limit=20", { cache: "no-store" });
      const j = await r.json();
      setLogItems(j.items || []);
    } catch {
      setLogItems([]);
    } finally {
      setLogLoading(false);
    }
  };

  const sp = useSearchParams();
  useEffect(() => {
    const qn = sp?.get("name");
    const qe = sp?.get("email");
    const qm = sp?.get("note");
    if (qn) setName(qn);
    if (qe) setEmail(qe);
    if (qm) setMeetingNote(qm);
  }, [sp]);

  useEffect(() => {
    fetch("/api/outreach/upload")
      .then((r) => r.json())
      .then((j) => setFileStatus(j as FileStatus))
      .catch(() => setFileStatus(null));
    void refreshLog();
  }, []);

  async function uploadFile(slot: Material, file: File) {
    setUploadingSlot(slot);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/outreach/upload?slot=${slot}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        alert(`업로드 실패: ${j.error || r.status}`);
      } else {
        // 다시 상태 fetch
        const r2 = await fetch("/api/outreach/upload");
        setFileStatus(await r2.json());
      }
    } catch (e) {
      alert(`업로드 실패: ${e}`);
    } finally {
      setUploadingSlot(null);
      setUploadTargetSlot(null);
    }
  }

  function triggerUpload(slot: Material) {
    setUploadTargetSlot(slot);
    uploadInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && uploadTargetSlot) {
      void uploadFile(uploadTargetSlot, file);
    }
    e.target.value = "";
  }

  const selectedMaterials = useMemo(
    () => MATERIALS.filter((m) => picks.includes(m.key)),
    [picks],
  );

  function togglePick(k: Material) {
    setPicks((prev) => (prev.includes(k) ? prev.filter((p) => p !== k) : [...prev, k]));
  }

  async function generateDraft() {
    setLoading(true);
    setErr(null);
    setCopied(false);
    try {
      const r = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          meetingNote: meetingNote.trim() || undefined,
          materials: selectedMaterials.map((m) => m.label),
          tone: tone === "default" ? undefined : tone,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || `error ${r.status}`);
      } else {
        setDraft(j.draft);
        setSubject(j.subject || "");
        setModel(j.model || null);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(`제목: ${subject}\n\n${draft}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function sendNow() {
    if (!email || !subject || !draft) return;
    // 선택한 자료 중 디스크에 없는 파일 차단
    const missing = selectedMaterials.filter((m) => !fileStatus?.[m.key]?.exists);
    if (missing.length > 0) {
      alert(
        `다음 자료가 아직 업로드되지 않아 발송할 수 없습니다:\n${missing
          .map((m) => `- ${m.label}`)
          .join("\n")}\n\n해당 항목의 "📤 업로드" 버튼을 먼저 누르세요.`,
      );
      return;
    }
    if (!window.confirm(`${email}에게 지금 발송할까요?\n첨부: ${selectedMaterials.map(m=>m.label).join(", ") || "없음"}`)) return;
    setSending(true);
    setSendResult(null);
    setSendErr(null);
    try {
      const r = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: email.trim(),
          name: name.trim(),
          subject,
          bodyText: draft,
          attachments: selectedMaterials.map((m) => m.file),
          tone: tone === "default" ? undefined : tone,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSendErr(j.error || `error ${r.status}`);
      } else {
        void refreshLog();
        const sent = (j.attachments_sent || []).map((a: { name: string }) => a.name).join(", ") || "없음";
        const skipped = j.attachments_skipped?.length
          ? ` (스킵: ${j.attachments_skipped.length}건)` : "";
        setSendResult(`✓ 발송 완료 → ${j.to} · 첨부: ${sent}${skipped}`);
      }
    } catch (e) {
      setSendErr(String(e));
    } finally {
      setSending(false);
    }
  }

  const mailtoUrl = useMemo(() => {
    if (!email || !draft) return "";
    const fileHint =
      selectedMaterials.length > 0
        ? `\n\n[첨부 안내: ${selectedMaterials.map((m) => m.label).join(", ")} — 메일 작성 후 본 페이지에서 PDF 다운받아 직접 첨부]`
        : "";
    const params = new URLSearchParams({
      subject,
      body: draft + fileHint,
    });
    return `mailto:${email}?${params.toString()}`;
  }, [email, draft, subject, selectedMaterials]);

  const ready = name.trim() && email.trim();

  return (
    <div className="px-4 py-6 w-full max-w-none">
      <header className="mb-4 flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">outreach · mailto-based · AI-drafted</p>
          <h1 className="text-2xl font-semibold mt-1">📨 외부 발송</h1>
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed max-w-md text-right">
          받는 사람 + 메모 입력 → AI 초안 → SMTP 직접 발송 또는 mailto. PDF 첨부 자동.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)_280px] gap-5">
        {/* LEFT: 입력 */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
          {/* 빠른 템플릿 */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1.5">빠른 템플릿</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "brand", label: "🏷 브랜드 매니저", note: "박람회/미팅에서 명함 교환. 브랜드 마케팅·콘텐츠 협업 가능성 있음." },
                { key: "influencer", label: "📸 인플루언서 협업", note: "크리에이터 측에서 K-뷰티 협업 제안. 어떤 브랜드 적합한지 추천 요청." },
                { key: "media", label: "📰 기자/미디어", note: "인터뷰·기고·취재 협조 요청. K-뷰티 트렌드·MCN 산업 인사이트 필요." },
                { key: "intl", label: "🌍 해외 파트너", note: "Met at <event/intro>. They are exploring K-Beauty distribution / brand deal partnerships in <region>." },
              ].map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => setMeetingNote(tpl.note)}
                  className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* 어조 셀렉터 */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1.5">AI 어조</label>
            <div className="flex gap-1.5 flex-wrap">
              {([
                { key: "default", label: "기본", desc: "정중·간결" },
                { key: "formal", label: "정중·격식", desc: "처음 인사" },
                { key: "casual", label: "친근·구어", desc: "이미 안면" },
                { key: "english", label: "🌍 영문", desc: "EN auto" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTone(t.key)}
                  className={`text-[11px] px-2.5 py-1 rounded transition ${tone === t.key ? "bg-indigo-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}
                  title={t.desc}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 block mb-1">
              받는 사람 이름
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 김민지 매니저"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 block mb-1">
              받는 사람 이메일
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@brand.com"
              type="email"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 block mb-1">
              만난 자리 / 메모 <span className="text-zinc-700">(인사 톤 결정)</span>
            </label>
            <textarea
              value={meetingNote}
              onChange={(e) => setMeetingNote(e.target.value)}
              placeholder="예: 어제 코엑스 K-뷰티 박람회에서 명함 교환. 색조 라인 신규 런칭 준비 중이라 하셨음."
              rows={4}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-y"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
              첨부할 자료 (복수 선택 OK)
            </label>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={onFilePicked}
            />
            <div className="space-y-2">
              {MATERIALS.map((m) => {
                const selected = picks.includes(m.key);
                const status = fileStatus?.[m.key];
                const hasFile = !!status?.exists;
                return (
                  <div
                    key={m.key}
                    className={`rounded border px-3 py-2 text-sm transition ${
                      selected
                        ? "border-indigo-600 bg-indigo-950/40 text-zinc-100"
                        : "border-zinc-800 bg-zinc-950 text-zinc-400"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => togglePick(m.key)}
                        className="flex-1 text-left hover:text-zinc-100 transition"
                      >
                        {selected ? "☑" : "☐"} {m.emoji} {m.label}
                        {hasFile ? (
                          <span className="ml-2 text-[10px] text-emerald-400">
                            ✓ {((status?.size || 0) / 1024 / 1024).toFixed(1)}MB
                          </span>
                        ) : (
                          <span className="ml-2 text-[10px] text-amber-400">
                            ⚠️ 파일 없음 — 업로드 필요
                          </span>
                        )}
                      </button>
                      <div className="flex gap-1.5 items-center">
                        {hasFile && (
                          <a
                            href={m.file}
                            onClick={(e) => e.stopPropagation()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-zinc-500 hover:text-zinc-200 underline"
                          >
                            보기
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => triggerUpload(m.key)}
                          disabled={uploadingSlot === m.key}
                          className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 disabled:opacity-50 transition"
                        >
                          {uploadingSlot === m.key ? "업로드 중..." : hasFile ? "📤 교체" : "📤 업로드"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-zinc-600 font-mono">
              PDF만 지원, 슬롯당 1개, 최대 30MB · 같은 슬롯에 다시 업로드하면 덮어씀
            </p>
          </div>

          <button
            onClick={generateDraft}
            disabled={!ready || loading}
            className="w-full px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? "생성 중..." : draft ? "↻ 재생성" : "🤖 초안 생성"}
          </button>
          {err && <p className="text-xs text-rose-300">에러: {err}</p>}
        </section>

        {/* RIGHT: 출력 */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          {!draft && (
            <div className="text-sm text-zinc-500">
              ← 왼쪽 폼 채우고 "초안 생성" 누르세요.
            </div>
          )}
          {draft && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-400">
                  AI 초안
                </span>
                <span className="text-[10px] text-zinc-600 font-mono">{model ?? ""}</span>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
                  제목
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
                  본문 (수정 가능)
                </label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(20, Math.max(8, draft.split("\n").length + 1))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap focus:outline-none focus:border-zinc-600 resize-y"
                />
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={sendNow}
                  disabled={sending || !ready || !draft}
                  className="px-3 py-2 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold"
                  title="SMTP로 즉시 발송 (첨부 파일 자동 포함)"
                >
                  {sending ? "발송 중..." : "🚀 직접 발송 (SMTP + 첨부)"}
                </button>
                <button
                  onClick={copyDraft}
                  className="px-3 py-2 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition"
                >
                  {copied ? "✓ 복사됨" : "📋 복사"}
                </button>
                {mailtoUrl && (
                  <a
                    href={mailtoUrl}
                    className="px-3 py-2 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                  >
                    ✉️ mailto
                  </a>
                )}
                <a
                  href="https://mail.worksmobile.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                >
                  ↗ Works
                </a>
              </div>
              {sendResult && (
                <div className="mt-2 rounded border border-emerald-900/60 bg-emerald-950/30 p-2.5 text-xs text-emerald-200">
                  {sendResult}
                </div>
              )}
              {sendErr && (
                <div className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 p-2.5 text-xs text-rose-200">
                  ✗ 발송 실패: {sendErr}
                </div>
              )}
              {selectedMaterials.length > 0 && (
                <div className="text-xs text-zinc-500 mt-3 border-t border-zinc-800 pt-3">
                  <p className="mb-1 text-zinc-400">📎 첨부 파일 (메일 작성 후 직접 첨부)</p>
                  <ul className="space-y-1">
                    {selectedMaterials.map((m) => (
                      <li key={m.key}>
                        <a
                          href={m.file}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-300 hover:underline"
                        >
                          {m.emoji} {m.label} → 다운로드
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT: 최근 발송 이력 */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-200">📤 최근 발송 (20)</h2>
            <button
              onClick={refreshLog}
              disabled={logLoading}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
            >
              {logLoading ? "…" : "↻"}
            </button>
          </div>
          {logItems === null && <p className="text-xs text-zinc-500">로딩…</p>}
          {logItems && logItems.length === 0 && <p className="text-xs text-zinc-500">아직 발송 이력 없음.</p>}
          {logItems && logItems.length > 0 && (
            <ul className="divide-y divide-zinc-800/60 space-y-0">
              {logItems.map((it) => {
                const d = new Date(it.sent_at * 1000);
                const dateStr = d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
                const timeStr = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
                return (
                  <li key={it.id} className="py-2 group">
                    <button
                      onClick={() => {
                        setName(it.to_name || "");
                        setEmail(it.to_email);
                        setSubject(it.subject || "");
                        setDraft("");
                        setMeetingNote("");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="w-full text-left hover:bg-zinc-800/40 rounded p-1.5 transition"
                      title="클릭 시 재발송 모드로 입력 채움"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-zinc-200 font-semibold truncate flex-1">{it.to_name || it.to_email}</span>
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">{dateStr} {timeStr}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate mt-0.5">{it.subject}</div>
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        <span className="text-[9px] text-zinc-600 font-mono">{it.to_email}</span>
                        {it.tone && it.tone !== "default" && (
                          <span className="text-[9px] px-1 rounded bg-indigo-900/40 text-indigo-300">{it.tone}</span>
                        )}
                        {it.materials.length > 0 && (
                          <span className="text-[9px] text-zinc-600">📎{it.materials.length}</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-zinc-600 mt-3">
            💡 항목 클릭 → 재발송 모드 (이름/이메일/제목 자동 채움)
          </p>
        </section>
      </div>

      <p className="mt-6 text-xs text-zinc-600 font-mono">
        흐름: 폼 입력 → 초안 생성 → 본문 수정 → SMTP 직접 발송 또는 mailto → 자동 로그 저장
      </p>
    </div>
  );
}
