#!/usr/bin/env python3
'''매시간 노이즈 인맥 자동 archive.

규칙 (cumulative):
- kind in (ceo, exec) AND lastContactTs 없음 → archive
- 이름 노이즈 (20자 초과 / 괄호 / 한영 섞임 / 너무 짧음) → archive
- matchKeywords 일반명사 제거
'''
import json, re, time
from pathlib import Path

SRC = Path('/root/jinho-playground/src/data/people.json')
PUB = Path('/root/jinho-playground/public/people.json')
ARCH = Path('/root/jinho-playground/data/people_archive.json')


SELF_EMAILS = {'ceo@beaus.co.kr','beautysketchkorea@gmail.com','beauscontents@gmail.com'}
SELF_NAMES = {'박진호','진호','Jinho Park','Jinho','jinho'}
Y2026_CUTOFF = 1767193200  # 2026-01-01 KST
STALE_DAYS = 9999  # disabled - now using Y2026 cutoff  # 6개월 이전 lastContact는 클리어 (잘못된 매칭 가능성 높음)
GENERIC_KW = {
    '프로','광고','담당','팀장','매니저','대리','과장','부장','차장','본부장','이사','상무','전무','대표','사장','회장',
    'leader','manager','director','staff','team','head','lead',
    '회사','미팅','회의','업무','협력','협업','마케팅','영업','콘텐츠','크리에이터','PR','PD',
    '안녕','감사','확인','전달','발송','요청','문의','답변','보고','관련','참고','진행','검토',
}


def is_self(p):
    if (p.get('name') or '').strip() in SELF_NAMES: return True
    for e in (p.get('matchEmails') or []):
        if (e or '').strip().lower() in SELF_EMAILS: return True
    return False
def is_noise_name(name):
    if not name: return True
    if len(name) > 20: return True
    if '(' in name or ')' in name: return True
    has_kor = bool(re.search(r'[가-힣]', name))
    has_eng = bool(re.search(r'[A-Za-z]{2,}', name))
    if has_kor and has_eng: return True
    if len(name.replace(' ','')) < 2: return True
    return False

def main():
    d = json.loads(SRC.read_text(encoding='utf-8'))
    if ARCH.exists():
        arch = json.loads(ARCH.read_text(encoding='utf-8'))
    else:
        arch = {'updatedAt': int(time.time()), 'people': []}

    arch_names = {p['name'] for p in arch.get('people',[])}
    new_arch = []
    keep = []
    for p in d['people']:
        # rule 1: noisy name
        if is_noise_name(p['name']):
            if p['name'] not in arch_names: new_arch.append(p)
            continue
        # rule 0: 본인 메일/이름 → archive
        if is_self(p):
            if p['name'] not in arch_names: new_arch.append(p)
            continue
        # rule 2: ceo/exec with no contact
        if p.get('kind') in ('ceo','exec') and not p.get('lastContactTs'):
            if p['name'] not in arch_names: new_arch.append(p)
            continue
        # rule 2b: STALE lastContact (>180d) → clear (잘못된 매칭 가능성 ↑)
        import time as _t
        if p.get('lastContactTs') and p['lastContactTs'] < Y2026_CUTOFF:
            p['lastContact']=''; p['lastContactTs']=0; p['lastContactSource']=''; p['overdue']=True
        # rule 3: clean matchKeywords generic words
        kws = p.get('matchKeywords') or []
        new_kws = [k for k in kws if k and k.strip().lower() not in GENERIC_KW and len(k.strip()) >= 2]
        if not new_kws: new_kws = [p['name']]
        # 단일 2글자 한글 매칭 키워드만 있고 lastContact 소스가 kw 매칭이면 false positive 위험 → 클리어
        if len(new_kws) == 1 and len(new_kws[0]) <= 2 and re.fullmatch(r'[가-힣]{2}', new_kws[0]):
            src = p.get('lastContactSource','')
            if 'kw:' in src:
                p['lastContact']=''; p['lastContactTs']=0; p['lastContactSource']=''; p['overdue']=True
        if len(new_kws) != len(kws):
            src = p.get('lastContactSource','')
            m = re.search(r'kw:([^\)]+)', src)
            if m and m.group(1).strip().lower() in GENERIC_KW:
                p['lastContact']=''; p['lastContactTs']=0; p['lastContactSource']=''; p['overdue']=True
        p['matchKeywords'] = new_kws
        keep.append(p)

    print(f'[auto_archive] archived: {len(new_arch)} | keep: {len(keep)}')
    if new_arch:
        arch['people'].extend(new_arch)
        arch['updatedAt'] = int(time.time())
        ARCH.write_text(json.dumps(arch, ensure_ascii=False, indent=2), encoding='utf-8')

    d['people'] = keep
    d['updatedAt'] = int(time.time())
    out = json.dumps(d, ensure_ascii=False, indent=2)
    SRC.write_text(out, encoding='utf-8')
    PUB.write_text(out, encoding='utf-8')

if __name__ == '__main__':
    main()
