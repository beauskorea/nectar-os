#!/usr/bin/env python3
"""
notify_overdue.py — /people overdue 명단을 result 채널로 push
- 매주 월 9시 cron 실행
- 카테고리별 그룹, freqDays 초과만
"""
import json, subprocess, time
from collections import defaultdict
from datetime import datetime

PATH = "/root/jinho-playground/src/data/people.json"
KIND_LABEL = {
    "internal":"내부", "friend":"친구", "mentor":"멘토", "client":"클라이언트",
    "brand":"브랜드", "ceo":"대표", "exec":"임원", "vc":"투자자",
    "lawyer":"변호사", "press":"기자", "analyst":"애널리스트", "creator":"크리에이터",
}
KIND_ORDER = ["internal","mentor","client","vc","lawyer","ceo","exec","brand","press","analyst","creator","friend"]
SKIP_KINDS = {"brand"}  # 브랜드 엔티티는 overdue 알림 제외
SILENT_FREQ_DAYS = 365  # freqDays >= 365 인 사람(연 1회/2년 1회 명함)은 알림 제외

def main():
    now = int(time.time())
    d = json.load(open(PATH, encoding="utf-8"))
    by_kind = defaultdict(list)
    for p in d["people"]:
        if p.get("kind") in SKIP_KINDS: continue
        freq = p.get("freqDays", 60)
        if freq >= SILENT_FREQ_DAYS: continue
        ts = p.get("lastContactTs", 0)
        if ts == 0:
            days = None  # 기록 없음
        else:
            days = (now - ts) // 86400
            if days <= freq: continue  # not overdue
        by_kind[p["kind"]].append((p["name"], days, freq, p.get("role","")))

    total = sum(len(v) for v in by_kind.values())
    if total == 0:
        msg = "✅ 이번 주 overdue 없음"
    else:
        lines = [f"📋 *주간 인맥 overdue 리포트* ({datetime.now():%Y-%m-%d})",
                 f"총 {total}명 — 안부/컨택 권장\n"]
        for k in KIND_ORDER:
            rows = by_kind.get(k, [])
            if not rows: continue
            rows.sort(key=lambda x: (x[1] is None, -(x[1] or 0)))
            lines.append(f"*[{KIND_LABEL.get(k,k)}] {len(rows)}명*")
            for name, days, freq, role in rows[:8]:
                if days is None:
                    tag = "기록없음"
                else:
                    tag = f"{days}일 전"
                role_short = role[:25] + "…" if len(role) > 25 else role
                lines.append(f"  • {name} ({tag}) — {role_short}")
            if len(rows) > 8:
                lines.append(f"  …외 {len(rows)-8}명")
            lines.append("")
        lines.append("🔗 http://100.71.196.83:3740/people")
        msg = "\n".join(lines)

    subprocess.run(["beaus-send", "result", msg, "--parse-mode", "Markdown"], check=True)
    print("sent:", total, "overdue")

if __name__ == "__main__":
    main()
