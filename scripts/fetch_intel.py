#!/usr/bin/env python3
"""
fetch_intel.py — Mini4 email_crawler signal_report.json → 정리된 intel.json
- 브랜드/크리에이터 정량 지표 정리
- 우선순위 점수 계산 (is_client + is_target + email_count + 이벤트 mix)
"""
import json, os
from datetime import datetime, timezone

SRC = "/root/.openclaw/workspace/data/pipeline/mini_data/mini4/email_signals/signal_report.json"
OUT = "/root/jinho-playground/public/intel.json"

def score(brand):
    s = 0
    s += brand.get("email_count", 0) * 1
    if brand.get("is_client"): s += 50
    if brand.get("is_target"): s += 30
    mix = brand.get("event_type_mix") or {}
    s += mix.get("계약", 0) * 10
    s += mix.get("협찬", 0) * 5
    s += mix.get("콘텐츠제작", 0) * 3
    s += mix.get("문의", 0) * 2
    rank = brand.get("oy_best_rank")
    if isinstance(rank, int) and rank <= 50:
        s += (51 - rank)
    return s

def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    brands = []
    for b in data:
        item = {
            "id": b.get("brand_id"),
            "brand": b.get("brand"),
            "emailCount": b.get("email_count", 0),
            "isClient": bool(b.get("is_client")),
            "isTarget": bool(b.get("is_target")),
            "eventTop": b.get("event_type_top"),
            "eventMix": b.get("event_type_mix") or {},
            "oyBestRank": b.get("oy_best_rank"),
            "oyAvgRank": b.get("oy_avg_rank"),
            "oyProductCount": b.get("oy_product_count"),
            "signal": b.get("signal"),
            "topSubjects": (b.get("subjects") or [])[:3],
            "topSenders": (b.get("senders") or [])[:3],
            "score": score(b),
        }
        brands.append(item)
    brands.sort(key=lambda x: x["score"], reverse=True)

    # Aggregate creator mentions (parse from brand info if needed) — skip for v1, brand only
    out = {
        "updatedAt": int(datetime.now(timezone.utc).timestamp()),
        "brandCount": len(brands),
        "clientCount": sum(1 for b in brands if b["isClient"]),
        "targetCount": sum(1 for b in brands if b["isTarget"]),
        "brands": brands,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"[intel] brands={len(brands)} client={out['clientCount']} target={out['targetCount']} -> {OUT}")

if __name__ == "__main__":
    main()
