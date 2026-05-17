#!/usr/bin/env python3
"""
discover_new_people.py — 직전 7일 새 등장 인물 텔레그램 push
- 캘린더 제목에서 한글 이름 패턴 추출
- ceo_mail.db에서 from_addr 신규 후보 추출
- 기존 people.json 등록자 제외
- result 채널 push
"""
import json, sqlite3, re, subprocess, time
from collections import Counter
from datetime import datetime, timedelta, timezone

PEOPLE = "/root/jinho-playground/src/data/people.json"
EVENTS = "/root/jinho-playground/public/events.json"
MAIL_DB = "/root/jinho-playground/data/ceo_mail.db"

# 노이즈 필터
NOISE_PAT = re.compile(
    r"(유튜브|Preply|Flight|Stay|Reservation|회의|점검|마감|미용|치과|병원|예약|픽업|"
    r"청소|피티|영업|마케팅팀|일본어|미민지|test|새로운 이벤트|가스|주차|연세휴|"
    r"중성화|화장실|약속|이메일|발송|월말|월초|미팅 |회식|업무|올영|쇼핑|면담|"
    r"비행|항공|호텔|식사|저녁|점심|런치|디너|커피|상견례|상담|콜|배송|배달|"
    r"강아지|고양이|쥐|토리|꿈|생일|결혼식|장례|문상|입국|출국|귀국|여행|"
    r"노이즈|매니아|넘버원|이코노미|컨퍼런스|컨설팅|스터디|오피스|회사|바이럴|꼬다쾃|쉬는|추석|전무님|상무님)"
)
# 한글 이름 단독 (2~4자) 또는 "이름 + 직책"
NAME_PAT = re.compile(r"^([가-힣]{2,4})(?:[ \t]|$)")

def existing_signals():
    doc = json.load(open(PEOPLE, encoding="utf-8"))
    kws = set()
    emails = set()
    for p in doc["people"]:
        for k in p.get("matchKeywords", []):
            if k: kws.add(k.lower())
        # 이름 토큰
        for tok in re.split(r"[\s/(),:]+", p.get("name","")):
            if tok and len(tok) >= 2: kws.add(tok.lower())
        for e in p.get("matchEmails", []):
            if e: emails.add(e.lower())
    return kws, emails

def calendar_candidates(known_kws, days=7):
    cutoff = int(time.time()) - days*86400
    raw = json.load(open(EVENTS, encoding="utf-8"))
    evs = raw.get("events", raw) if isinstance(raw, dict) else raw
    cnt = Counter()
    for e in evs:
        title = (e.get("title") or "").strip()
        if not title: continue
        if NOISE_PAT.search(title): continue
        start = e.get("start","")
        try:
            if "T" in start:
                ts = int(datetime.fromisoformat(start.replace("Z","+00:00")).timestamp())
            else:
                ts = int(datetime.strptime(start[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
        except: continue
        if ts < cutoff: continue
        # 첫 단어가 한글 이름 패턴
        m = NAME_PAT.match(title)
        if not m: continue
        name = m.group(1)
        if name.lower() in known_kws: continue
        # 일반명사 제외 (2자만)
        if len(name) == 2 and name in {"회의","점검","외근","행사","발표","교육","결제","승인","결재","발송","배송","문서"}: continue
        cnt[name] += 1
    return cnt

def mail_candidates(known_kws, known_emails, days=7):
    cutoff = int(time.time()) - days*86400
    conn = sqlite3.connect(MAIL_DB, timeout=30)
    cur = conn.cursor()
    cur.execute(
        "SELECT from_addr, from_name, COUNT(*) FROM messages "
        "WHERE date_ts >= ? GROUP BY from_addr ORDER BY COUNT(*) DESC LIMIT 200",
        (cutoff,)
    )
    cand = []
    for addr, name, n in cur.fetchall():
        addr_l = (addr or "").lower()
        if addr_l in known_emails: continue
        if not addr_l: continue
        # 알림/뉴스레터/자동 제외
        if re.search(r"(noreply|no-reply|donotreply|notification|alert|newsletter|"
                     r"marketing|info@|noti@|news@|cs@|help@|support@|service@|"
                     r"automated|do_not_reply|reply\+|bounce|mailer|substack|"
                     r"security@|webmaster|viewsletter|themiilk|openads|"
                     r"beautynury|cmnad|bytebytego|longblack|instagram\.com|"
                     r"google\.com|facebookmail|tiktok|linkedin|youtube\.com)", addr_l): continue
        # 이미 등록된 이름인지 — 이름 토큰 단순 매칭
        name_lower = (name or "").lower()
        if name_lower and any(k in name_lower for k in known_kws if len(k)>=2): continue
        cand.append((addr, name or "", n))
    return cand

def main():
    known_kws, known_emails = existing_signals()
    cal = calendar_candidates(known_kws)
    mail = mail_candidates(known_kws, known_emails)
    
    if not cal and not mail:
        print("후보 없음")
        return
    
    lines = [f"🔍 주간 신규 인맥 후보 ({datetime.now():%Y-%m-%d})", ""]
    
    if cal:
        top_cal = cal.most_common(10)
        lines.append(f"[캘린더 신규 {len(top_cal)}건] (직전 7일)")
        for name, c in top_cal:
            lines.append(f"  • {name} ({c}회)")
        lines.append("")
    
    if mail:
        # 메일은 빈도 2 이상만
        mail_top = [m for m in mail if m[2] >= 2][:10]
        if mail_top:
            lines.append(f"[메일 신규 {len(mail_top)}건] (직전 7일, 2건+)")
            for addr, name, n in mail_top:
                disp = f"{name} <{addr}>" if name else addr
                lines.append(f"  • {disp[:60]} ({n}건)")
            lines.append("")
    
    lines.append("등록할 사람 텔레그램 답장 또는 /people 페이지에서 추가")
    lines.append("🔗 http://100.71.196.83:3740/people")
    msg = "\n".join(lines)
    
    subprocess.run(["beaus-send", "result", msg], check=True)
    print(f"sent: calendar {len(cal)} candidates, mail {len(mail)} candidates")

if __name__ == "__main__":
    main()
