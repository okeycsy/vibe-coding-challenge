import { INSTITUTIONS, TEST_RESULTS, guessInstitutionType } from '../data/mockData';

// 기관 목록과 매칭 규칙. 엑셀 업로드(upload.js)·AI 이슈 인식(fee.js)·산출이 모두 이 목록을 읽으므로
// 기관 관리에서 바꾸면 다음 업로드·산출부터 바로 반영된다.
// 서버가 있으면 서버 기관 목록으로 INSTITUTIONS 를 그 자리에서 바꿔 이름 표시 등이 서버와 같게 한다.
// 검증·매칭 규칙은 서버 InstitutionManagementService / FeeExcelService.matchInstitution / AiIssueParser 와 같다.

export const INSTITUTION_TYPES = [
  { value: 'BANK', label: '은행' },
  { value: 'SECURITIES', label: '증권' },
  { value: 'INSURANCE', label: '보험' },
  { value: 'OTHER', label: '기타' },
];
export const typeLabel = (type) => INSTITUTION_TYPES.find((t) => t.value === type)?.label ?? '기타';

export const activeInstitutions = () => INSTITUTIONS.filter((i) => i.active !== false);

// 문장에 들어 있는 이름·별칭 중 가장 긴 것 ('하나온은행'이 '하나'(하나은행)로 잡히지 않도록). 사용 중인 기관만
export function longestMatch(text) {
  let best = null;
  activeInstitutions().forEach((inst) => {
    const alias = [inst.name, ...inst.aliases].find((a) => text.includes(a));
    if (alias && (!best || alias.length > best.alias.length)) best = { inst, alias };
  });
  return best;
}

const squash = (v) => String(v ?? '').replace(/\s/g, '');

// 엑셀 기관 칸 값 → { inst, matchedBy }. 기관코드·내부 ID(대소문자 무시)·기관명이 같으면 그 기관, 아니면 가장 길게 맞는 이름·별칭
export function matchExcelValue(value) {
  const v = squash(value);
  const lower = v.toLowerCase();
  for (const i of activeInstitutions()) {
    if (lower === i.code.toLowerCase()) return { inst: i, matchedBy: '기관코드' };
    if (lower === i.id.toLowerCase()) return { inst: i, matchedBy: '내부 ID' };
    if (v === i.name) return { inst: i, matchedBy: '기관명' };
  }
  const m = longestMatch(v);
  return m ? { inst: m.inst, matchedBy: m.alias } : null;
}

// 서버 응답(InstitutionResponse·InstitutionAdminResponse) → 화면 기관 형태. uploadOnly 는 기존 test 표시와 같은 뜻
const fromServer = (i) => ({
  id: i.id,
  name: i.name,
  code: i.code,
  aliases: [...(i.aliases ?? [])],
  type: i.type ?? guessInstitutionType(i.name),
  active: i.active !== false,
  test: !!i.uploadOnly,
  updatedAt: i.updatedAt,
  updatedBy: i.updatedBy,
});

// 배열을 새로 만들지 않고 내용만 바꾼다 (INSTITUTIONS 를 import 한 모든 곳이 같은 목록을 보도록)
export function replaceInstitutions(list) {
  INSTITUTIONS.splice(0, INSTITUTIONS.length, ...list.map(fromServer));
}

export class InstitutionError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const ID_RE = /^[a-z][a-z0-9_-]{1,29}$/;
const CODE_RE = /^[A-Z0-9]{2,10}$/;
const MAX_ALIASES = 10;

// 추가·수정 검증 (서버와 같은 규칙·순서). selfId 가 있으면 수정. 겹침은 사용 중지 기관까지 본다(다시 사용할 때 겹치지 않도록).
// 통과하면 저장할 값 { id, name, code, type, aliases }, 아니면 InstitutionError(field, message)
export function validateInstitution(form, selfId = null, all = INSTITUTIONS) {
  const name = (form.name ?? '').trim();
  const code = (form.code ?? '').trim().toUpperCase();
  const id = selfId ?? ((form.id ?? '').trim().toLowerCase() || code.toLowerCase());
  if (!selfId && !ID_RE.test(id)) {
    throw new InstitutionError('id', '내부 ID는 영문 소문자로 시작하고 소문자·숫자·_·- 2~30자로 입력해 주세요.');
  }
  if (!name || name.length > 50) throw new InstitutionError('name', '기관명을 1~50자로 입력해 주세요.');
  if (/\s/.test(name)) throw new InstitutionError('name', '기관명에는 공백을 넣을 수 없습니다. (엑셀 매칭은 공백을 지우고 비교합니다)');
  if (!CODE_RE.test(code)) throw new InstitutionError('code', '기관코드는 영문 대문자·숫자 2~10자로 입력해 주세요. (예: B088)');
  const aliases = [];
  for (const raw of form.aliases ?? []) {
    const a = String(raw ?? '').trim();
    if (!a) continue;
    if (a.length > 30 || /\s/.test(a)) throw new InstitutionError('aliases', `별칭은 공백 없이 30자 이하로 입력해 주세요: ${a}`);
    if (a === name) throw new InstitutionError('aliases', `기관명과 같은 별칭은 넣지 않아도 됩니다: ${a}`);
    if (!aliases.includes(a)) aliases.push(a);
  }
  if (aliases.length > MAX_ALIASES) throw new InstitutionError('aliases', `별칭은 ${MAX_ALIASES}개까지 넣을 수 있습니다.`);

  for (const o of all) {
    if (o.id === selfId) continue;
    const label = `${o.name}(${o.code}${o.active === false ? ', 사용 중지' : ''})`;
    const keys = [o.id.toLowerCase(), o.code.toLowerCase()];
    if (keys.includes(code.toLowerCase())) throw new InstitutionError('code', `기관코드 ${code}는 ${label}의 기관코드·ID와 겹칩니다.`);
    if (!selfId && keys.includes(id)) throw new InstitutionError('id', `내부 ID ${id}는 ${label}의 ID·기관코드와 겹칩니다.`);
    const words = [o.name, ...o.aliases];
    if (words.includes(name)) throw new InstitutionError('name', `기관명 ${name}은(는) ${label}의 이름·별칭과 겹칩니다.`);
    const clash = aliases.find((a) => words.includes(a) || keys.includes(a.toLowerCase()));
    if (clash) throw new InstitutionError('aliases', `별칭 ${clash}은(는) ${label}의 이름·별칭·코드와 겹칩니다.`);
  }
  const type = INSTITUTION_TYPES.some((t) => t.value === form.type) ? form.type : guessInstitutionType(name);
  return { id, name, code, type, aliases };
}

// ── 서버가 없을 때(Mock) 기관 관리. 서버 API 와 같은 응답 모양을 돌려준다 ──

// 사용 현황: 산출 이력(이번 접속에서 산출한 결과), 대사(산출 결과 행), 테스트 결과, 연결 회원
function usageOf(id, { runs, members }) {
  const runList = Object.values(runs ?? {});
  const calculationCount = runList.filter((r) => r.rows?.some((row) => row.institutionId === id)).length;
  const reconcileCount = runList.reduce((s, r) => s + (r.rows?.filter((row) => row.institutionId === id).length ?? 0), 0);
  const testCount = TEST_RESULTS.filter((t) => t.institutionId === id).length;
  const memberCount = (members ?? []).filter((m) => m.institutionId === id).length;
  return {
    calculationCount,
    reconcileCount,
    testCount,
    memberCount,
    deletable: !calculationCount && !reconcileCount && !testCount && !memberCount,
  };
}

const adminRow = (i, ctx, sortOrder) => ({
  ...i,
  aliases: [...i.aliases],
  type: i.type,
  typeLabel: typeLabel(i.type),
  active: i.active !== false,
  uploadOnly: !!i.test,
  sortOrder,
  ...usageOf(i.id, ctx),
});

const nowLabel = () => new Date().toISOString().slice(0, 16);

export const localInstitutions = {
  list: (ctx) => INSTITUTIONS.map((i, idx) => adminRow(i, ctx, idx + 1)),

  create(form, by, ctx) {
    const v = validateInstitution(form);
    // 새 기관은 시연용 예시 실적이 없어 업로드한 실적 파일에 있을 때만 산출 대상 (서버 가중치 0 과 같음)
    const inst = { ...v, active: true, test: true, updatedAt: nowLabel(), updatedBy: by };
    INSTITUTIONS.push(inst);
    return adminRow(inst, ctx, INSTITUTIONS.length);
  },

  update(id, form, by, ctx) {
    const inst = INSTITUTIONS.find((i) => i.id === id);
    if (!inst) throw new InstitutionError(null, '기관을 찾을 수 없습니다.');
    const v = validateInstitution(form, id);
    Object.assign(inst, { name: v.name, code: v.code, type: v.type, aliases: v.aliases, updatedAt: nowLabel(), updatedBy: by });
    return adminRow(inst, ctx, INSTITUTIONS.indexOf(inst) + 1);
  },

  setActive(id, active, by, ctx) {
    const inst = INSTITUTIONS.find((i) => i.id === id);
    if (!inst) throw new InstitutionError(null, '기관을 찾을 수 없습니다.');
    Object.assign(inst, { active, updatedAt: nowLabel(), updatedBy: by });
    return adminRow(inst, ctx, INSTITUTIONS.indexOf(inst) + 1);
  },

  remove(id, ctx) {
    const idx = INSTITUTIONS.findIndex((i) => i.id === id);
    if (idx < 0) throw new InstitutionError(null, '기관을 찾을 수 없습니다.');
    const inst = INSTITUTIONS[idx];
    const u = usageOf(id, ctx);
    if (!u.deletable) {
      throw new InstitutionError(
        null,
        `${inst.name}은(는) 산출 이력 ${u.calculationCount}건·대사 ${u.reconcileCount}건·테스트 결과 ${u.testCount}건·연결 회원 ${u.memberCount}명이 있어 삭제할 수 없습니다. 사용 중지로 바꿔 주세요.`,
      );
    }
    INSTITUTIONS.splice(idx, 1);
    return inst;
  },
};
