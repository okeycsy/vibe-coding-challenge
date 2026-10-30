"""녹화 전에 data/OPEN_BANKING.md(홈페이지에서 바꾼 오픈뱅킹 회비 기준)를 로컬 서버에 넣는다.

python3 load_skill.py [서버주소]   # 기본 http://localhost:8080. 저장 전 검증(수식·스크립트 시험 실행)은 서버가 한다.
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
base = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080'
content = open(os.path.join(HERE, '..', 'data', 'OPEN_BANKING.md'), encoding='utf-8').read()
req = urllib.request.Request(f'{base}/api/v1/skills/OPEN_BANKING', data=json.dumps({'content': content}).encode(), method='PUT',
                             headers={'Content-Type': 'application/json', 'X-Employee-Id': 'admin'})
try:
    print(json.load(urllib.request.urlopen(req)).get('message'))
except urllib.error.HTTPError as e:
    sys.exit(f'{e.code} {e.read().decode()[:800]}')
