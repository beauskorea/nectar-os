#!/usr/bin/env python3
"""
makeup.json 인제스트 스크립트.

사용:
    python3 scripts/ingest_makeup.py <file.json>
    python3 scripts/ingest_makeup.py <file.csv>
    python3 scripts/ingest_makeup.py <file.csv> --dry-run

병합 규칙:
- shop: name 매칭, 명시된 필드만 덮어쓰기
- artist: instagram 핸들 우선 매칭, 없으면 (name+shop)으로 매칭, 없으면 신규
- 빈 string ""은 무시 (기존 값 유지)
- 인제스트 후 src/data/makeup.json + public/makeup.json 동기화
"""
import sys
import os
import json
import csv
import re
import time
import argparse
import urllib.parse
from pathlib import Path

ROOT = Path("/root/jinho-playground")
SRC = ROOT / "src/data/makeup.json"
PUB = ROOT / "public/makeup.json"

SHOP_FIELDS = {
    "status", "manager", "contact", "contact_alt", "email",
    "address", "note", "main_ig", "wedding_ig", "introducedBy", "briefUrl",
}
ARTIST_FIELDS = {
    "real_name", "role", "instagram", "followers", "contact",
    "email", "specialty", "history", "note", "freelancer",
}


def ig_handle(url: str) -> str:
    if not url:
        return ""
    try:
        p = urllib.parse.urlparse(url)
        return p.path.strip("/").split("/")[0]
    except Exception:
        return ""


def normalize_artist(a: dict) -> dict:
    """Drop empty strings, normalize types."""
    out = {}
    for k, v in a.items():
        if v == "" or v is None:
            continue
        if k == "followers":
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                continue
        elif k == "freelancer":
            if isinstance(v, str):
                out[k] = v.strip().lower() in ("true", "1", "yes", "y", "t")
            else:
                out[k] = bool(v)
        elif k == "history" and isinstance(v, str):
            # CSV: semicolon-separated
            items = [x.strip() for x in v.split(";") if x.strip()]
            if items:
                out[k] = items
        elif k == "instagram" and v:
            # normalize: strip query/fragment, ensure trailing slash
            h = ig_handle(v)
            if h:
                out[k] = f"https://www.instagram.com/{h}/"
            else:
                out[k] = v
        else:
            out[k] = v
    return out


def normalize_shop(s: dict) -> dict:
    out = {}
    for k, v in s.items():
        if v == "" or v is None:
            continue
        if k == "artists":
            out[k] = [normalize_artist(a) for a in (v or [])]
        else:
            out[k] = v
    return out


def find_shop(data: dict, name: str) -> dict | None:
    for s in data["shops"]:
        if s["name"] == name:
            return s
    return None


def find_artist(shop: dict, incoming: dict) -> dict | None:
    """Match by IG handle first, then (name+role)."""
    target_handle = ig_handle(incoming.get("instagram", ""))
    if target_handle:
        for a in shop.get("artists", []):
            if ig_handle(a.get("instagram", "")) == target_handle:
                return a
    target_name = incoming.get("name", "").strip()
    if not target_name:
        return None
    for a in shop.get("artists", []):
        if a.get("name", "").strip() == target_name:
            # disambiguate by role if both have it
            if incoming.get("role") and a.get("role") and incoming["role"] != a["role"]:
                continue
            return a
    return None


def merge_shop(existing: dict, incoming: dict, stats: dict) -> None:
    """Mutate `existing` shop with values from `incoming`."""
    for k, v in incoming.items():
        if k == "artists":
            continue
        if k in SHOP_FIELDS and v not in (None, "", []):
            if existing.get(k) != v:
                existing[k] = v
                stats["shop_fields_updated"] += 1
    for a_in in incoming.get("artists", []):
        existing_a = find_artist(existing, a_in)
        if existing_a:
            # update fields
            for k, v in a_in.items():
                if k == "name":
                    continue  # don't overwrite name silently
                if k in ARTIST_FIELDS and v not in (None, "", []):
                    if existing_a.get(k) != v:
                        existing_a[k] = v
                        stats["artist_fields_updated"] += 1
        else:
            existing.setdefault("artists", []).append(a_in)
            stats["artists_added"] += 1


def load_csv(path: Path) -> list[dict]:
    """Group CSV rows into shop dicts with nested artists."""
    shops: dict[str, dict] = {}
    with path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            shop_name = (row.get("shop") or "").strip()
            if not shop_name:
                continue
            if shop_name not in shops:
                shops[shop_name] = {
                    "name": shop_name,
                    "status": (row.get("shop_status") or "watching").strip() or "watching",
                    "manager": (row.get("shop_manager") or "").strip(),
                    "contact": (row.get("shop_contact") or "").strip(),
                    "address": (row.get("shop_address") or "").strip(),
                    "email": (row.get("shop_email") or "").strip(),
                    "note": (row.get("shop_note") or "").strip(),
                    "main_ig": (row.get("shop_main_ig") or "").strip(),
                    "artists": [],
                }
            artist_name = (row.get("artist_name") or "").strip()
            if artist_name:
                shops[shop_name]["artists"].append({
                    "name": artist_name,
                    "real_name": (row.get("artist_real_name") or "").strip(),
                    "role": (row.get("artist_role") or "").strip(),
                    "instagram": (row.get("artist_instagram") or "").strip(),
                    "followers": (row.get("artist_followers") or "").strip(),
                    "contact": (row.get("artist_contact") or "").strip(),
                    "email": (row.get("artist_email") or "").strip(),
                    "specialty": (row.get("artist_specialty") or "").strip(),
                    "history": (row.get("artist_history") or "").strip(),
                    "note": (row.get("artist_note") or "").strip(),
                    "freelancer": (row.get("artist_freelancer") or "").strip(),
                })
    return [normalize_shop(s) for s in shops.values()]


def load_json(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        if "shops" in raw:
            shops = raw["shops"]
        else:
            shops = [raw]  # single shop dict
    elif isinstance(raw, list):
        shops = raw
    else:
        raise ValueError(f"Unexpected JSON shape: {type(raw)}")
    return [normalize_shop(s) for s in shops]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Path to .json or .csv to ingest")
    ap.add_argument("--dry-run", action="store_true", help="Show diff, don't write")
    args = ap.parse_args()

    inpath = Path(args.input)
    if not inpath.exists():
        # try relative to data/makeup/incoming
        alt = ROOT / "data/makeup/incoming" / inpath.name
        if alt.exists():
            inpath = alt
        else:
            print(f"ERROR: file not found: {args.input}", file=sys.stderr)
            sys.exit(1)

    if inpath.suffix.lower() == ".csv":
        incoming_shops = load_csv(inpath)
    elif inpath.suffix.lower() == ".json":
        incoming_shops = load_json(inpath)
    else:
        print(f"ERROR: unsupported file type: {inpath.suffix}", file=sys.stderr)
        sys.exit(1)

    if not SRC.exists():
        data = {"updatedAt": int(time.time()), "shops": []}
    else:
        data = json.loads(SRC.read_text(encoding="utf-8"))

    stats = {
        "shops_added": 0,
        "shops_updated": 0,
        "shop_fields_updated": 0,
        "artists_added": 0,
        "artist_fields_updated": 0,
    }

    for s_in in incoming_shops:
        existing = find_shop(data, s_in["name"])
        if existing is None:
            data["shops"].append(s_in)
            stats["shops_added"] += 1
            stats["artists_added"] += len(s_in.get("artists", []))
        else:
            merge_shop(existing, s_in, stats)
            stats["shops_updated"] += 1

    print(f"=== INGEST {inpath.name} ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    if args.dry_run:
        print("\n(dry-run, not writing)")
        return

    data["updatedAt"] = int(time.time())
    SRC.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    PUB.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {SRC} and {PUB}")
    print(f"final: {len(data['shops'])} shops / {sum(len(s.get('artists', [])) for s in data['shops'])} artists")


if __name__ == "__main__":
    main()
