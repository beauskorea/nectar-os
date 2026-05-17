"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string; emoji: string; hint: string; external?: boolean };
type NavGroup = { id: string; label: string; emoji: string; children: NavItem[] };
type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};

function parseDateLocal(sIn: string): Date {
  if (sIn.length === 10) {
    const [y, m, d] = sIn.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(sIn);
}

function kstParts(now: Date): { y: number; m: number; d: number } {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth(), d: kst.getUTCDate() };
}

function isoWeekKst(now: Date): { week: number; range: string } {
  const { y, m, d } = kstParts(now);
  const date = new Date(Date.UTC(y, m, d));
  const dayNum = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - (dayNum - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const range = `${monday.getUTCMonth() + 1}/${monday.getUTCDate()} – ${sunday.getUTCMonth() + 1}/${sunday.getUTCDate()}`;
  return { week, range };
}

const NAV_TREE: NavGroup[] = [
  {
    id: "daily", label: "데일리", emoji: "🌅",
    children: [
      { href: "/", label: "오늘", emoji: "🌅", hint: "Today" },
      { href: "/focus", label: "집중처리", emoji: "🎯", hint: "Triage" },
      { href: "/todos", label: "할 일", emoji: "✅", hint: "Kanban" },
      { href: "/inbox", label: "인박스", emoji: "📥", hint: "Capture" },
      { href: "/memo", label: "메모장", emoji: "📝", hint: "Notes AI" },
    ],
  },
  {
    id: "mail", label: "메일·발송", emoji: "📧",
    children: [
      { href: "/mail", label: "메일", emoji: "📧", hint: "Inbox" },
      { href: "/mail/insights", label: "메일분석", emoji: "📊", hint: "Analytics" },
      { href: "/digest", label: "뉴스 다이제스트", emoji: "📰", hint: "Weekly" },
      { href: "/outreach", label: "외부 발송", emoji: "📨", hint: "Mailto" },
    ],
  },
  {
    id: "schedule", label: "일정", emoji: "📅",
    children: [
      { href: "/calendar", label: "캘린더", emoji: "📅", hint: "Month" },
    ],
  },
  {
    id: "people", label: "사람", emoji: "👥",
    children: [
      { href: "/people", label: "인맥", emoji: "👥", hint: "CRM" },
      { href: "/partners", label: "파트너", emoji: "🤝", hint: "Mgmt" },
    ],
  },
  {
    id: "research", label: "리서치·돈", emoji: "🏢",
    children: [
      { href: "/money", label: "재정", emoji: "💰", hint: "Month" },
    ],
  },
];

const HOT_HREFS = new Set(["/people", "/mail/insights"]);
const STORAGE_KEY = "jinho-os:sidebar-folders:v1";
const LAYOUT_KEY = "jinho-os:sidebar-layout:v1";

type Layout = { folderOrder: string[]; folderChildren: Record<string, string[]> };

const LEAF_BY_HREF: Record<string, NavItem> = (() => {
  const m: Record<string, NavItem> = {};
  for (const g of NAV_TREE) for (const c of g.children) m[c.href] = c;
  return m;
})();

const DEFAULT_LAYOUT: Layout = {
  folderOrder: NAV_TREE.map((g) => g.id),
  folderChildren: Object.fromEntries(NAV_TREE.map((g) => [g.id, g.children.map((c) => c.href)])),
};

function normalizeLayout(stored: unknown): Layout {
  const knownFolders = new Set(DEFAULT_LAYOUT.folderOrder);
  const allHrefs = new Set(Object.keys(LEAF_BY_HREF));
  const out: Layout = { folderOrder: [], folderChildren: {} };

  const storedObj = (stored && typeof stored === "object") ? (stored as Partial<Layout>) : {};
  const storedOrder = Array.isArray(storedObj.folderOrder) ? storedObj.folderOrder : [];
  const remainingFolders = new Set(knownFolders);
  for (const id of storedOrder) {
    if (knownFolders.has(id) && remainingFolders.has(id)) {
      out.folderOrder.push(id);
      remainingFolders.delete(id);
    }
  }
  for (const id of DEFAULT_LAYOUT.folderOrder) if (remainingFolders.has(id)) out.folderOrder.push(id);

  const placed = new Set<string>();
  const storedChildren = (storedObj.folderChildren && typeof storedObj.folderChildren === "object")
    ? (storedObj.folderChildren as Record<string, unknown>)
    : {};
  for (const id of out.folderOrder) {
    out.folderChildren[id] = [];
    const arr = Array.isArray(storedChildren[id]) ? (storedChildren[id] as unknown[]) : [];
    for (const h of arr) {
      if (typeof h === "string" && allHrefs.has(h) && !placed.has(h)) {
        out.folderChildren[id].push(h);
        placed.add(h);
      }
    }
  }
  for (const id of DEFAULT_LAYOUT.folderOrder) {
    for (const href of DEFAULT_LAYOUT.folderChildren[id]) {
      if (!placed.has(href)) {
        if (!out.folderChildren[id]) out.folderChildren[id] = [];
        out.folderChildren[id].push(href);
        placed.add(href);
      }
    }
  }
  return out;
}

function defaultExpanded(pathname: string, layout: Layout): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of layout.folderOrder) {
    out[id] = (layout.folderChildren[id] ?? []).includes(pathname);
  }
  return out;
}

type DragPayload =
  | { kind: "folder"; id: string }
  | { kind: "leaf"; href: string };

type DropTarget =
  | { kind: "folder-before"; id: string }
  | { kind: "folder-append"; id: string }
  | { kind: "leaf-before"; href: string };

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [nextEvent, setNextEvent] = useState<CalEvent | null>(null);
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [overdueCount, setOverdueCount] = useState<number | null>(null);

  // 1초마다 시계 갱신
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // /people.json 폴링 — overdue (놓친 인맥) 수. 5분 주기.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/people.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const ppl = Array.isArray(d?.people) ? d.people : [];
          setOverdueCount(ppl.filter((p: { overdue?: boolean }) => p.overdue).length);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* counts: badges on nav items — refresh 60s */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [mailR, peopleR, decR, taskR, sbR, partnersR] = await Promise.all([
          fetch("/mail.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/people.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/decisions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/partners_supplement.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        const next: Record<string, number> = {};
        if (mailR?.messages) {
          next["/mail"] = mailR.messages.filter((m: any) => m.unread && !m.trashed).length;
          next["/mail/insights"] = mailR.messages.filter((m: any) => !m.trashed && (m.priority === "high" || m.category === "action" || m.category === "urgent") && m.unread).length;
        }
        if (peopleR?.people) {
          next["/people"] = peopleR.people.filter((p: any) => p.overdue).length;
        }
        if (decR?.items) {
          const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
          next["/decisions"] = decR.items.filter((d: any) => d.date === todayKst).length;
        }
        if (taskR?.todos) {
          next["/todos"] = taskR.todos.filter((t: any) => t.status !== "done").length;
        }
        if (partnersR?.additional_partners) {
          next["/partners"] = partnersR.additional_partners.filter(
            (p: { autoIngested?: boolean; reviewedAt?: number }) => p.autoIngested && !p.reviewedAt,
          ).length;
        }
        setCounts(next);
      } catch {}
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);


  // /events.json 폴링해서 "지금 이후 가장 빠른 이벤트" 찾기. 60초 주기.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/events.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const events = Array.isArray(d?.events) ? (d.events as CalEvent[]) : [];
          const t = Date.now();
          let best: CalEvent | null = null;
          let bestTs = Infinity;
          for (const ev of events) {
            const startTs = parseDateLocal(ev.start).getTime();
            // 종료 시간이 지난 건 스킵
            const endTs = parseDateLocal(ev.end).getTime();
            if (endTs < t) continue;
            // 현재 진행 중 또는 미래 — 시작 시각이 가장 가까운 거
            if (startTs < bestTs) {
              bestTs = startTs;
              best = ev;
            }
          }
          // 오늘 일정 (KST 기준) 카운트
          const todayKst = new Date(t);
          const todayY = todayKst.getFullYear();
          const todayM = todayKst.getMonth();
          const todayD = todayKst.getDate();
          let todayN = 0;
          for (const ev of events) {
            const sd = parseDateLocal(ev.start);
            const ed = parseDateLocal(ev.end);
            const inToday =
              (sd.getFullYear() === todayY && sd.getMonth() === todayM && sd.getDate() === todayD) ||
              (sd.getTime() <= todayKst.getTime() && ed.getTime() >= todayKst.getTime());
            if (inToday) todayN++;
          }
          setTodayCount(todayN);
          setNextEvent(best);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 레이아웃(폴더 순서·내부 항목 순서) 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) setLayout(normalizeLayout(JSON.parse(raw)));
    } catch {}
  }, []);

  // 폴더 펼침 상태 — localStorage에서 복원하고, 현재 페이지 속한 폴더는 강제로 열기.
  useEffect(() => {
    let initial: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          initial = stored as Record<string, boolean>;
        }
      }
    } catch {}
    for (const id of layout.folderOrder) {
      if ((layout.folderChildren[id] ?? []).includes(pathname)) initial[id] = true;
    }
    setExpanded(initial);
  }, [pathname, layout]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const persistLayout = (next: Layout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch {}
  };

  const resetLayout = () => {
    persistLayout(DEFAULT_LAYOUT);
    const initial = defaultExpanded(pathname, DEFAULT_LAYOUT);
    setExpanded(initial);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch {}
  };

  const handleDrop = (target: DropTarget) => {
    const src = drag;
    setDrag(null);
    setDropTarget(null);
    if (!src) return;

    if (src.kind === "folder" && target.kind === "folder-before") {
      if (src.id === target.id) return;
      const next: Layout = { folderOrder: [...layout.folderOrder], folderChildren: { ...layout.folderChildren } };
      next.folderOrder.splice(next.folderOrder.indexOf(src.id), 1);
      next.folderOrder.splice(next.folderOrder.indexOf(target.id), 0, src.id);
      persistLayout(next);
      return;
    }

    if (src.kind === "leaf") {
      // find source folder
      let srcFolder: string | null = null;
      for (const id of layout.folderOrder) {
        if ((layout.folderChildren[id] ?? []).includes(src.href)) { srcFolder = id; break; }
      }
      if (!srcFolder) return;
      const next: Layout = {
        folderOrder: [...layout.folderOrder],
        folderChildren: Object.fromEntries(layout.folderOrder.map((id) => [id, [...layout.folderChildren[id]]])),
      };
      const srcArr = next.folderChildren[srcFolder];
      srcArr.splice(srcArr.indexOf(src.href), 1);

      if (target.kind === "leaf-before") {
        if (target.href === src.href) return;
        let tgtFolder: string | null = null;
        for (const id of next.folderOrder) {
          if (next.folderChildren[id].includes(target.href)) { tgtFolder = id; break; }
        }
        if (!tgtFolder) return;
        const tgtArr = next.folderChildren[tgtFolder];
        tgtArr.splice(tgtArr.indexOf(target.href), 0, src.href);
      } else if (target.kind === "folder-append") {
        next.folderChildren[target.id].push(src.href);
        // ensure target folder opens so user sees the result
        setExpanded((p) => {
          const e = { ...p, [target.id]: true };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); } catch {}
          return e;
        });
      } else {
        // folder-before for leaf drag = insert as first child of that folder
        next.folderChildren[target.id].unshift(src.href);
        setExpanded((p) => {
          const e = { ...p, [target.id]: true };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); } catch {}
          return e;
        });
      }
      persistLayout(next);
    }
  };

  const isDropTarget = (t: DropTarget): boolean => {
    if (!dropTarget || !drag) return false;
    if (drag.kind === "folder" && t.kind !== "folder-before") return false;
    if (drag.kind === "leaf" && t.kind === "folder-before" && false) return false;
    if (dropTarget.kind !== t.kind) return false;
    if (dropTarget.kind === "leaf-before" && t.kind === "leaf-before") return dropTarget.href === t.href;
    if (dropTarget.kind === "folder-before" && t.kind === "folder-before") return dropTarget.id === t.id;
    if (dropTarget.kind === "folder-append" && t.kind === "folder-append") return dropTarget.id === t.id;
    return false;
  };

  const renderLeaf = (item: NavItem) => {
    const active = pathname === item.href;
    const dragging = drag?.kind === "leaf" && drag.href === item.href;
    const isOver = isDropTarget({ kind: "leaf-before", href: item.href });
    const badge = (() => {
      const n = counts[item.href];
      if (typeof n === "number") {
        if (n === 0) return <span className="text-[10px] text-zinc-700 font-mono">·</span>;
        const hot = HOT_HREFS.has(item.href);
        return <span className={`text-[10px] font-mono font-semibold ${hot ? "text-rose-300" : "text-sky-300"}`}>{n}</span>;
      }
      return <span className="text-[10px] text-zinc-600 font-mono">{item.hint}</span>;
    })();
    const cls = `flex items-center gap-2 pl-3 pr-2.5 py-1 rounded-lg text-[13px] transition min-w-0 overflow-hidden cursor-grab active:cursor-grabbing ${
      active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
    } ${dragging ? "opacity-40" : ""} ${isOver ? "ring-1 ring-sky-400" : ""}`;
    const dragProps = {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDrag({ kind: "leaf" as const, href: item.href });
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: React.DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "leaf-before", href: item.href });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        handleDrop({ kind: "leaf-before", href: item.href });
      },
      onDragEnd: () => { setDrag(null); setDropTarget(null); },
    };
    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={cls} {...dragProps}>
          <span className="text-base shrink-0">{item.emoji}</span>
          <span className="flex-1 min-w-0 truncate">{item.label}</span>
          {badge}
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href} className={cls} {...dragProps}>
        <span className="text-base shrink-0">{item.emoji}</span>
        <span className="flex-1 min-w-0 truncate">{item.label}</span>
        {badge}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile hamburger — visible only on small screens */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 w-9 h-9 rounded-lg bg-zinc-900/90 border border-zinc-700 text-zinc-200 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700"
        aria-label="메뉴 열기"
      >
        ☰
      </button>

      {/* Backdrop on mobile when open */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="닫기"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
        />
      )}

      <aside onClick={(ev) => { const t = ev.target as HTMLElement; if (t.closest("a")) setMobileOpen(false); }} className={`fixed inset-y-0 left-0 w-56 bg-zinc-900/95 lg:bg-zinc-900/80 border-r border-zinc-800 px-4 py-6 flex flex-col z-50 transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
      <Link href="/" className="mb-2 block hover:opacity-80 transition">
        <p className="text-[10px] uppercase tracking-widest text-rose-400/60">NECTAR</p>
        <h1 className="text-lg font-semibold leading-tight text-rose-100">🍷 넥타</h1>
      </Link>
      {now && (() => {
        const { week, range } = isoWeekKst(now);
        const scheduleActive = pathname === "/schedule";
        return (
          <div className="mb-3">
            <Link
              href="/weekly"
              className="block px-2.5 py-2 rounded-lg bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition"
              title="주간 목표 — /weekly 페이지로"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] uppercase tracking-widest text-zinc-500">week</span>
                <span className="text-base font-mono font-semibold text-rose-300">{week}</span>
                <span className="text-[11px] text-zinc-500">주차</span>
              </div>
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{range}</p>
            </Link>
          </div>
        );
      })()}
      <nav className="space-y-0.5 flex-1 min-h-0 overflow-y-auto">
        {layout.folderOrder.map((groupId) => {
          const group = NAV_TREE.find((g) => g.id === groupId);
          if (!group) return null;
          const childHrefs = layout.folderChildren[groupId] ?? [];
          const children = childHrefs.map((h) => LEAF_BY_HREF[h]).filter(Boolean) as NavItem[];
          const isOpen = !!expanded[groupId];
          const hotSum = children.reduce((s, c) => {
            const n = counts[c.href];
            if (typeof n !== "number" || n === 0) return s;
            return s + (HOT_HREFS.has(c.href) ? n : 0);
          }, 0);
          const childActive = children.some((c) => c.href === pathname);
          const headerDragging = drag?.kind === "folder" && drag.id === groupId;
          const headerOverFolder = isDropTarget({ kind: "folder-before", id: groupId });
          const bodyOverAppend = isDropTarget({ kind: "folder-append", id: groupId });
          return (
            <div key={groupId} className="select-none">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  setDrag({ kind: "folder", id: groupId });
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (drag.kind === "folder") setDropTarget({ kind: "folder-before", id: groupId });
                  else setDropTarget({ kind: "folder-append", id: groupId });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!drag) return;
                  if (drag.kind === "folder") handleDrop({ kind: "folder-before", id: groupId });
                  else handleDrop({ kind: "folder-append", id: groupId });
                }}
                onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                onClick={() => toggleGroup(groupId)}
                className={`w-full flex items-center gap-1.5 pl-0.5 pr-2 py-1.5 rounded-lg text-[15px] transition cursor-grab active:cursor-grabbing ${
                  childActive ? "text-zinc-50" : "text-zinc-200 hover:bg-zinc-800/40 hover:text-zinc-100"
                } ${headerDragging ? "opacity-40" : ""} ${headerOverFolder ? "ring-1 ring-sky-400" : ""} ${bodyOverAppend && !isOpen ? "ring-1 ring-emerald-400" : ""}`}
              >
                <span className="text-[10px] text-zinc-500 w-3 inline-block">{isOpen ? "▾" : "▸"}</span>
                <span className="text-base shrink-0">{group.emoji}</span>
                <span className="flex-1 min-w-0 truncate text-left font-medium">{group.label}</span>
                {hotSum > 0 && (
                  <span className="text-[10px] font-mono font-semibold text-rose-300">{hotSum}</span>
                )}
              </button>
              {isOpen && (
                <div
                  className={`mt-0.5 mb-1.5 ml-5 pl-1 border-l border-zinc-800 space-y-px rounded-r ${bodyOverAppend ? "ring-1 ring-emerald-400" : ""}`}
                  onDragOver={(e) => {
                    if (!drag || drag.kind !== "leaf") return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropTarget({ kind: "folder-append", id: groupId });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!drag || drag.kind !== "leaf") return;
                    handleDrop({ kind: "folder-append", id: groupId });
                  }}
                >
                  {children.map(renderLeaf)}
                  {children.length === 0 && (
                    <div className="pl-3 py-1 text-[10px] text-zinc-600 italic">비어있음 — 드래그해서 이동</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-3 pt-3 border-t border-zinc-800 text-[11px] text-zinc-600 space-y-2">
        {now && (
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-600">KST</p>
            <p className="text-sm font-mono text-zinc-300 mt-0.5">
              {now.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {now.toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "2-digit",
                day: "2-digit",
                weekday: "short",
              })}
              {todayCount !== null && (
                <Link
                  href="/calendar"
                  className="ml-2 text-zinc-400 hover:text-zinc-100 underline-offset-2 hover:underline"
                >
                  · 오늘 {todayCount}개
                </Link>
              )}
              {overdueCount !== null && overdueCount > 0 && (
                <Link
                  href="/todos"
                  className="ml-2 text-rose-300 hover:text-rose-100 underline-offset-2 hover:underline"
                  title="컨택 미루어진 인맥 (todos 페이지 하단 리스트)"
                >
                  · ⚑ 인맥 {overdueCount}
                </Link>
              )}
                          </p>
          </div>
        )}
        {nextEvent && now && (
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-600">next</p>
            <p className="text-xs text-zinc-300 mt-0.5 truncate" title={nextEvent.title}>
              {nextEvent.title}
            </p>
            <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
              {(() => {
                const start = parseDateLocal(nextEvent.start);
                const diffMin = Math.round((start.getTime() - now.getTime()) / 60000);
                if (diffMin < 0) return "진행 중";
                if (diffMin < 60) return `${diffMin}분 뒤`;
                if (diffMin < 60 * 24)
                  return `${Math.floor(diffMin / 60)}시간 ${diffMin % 60}분 뒤`;
                const days = Math.floor(diffMin / (60 * 24));
                return `${days}일 뒤`;
              })()}
              {!nextEvent.allDay &&
                ' · ' +
                  parseDateLocal(nextEvent.start).toLocaleTimeString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between text-[9px] text-zinc-700 font-mono">
          
          <button
            type="button"
            onClick={resetLayout}
            className="hover:text-zinc-400"
            title="폴더 순서·내부 항목 순서 초기화"
          >↺</button>
        </div>
      </div>
    </aside>
    </>
  );
}
