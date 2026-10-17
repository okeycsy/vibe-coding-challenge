// 정수(BigInt) 안분. 부동소수점 오차 없이 합계가 정확히 amount가 되도록 나눈다.
//
// 1) amount를 unit 단위로 나눈 몫(units)을 가중치 비율로 내림 배분
// 2) 남은 unit은 버려진 소수부가 큰 순서(최대잔여법)로 1단위씩
// 3) unit 미만 자투리(amount % unit)는 가중치가 가장 큰 곳에
// 동률은 이름순으로 정해 결과가 매번 같다.

export function allocate(amount, entries, unit = 1n) {
  // entries: [{ key, weight: BigInt }]
  const total = entries.reduce((s, e) => s + e.weight, 0n);
  const result = new Map(entries.map((e) => [e.key, 0n]));
  if (amount === 0n || entries.length === 0) return result;
  if (total === 0n) throw new Error('가중치 합계가 0이라 안분할 수 없습니다.');

  const units = amount / unit;
  const dust = amount % unit;
  let given = 0n;
  const rem = [];
  for (const e of entries) {
    const share = (units * e.weight) / total;
    const r = (units * e.weight) % total;
    result.set(e.key, share * unit);
    given += share;
    rem.push({ key: e.key, r, weight: e.weight });
  }
  rem.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : cmpKey(a.key, b.key)));
  let left = units - given;
  for (let i = 0; left > 0n; i = (i + 1) % rem.length) {
    if (rem[i].weight === 0n) continue;
    result.set(rem[i].key, result.get(rem[i].key) + unit);
    left -= 1n;
  }
  if (dust > 0n) {
    const top = [...entries].filter((e) => e.weight > 0n)
      .sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : cmpKey(a.key, b.key)))[0];
    result.set(top.key, result.get(top.key) + dust);
  }
  return result;
}

const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 소수 가중치(0.2 등)를 정수로 바꿀 때 쓰는 배율
export const WEIGHT_SCALE = 10000;
export const toScaled = (x) => BigInt(Math.round(Number(x) * WEIGHT_SCALE));
