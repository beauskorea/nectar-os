#!/usr/bin/env python3
"""
cleanup_mail_images.py — mail-images/ 디스크 정리.

정책 (기본):
  - 60일 이상 된 메시지의 디렉토리 삭제
  - DB에 메시지 자체가 없는 orphan 디렉토리도 삭제
  - 5MB 이상 단일 파일도 60일 이후 자동 삭제 (이미지는 5MB cap이지만 PDF 등 큰 첨부)

매일 04:30 KST 크론 실행. --dry 옵션으로 시뮬레이션.
"""
import os, sys, sqlite3, shutil, re, time
from datetime import datetime, timezone, timedelta

DB = "/root/jinho-playground/data/ceo_mail.db"
DIR = "/root/jinho-playground/public/mail-images"
KEEP_DAYS = 60

def _safe_dir_name(s):
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s)[:80]

def main():
    dry = "--dry" in sys.argv

    if not os.path.isdir(DIR):
        print(f"[cleanup] no dir: {DIR}"); return

    cutoff = int((datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).timestamp())

    # DB에서 KEEP_DAYS 이내 메시지의 dir name 모음
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT message_id FROM messages WHERE date_ts >= ?",
        (cutoff,),
    ).fetchall()
    conn.close()
    keep = set(_safe_dir_name(r[0]) for r in rows)

    total = 0
    bytes_freed = 0
    deleted = 0
    kept = 0
    for name in os.listdir(DIR):
        path = os.path.join(DIR, name)
        if not os.path.isdir(path): continue
        total += 1
        if name in keep:
            kept += 1
            continue
        # 삭제 대상
        try:
            for root, _, files in os.walk(path):
                for f in files:
                    try: bytes_freed += os.path.getsize(os.path.join(root, f))
                    except OSError: pass
            if not dry:
                shutil.rmtree(path)
            deleted += 1
        except Exception as e:
            print(f"[cleanup] err {name}: {e}", file=sys.stderr)

    mb = bytes_freed / 1024 / 1024
    mode = "DRY" if dry else "DONE"
    print(f"[cleanup] {mode} total={total} kept={kept} deleted={deleted} freed={mb:.1f}MB (KEEP_DAYS={KEEP_DAYS})")

if __name__ == "__main__":
    main()
