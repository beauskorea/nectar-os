"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ScheduleFile = {
  sheetId: string;
  gid: string;
  updatedAt: number;
  rowCount: number;
  rows: string[][];
};

function ago(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

function periodEndTs(period: string): number {
  const m = period.match(/(\d{1,2})\/(\d{1,2})\s*[~–-]\s*(\d{1,2})\/(\d{1,2})/);
  if (!m) return 0;
  const month = parseInt(m[3], 10);
  const day = parseInt(m[4], 10);
  const now = new Date();
  const year = now.getMonth() + 1 < month ? now.getFullYear() - 1 : now.getFullYear();
  return new Date(year, month - 1, day).getTime();
}

export default function ScheduleCard() {
  const [data, setData] = useState<ScheduleFile | null>(null);

  useEffect(() => {
    fetch("/schedule.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const latest = useMemo(() => {
    if (!data) return null;
    const headerRow = data.rows[1] ?? [];
    const subHeaderRow = data.rows[3] ?? [];
    const maxCols = Math.max(...data.rows.map((r) => r.length));
    type Block = { label: string; period: string; start: number; end: number; nameCol: number; taskCol: number };
    const starts: { col: number; label: string }[] = [];
    headerRow.forEach((cell, i) => {
      if (cell && /주\s*진행업무/.test(cell)) starts.push({ col: i, label: cell.trim() });
    });
    const blocks: Block[] = [];
    starts.forEach((w, idx) => {
      const end = idx + 1 < starts.length ? starts[idx + 1].col : maxCols;
      let period = "";
      for (let c = w.col; c < end; c++) {
        const v = headerRow[c] ?? "";
        if (/기간/.test(v)) {
          period = v.replace(/^기간\s*[:：]\s*/, "").trim();
          break;
        }
      }
      let nameCol = -1, taskCol = -1;
      for (let c = w.col; c < end; c++) {
        const v = (subHeaderRow[c] ?? "").trim();
        if (v === "이름" && nameCol < 0) nameCol = c;
        else if (/진행업무$/.test(v) && taskCol < 0) taskCol = c;
      }
      if (nameCol < 0) return;
      if (taskCol < 0) taskCol = nameCol + 1;
      blocks.push({ label: w.label, period, start: w.col, end, nameCol, taskCol });
    });
    if (!blocks.length) return null;
    blocks.sort((a, b) => periodEndTs(b.period) - periodEndTs(a.period));
    const top = blocks[0];
    const teams: string[] = [];
    for (let i = 4; i < data.rows.length; i++) {
      const r = data.rows[i] ?? [];
      const name = (r[top.nameCol] ?? "").trim();
      const task = (r[top.taskCol] ?? "").trim();
      if (name && task) teams.push(name);
    }
    return {
      label: top.label.replace(" 진행업무", ""),
      period: top.period,
      teamCount: teams.length,
      teams: teams.slice(0, 4),
      moreCount: Math.max(0, teams.length - 4),
    };
  }, [data]);

  return (
    <Link
      href="/schedule"
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-600 transition"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">📋 주간 진행업무</h2>
        <span className="text-[10px] text-zinc-600 font-mono">
          {data ? `${ago(data.updatedAt)} · Sheets` : "Sheets"}
        </span>
      </div>
      {!data && <p className="text-xs text-zinc-600">로딩...</p>}
      {data && !latest && <p className="text-xs text-zinc-600">데이터 없음</p>}
      {latest && (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-zinc-100">{latest.label}</span>
            <span className="text-xs text-zinc-500">{latest.period}</span>
          </div>
          <p className="text-xs text-zinc-500">
            보고 {latest.teamCount}건
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {latest.teams.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-md bg-zinc-800/60 text-[11px] text-zinc-300"
              >
                {t}
              </span>
            ))}
            {latest.moreCount > 0 && (
              <span className="px-2 py-0.5 rounded-md text-[11px] text-zinc-500">
                +{latest.moreCount}
              </span>
            )}
          </div>
        </div>
      )}
    </Link>
  );
}
