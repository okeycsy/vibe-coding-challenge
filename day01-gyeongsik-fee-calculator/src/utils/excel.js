import * as XLSX from 'xlsx';
import { periodLabel, periodTag } from './period';
import { SOURCE_LABEL } from './postprocess';

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
// skill: 산출에 쓴 기준 { summary, formula, specialRules } (산출기준 시트에 1번·3번·4번을 남긴다),
// special: 4번 후처리 실행 결과 { postprocess, source, checks, notes }
export function downloadReconciliation({ business, from, to, rows, issues, skill, special }) {
  const period = periodLabel(from, to);
  save(
    [
      {
        name: '대사내역',
        widths: [14, 30, 8, 14, 12, 16, 18, 16, 14, 14, 18, 18, 16, 50, 10, 50],
        rows: rows.map((r) => ({
          업무: business.name,
          산출기간: period,
          기관코드: r.code,
          참가기관명: r.name,
          기본건수: r.baseCount,
          'AI 예외 차감 건수': r.deduction,
          '실적(최종인정건수)': r.finalCount,
          '적용 단가/분담률': r.rateLabel,
          '균등분담분(원)': r.equalFee ?? 0,
          '실적분담분(원)': r.perfFee ?? r.fee,
          '산출 회비(총합, 원)': r.fee,
          '특이사항 보정 전(원)': r.beforeSpecialFee ?? r.fee,
          '특이사항 보정(원)': r.specialAdjustment ?? 0,
          '특이사항 보정 사유': r.specialReason ?? '',
          대사상태: r.status,
          '차감 사유': r.reasons.join(' / '),
        })),
      },
      {
        name: '산출기준',
        widths: [24, 100],
        rows: [
          ...business.summary.map((v) => ({ 항목: '1. 비즈니스 규칙 요약', 내용: v })),
          ...(skill?.formula ? [{ 항목: '3. 정산 수식(적용)', 내용: skill.formula.replace(/\s+/g, ' ') }] : []),
          ...(skill?.specialRules?.length
            ? skill.specialRules.map((v) => ({ 항목: '4. 최종 정산 특이사항', 내용: v }))
            : [{ 항목: '4. 최종 정산 특이사항', 내용: '없음' }]),
          ...(special?.source
            ? [
                { 항목: '4번 스크립트 출처', 내용: SOURCE_LABEL[special.source] ?? special.source },
                ...special.postprocess
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((v) => ({ 항목: '4번 후처리 스크립트', 내용: v })),
                ...special.checks.map((c) => ({
                  항목: '4번 검증',
                  내용: `${c.passed ? '통과' : '실패'} · ${c.label}${c.actual == null ? '' : ` (실제 ${c.actual})`}`,
                })),
                ...special.notes.map((v) => ({ 항목: '4번 참고', 내용: v })),
              ]
            : []),
        ].map((r) => ({ [`${business.name} 회비분담기준`]: r.항목, 내용: r.내용 })),
      },
      {
        name: 'AI 이슈 이력',
        widths: [6, 70, 14, 12, 10, 60],
        rows: issues.map((i, idx) => ({
          순번: idx + 1,
          이슈내용: i.text,
          대상기관: i.parsed.institutionName,
          차감건수: i.parsed.count,
          차감반영: i.applied === false ? '제외' : '반영',
          '판별 근거': i.judgement ?? '',
        })),
      },
    ],
    `${business.name}_${periodTag(from, to)}_참가기관대사용.xlsx`,
  );
}

// 예산회계시스템에 수입결의로 올리기 위한 파일
export function downloadRevenueResolution({ business, from, to, rows }) {
  const today = new Date().toISOString().slice(0, 10);
  save(
    [
      {
        name: '수입결의',
        widths: [12, 8, 28, 10, 16, 16, 14, 14, 16, 36, 12],
        rows: rows.map((r) => ({
          결의일자: today,
          회계연도: Number(to.slice(0, 4)),
          수입과목: business.revenueAccount,
          거래처코드: r.code,
          거래처명: r.name,
          '실적(최종인정건수)': r.finalCount,
          균등분담분: r.equalFee ?? 0,
          실적분담분: r.perfFee ?? r.fee,
          '수입금액(산출 회비 총합, 원)': r.fee,
          적요: `${periodLabel(from, to)} ${business.name} 회비`,
          비고: r.status === '완료' ? '대사완료' : `대사${r.status}`,
        })),
      },
    ],
    `${business.name}_${periodTag(from, to)}_수입결의.xlsx`,
  );
}

// 관리자 설정 > 기관 관리 목록 (화면에 보이는 필터 결과 그대로)
export function downloadInstitutions(rows) {
  save(
    [
      {
        name: '기관목록',
        rows: rows.map((r) => ({
          기관명: r.name,
          기관코드: r.code,
          '내부 ID': r.id,
          구분: r.typeLabel,
          별칭: r.aliases.join(', '),
          상태: r.active ? '사용' : '사용 중지',
          '시연 실적': r.uploadOnly ? '업로드 전용' : '포함',
          '산출 이력(건)': r.calculationCount,
          '대사(건)': r.reconcileCount,
          '테스트 결과(건)': r.testCount,
          '연결 회원(명)': r.memberCount,
        })),
        widths: [18, 10, 10, 6, 28, 9, 11, 12, 9, 13, 12],
      },
    ],
    `기관목록_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
