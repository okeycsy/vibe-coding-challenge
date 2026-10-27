# 시연용 실적 파일 복사본을 만든다. 원본은 그대로 두고, 시스템이 요구하는 '기간(년월)' 정보만 더한다.
# 사용: python3 make_demo_files.py <CD공동망 원본.xlsx> <타행환 원본.xlsx> <기업회계 원본.xlsx> <오픈뱅킹 원본.xlsx> <출력 폴더>
# 출력 폴더(기본 demo-files/)는 저장소에 넣지 않는다 (.gitignore).
import os, shutil, sys
import openpyxl
from openpyxl.styles import Font

if len(sys.argv) != 6:
    print(__doc__ or 'usage: make_demo_files.py <cd> <interbank> <fininfo> <openbanking> <out-dir>')
    sys.exit(1)
cd_src, ib_src, fi_src, ob_src, out = sys.argv[1:6]
os.makedirs(out, exist_ok=True)


def copy_sheet_with_title(path, name, title):
    """표 위에 '2026년 3분기 ○○ 이용실적' 제목 행을 넣는다 (날짜 열이 없는 파일용: 표 제목에서 분기를 읽게 한다)."""
    wb = openpyxl.load_workbook(path)
    ws = wb.worksheets[0]
    ws.insert_rows(1)
    ws['A1'] = title
    ws['A1'].font = Font(bold=True, size=13)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ws.max_column)
    wb.save(os.path.join(out, name))
    print('wrote', name, 'title=', title)


def copy_with_month_headers(path, name, year):
    """'4월'…'9월' 머리글을 '2026년 4월'…로 바꾼다 (연도가 없으면 날짜 머리글로 인식되지 않는다)."""
    wb = openpyxl.load_workbook(path)
    ws = wb.worksheets[0]
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=1, column=c).value
        if isinstance(v, str) and v.endswith('월') and v[:-1].isdigit():
            ws.cell(row=1, column=c).value = f'{year}년 {int(v[:-1])}월'
    wb.save(os.path.join(out, name))
    print('wrote', name, 'headers=', [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)])


copy_sheet_with_title(cd_src, 'CD공동망 테스트 실적.xlsx', '2026년 3분기 CD공동망 이용실적')
copy_sheet_with_title(ib_src, '타행환 테스트 실적.xlsx', '2026년 3분기 타행환 이용실적')
copy_with_month_headers(fi_src, '기업회계 테스트 실적.xlsx', 2026)
shutil.copy(ob_src, os.path.join(out, '오픈뱅킹 테스트 실적.xlsx'))
print('copied 오픈뱅킹 (원본 그대로)')
