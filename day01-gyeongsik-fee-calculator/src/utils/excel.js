import * as XLSX from 'xlsx';

function save(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, widths }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, filename);
}

// 참가기관에 보내 실적·회비를 대사(확인)받기 위한 파일
export function downloadReconciliation({ business, year, quarter, rows, issues }) {
  const period = `${year}년 ${quarter}분기`;
  save(
    [
      {
        name: '대사내역',
        widths: [14, 12, 8, 14, 12, 16, 14, 16, 18, 10, 50],
        rows: rows.map((r) => ({
          업무: business.name,
          산출기간: period,
          기관코드: r.code,
          참가기관명: r.name,
          기본건수: r.baseCount,
          'AI 예외 차감 건수': r.deduction,
          '최종 인정 건수': r.finalCount,
          '적용 단가/분담률': r.rateLabel,
          '산출 회비(초안, 원)': r.fee,
          대사상태: r.status,
          '차감 사유': r.reasons.join(' / '),
        })),
      },
      {
        name: '산출기준',
        widths: [80],
        rows: business.summary.map((s) => ({ [`${business.name} 회비분담기준`]: s })),
      },
      {
        name: 'AI 이슈 이력',
        widths: [6, 70, 14, 12],
        rows: issues.map((i, idx) => ({
          순번: idx + 1,
          이슈내용: i.text,
          대상기관: i.parsed.institutionName,
          차감건수: i.parsed.count,
        })),
      },
    ],
    `${business.name}_${year}_${quarter}Q_참가기관대사용.xlsx`,
  );
}

// 예산회계시스템에 수입결의로 올리기 위한 파일
export function downloadRevenueResolution({ business, year, quarter, rows }) {
  const today = new Date().toISOString().slice(0, 10);
  save(
    [
      {
        name: '수입결의',
        widths: [12, 8, 28, 10, 16, 14, 36, 12],
        rows: rows.map((r) => ({
          결의일자: today,
          회계연도: year,
          수입과목: business.revenueAccount,
          거래처코드: r.code,
          거래처명: r.name,
          '수입금액(원)': r.fee,
          적요: `${year}년 ${quarter}분기 ${business.name} 회비`,
          비고: r.status === '완료' ? '대사완료' : `대사${r.status}`,
        })),
      },
    ],
    `${business.name}_${year}_${quarter}Q_수입결의.xlsx`,
  );
}
