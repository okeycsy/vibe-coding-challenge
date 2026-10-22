// R-1.1 모든 금액은 원 단위 정수. 나눗셈은 BigInt로 하고 부동소수점은 쓰지 않는다.
// 이 파일은 공통 규칙 초안(COMMON_RULES_DRAFT.md)만 보고 새로 썼다. v4 엔진 코드는 참고하지 않았다.

export const ROUNDING_MODES = { floor: '내림', round: '반올림', ceil: '올림' };

export const B = (v) => (typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0)));
export const N = (v) => Number(v);

// 유클리드 나눗셈: 0 <= 나머지 < 나누는 수 (음수 분자도 같은 규칙)
function euclid(num, den) {
  if (den <= 0n) throw new Error('나누는 수는 0보다 커야 합니다.');
  let q = num / den;
  let r = num % den;
  if (r < 0n) {
    r += den;
    q -= 1n;
  }
  return { q, r };
}

// num ÷ den 을 mode(floor | round | ceil)로 정수화
export function divide(num, den, mode = 'floor') {
  const { q, r } = euclid(B(num), B(den));
  if (r === 0n) return q;
  switch (mode) {
    case 'floor': return q;
    case 'ceil': return q + 1n;
    case 'round': return r * 2n >= B(den) ? q + 1n : q;
    default: throw new Error(`알 수 없는 원 단위 처리 방식: ${mode}`);
  }
}

// num ÷ den 의 나머지 (0 이상)
export const remainder = (num, den) => euclid(B(num), B(den)).r;

// 금액을 unit 단위로 정수화 (예: 10원 단위 올림)
export const toUnit = (amount, unit, mode) => divide(amount, unit, mode) * B(unit);

// 비율은 bp(1/100 %)로 들고 다닌다: 25% = 2500bp
export const BP = 10000n;
export const percentToBp = (text) => {
  const t = String(text).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const [i, f = ''] = t.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
};
export const bpToPercent = (bp) => `${(Number(bp) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

// 표시용 정확한 소수 (num ÷ den 을 digits 자리까지 버림)
export function decimal(num, den, digits = 4) {
  const n = B(num);
  const d = B(den);
  if (d === 0n) return '-';
  const neg = n < 0n;
  const scale = 10n ** BigInt(digits);
  const scaled = ((neg ? -n : n) * scale) / d;
  const int = (scaled / scale).toLocaleString('ko-KR');
  const frac = (scaled % scale).toString().padStart(digits, '0');
  return `${neg ? '-' : ''}${int}${digits ? '.' + frac : ''}`;
}
export const ratioPercent = (num, den, digits = 4) => (B(den) === 0n ? '-' : `${decimal(B(num) * 100n, den, digits)}%`);

export const won = (v) => `${N(v).toLocaleString('ko-KR')}원`;
export const signed = (v) => (N(v) > 0 ? `+${won(v)}` : won(v));
export const count = (v) => `${N(v).toLocaleString('ko-KR')}건`;
