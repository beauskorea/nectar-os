"use client";
import { useEffect, useRef } from "react";

type Props = {
  value: string;       // "" = 종일, "HH:MM"
  onChange: (v: string) => void;
  className?: string;
  favorites?: string[];  // 자주 쓰는 시간 ["10:00","10:30","12:00","14:00","16:00","18:30"]
};

const DEFAULT_FAVORITES = ["10:00", "10:30", "12:00", "14:00", "16:00", "18:30"];

// 종일 + 06:00~23:30 (30분 단위)
const ALL_DAY = "종일";
function buildTimes(): string[] {
  const out = [ALL_DAY];
  for (let i = 0; i < 36; i++) {
    const h = 6 + Math.floor(i / 2);
    const m = i % 2 === 0 ? 0 : 30;
    if (h > 23) break;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}
const TIMES = buildTimes();
const ITEM_H = 28; // px

export default function TimeWheelPicker({ value, onChange, className, favorites = DEFAULT_FAVORITES }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIdx = useRef<number>(-1);

  const currentLabel = value === "" ? ALL_DAY : value;
  const currentIdx = Math.max(0, TIMES.indexOf(currentLabel));

  // Sync scroll when value changes externally
  useEffect(() => {
    if (!ref.current) return;
    const idx = Math.max(0, TIMES.indexOf(currentLabel));
    ref.current.scrollTop = idx * ITEM_H;
    lastIdx.current = idx;
  }, [currentLabel]);

  function commitFromScroll() {
    if (!ref.current) return;
    const idx = Math.round(ref.current.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(TIMES.length - 1, idx));
    if (clamped === lastIdx.current) return;
    lastIdx.current = clamped;
    const v = TIMES[clamped];
    onChange(v === ALL_DAY ? "" : v);
  }

  function onScroll() {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(commitFromScroll, 80);
  }

  return (
    <div className={`${className ?? ""}`}>
      {/* favorite chips — 자주 쓰는 시간 즉시 점프 */}
      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1 max-w-[220px]">
          {favorites.map((t) => {
            const active = t === value;
            return (
              <button
                type="button"
                key={t}
                onClick={() => onChange(t)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border transition ${
                  active
                    ? "bg-sky-700 border-sky-500 text-white"
                    : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
      <div className="relative">
      <div
        ref={ref}
        onScroll={onScroll}
        className="overflow-y-auto snap-y snap-mandatory bg-zinc-950 border border-zinc-800 rounded-lg time-wheel"
        style={{
          height: `${ITEM_H * 3}px`,
          scrollbarWidth: "none",
        }}
      >
        <style>{`
          .time-wheel::-webkit-scrollbar { display: none; }
        `}</style>
        <div style={{ height: ITEM_H }} />
        {TIMES.map((t) => (
          <div
            key={t}
            onClick={() => onChange(t === ALL_DAY ? "" : t)}
            className={`flex items-center justify-center snap-center text-xs font-mono cursor-pointer transition select-none ${
              t === currentLabel ? "text-sky-300 font-semibold" : "text-zinc-500"
            }`}
            style={{ height: ITEM_H }}
          >
            {t}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
      {/* center selection indicator */}
      <div
        className="absolute inset-x-1 top-1/2 -translate-y-1/2 pointer-events-none border-y border-sky-500/40 bg-sky-500/5 rounded"
        style={{ height: ITEM_H }}
      />
      </div>
    </div>
  );
}
