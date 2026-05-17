"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  className?: string;
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date();
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export default function MiniDatePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(value ? parseYmd(value) : new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (value) setCursor(parseYmd(value));
  }, [value]);

  const today = ymd(new Date());
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  const display = value
    ? `${parseYmd(value).getMonth() + 1}/${parseYmd(value).getDate()}`
    : "날짜";
  const dow = value ? WEEK[parseYmd(value).getDay()] : "";

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500 hover:border-zinc-600 flex items-center gap-2 min-w-[100px]"
        title={value}
      >
        <span className="text-zinc-500">📅</span>
        <span className="text-zinc-200 font-mono">{display}</span>
        {dow && <span className="text-[10px] text-zinc-500">({dow})</span>}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-60 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2">
          <div className="flex items-center gap-1 mb-2">
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="w-6 h-6 rounded text-zinc-400 hover:bg-zinc-800"
            >
              ‹
            </button>
            <span className="text-xs font-mono text-zinc-300 flex-1 text-center">
              {cursor.getFullYear()}.{String(cursor.getMonth() + 1).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="w-6 h-6 rounded text-zinc-400 hover:bg-zinc-800"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                setCursor(t);
                onChange(ymd(t));
                setOpen(false);
              }}
              className="ml-1 text-[10px] text-zinc-500 hover:text-zinc-200 px-1 font-mono"
            >
              today
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px text-[10px] mb-1">
            {WEEK.map((w) => (
              <div key={w} className="text-zinc-600 text-center py-0.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {days.map((d, i) => {
              const k = ymd(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = k === today;
              const isSelected = k === value;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => {
                    onChange(k);
                    setOpen(false);
                  }}
                  className={`aspect-square rounded text-[11px] flex items-center justify-center transition ${
                    isSelected
                      ? "bg-sky-600 text-white"
                      : isToday
                      ? "bg-zinc-700 text-white ring-1 ring-sky-500/40"
                      : inMonth
                      ? "text-zinc-300 hover:bg-zinc-800"
                      : "text-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
