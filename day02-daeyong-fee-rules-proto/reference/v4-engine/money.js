// 금액 계산 도구. 모든 금액은 원 단위 정수이고, 나눗셈은 BigInt로 정확하게 한다(부동소수점 오차 없음).

export const ROUNDING = {
  floor: '내림',
  round: '반올림',
  ceil: '올림',
};

const big = (n) => (typeof n === 'bigint' ? n : BigInt(n));

// num / den 을 mode(floor | round | ceil)로 정수화. den > 0. 음수도 수학적 정의대로 처리.
export function divRound(num, den, mode = 'floor') {
  const n = big(num);
  const d = big(den);
  if (d <= 0n) throw new Error('나누는 수는 0보다 커야 합니다.');
  let q = n / d; // 0 방향으로 버림
  const r = n % d;
  if (r !== 0n && n < 0n) q -= 1n; // 내림으로 맞춤
  const rem = n - q * d; // 0 <= rem < d
  if (mode === 'floor' || rem === 0n) return q;
  if (mode === 'ceil') return q + 1n;
  if (mode === 'round') return rem * 2n >= d ? q + 1n : q; // 0.5 이상 올림
  throw new Error(`알 수 없는 원 단위 처리 방식: ${mode}`);
}

// num / den 을 소수 digits 자리까지 잘라 문자열로 (표시용, 정확한 값)
export function fraction(num, den, digits = 4) {
  const n = big(num);
  const d = big(den);
  const neg = n < 0n !== d < 0n && n !== 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const scale = 10n ** BigInt(digits);
  const scaled = (an * scale) / ad;
  const int = scaled / scale;
  const frac = (scaled % scale).toString().padStart(digits, '0');
  const intStr = int.toLocaleString('ko-KR');
  return `${neg ? '-' : ''}${intStr}${digits ? `.${frac}` : ''}`;
}

// 비율(%) 문자열: num/den × 100
export const percent = (num, den, digits = 4) => (big(den) === 0n ? '-' : `${fraction(big(num) * 100n, den, digits)}%`);

// 나누어떨어지는지
export const divisible = (num, den) => big(num) % big(den) === 0n;

export const toNumber = (b) => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new Error('금액이 너무 큽니다.');
  return n;
};

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
export const num = (n) => Number(n).toLocaleString('ko-KR');
export const signedWon = (n) => (n > 0 ? `+${won(n)}` : won(n));

// 비율은 소수 둘째 자리까지 허용하므로 bp(1/100 %) 정수로 다룬다. 25 → 2500, 12.34 → 1234
export function percentToBp(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}
export const bpToPercent = (bp) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, ''));
