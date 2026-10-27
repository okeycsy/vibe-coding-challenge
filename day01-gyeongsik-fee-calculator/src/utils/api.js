// 백엔드(Spring Boot) API 클라이언트.
// VITE_API_BASE_URL(예: https://vibe-coding-challenge.onrender.com)이 있으면 회원·로그인·업무 권한을 서버와 주고받고,
// 없으면 지금처럼 data/mockData.js 예시 데이터만으로 화면이 동작한다.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const apiEnabled = BASE !== '';
export const apiBase = BASE;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// 로그인한 사번. skill.md·산출 API는 X-Employee-Id 헤더로 권한을 확인한다.
// 아직 로그인 토큰(JWT)이 없어 서버는 이 값을 그대로 믿는다 (시연용 한계).
let employeeId = null;
export const setEmployeeId = (id) => {
  employeeId = id;
};

// 모든 응답은 { success, message, data } 형태. 실패하면 ApiError(status, message, data)를 던진다.
async function request(method, path, body) {
  let res;
  const headers = {};
  const form = body instanceof FormData;
  if (body && !form) headers['Content-Type'] = 'application/json';
  if (employeeId) headers['X-Employee-Id'] = employeeId;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body && !form ? JSON.stringify(body) : body,
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new ApiError(res.status, json?.message ?? `서버 오류 (${res.status})`, json?.data);
  }
  return json.data;
}

// 서버의 LocalDateTime("2026-10-19T16:42:00")을 화면 표기("2026-10-19 16:42")로 바꾼다
export const toLabel = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : v);

const toTaskRequest = (r) => ({ ...r, requestedAt: toLabel(r.requestedAt), decidedAt: toLabel(r.decidedAt) });

export const api = {
  health: () => request('GET', '/api/health'),

  login: (id, password) => request('POST', '/api/auth/login', { id, password }),
  logout: (id) => request('POST', `/api/auth/logout/${id}`),
  // 잠긴 계정 → 화면의 loginLocks 형태 { [id]: { count, lockedAt } }
  locks: async () =>
    Object.fromEntries(
      (await request('GET', '/api/auth/locks')).map((l) => [l.id, { count: l.failCount, lockedAt: toLabel(l.lockedAt) }]),
    ),
  unlock: (id) => request('DELETE', `/api/auth/locks/${id}`),
  resetPassword: (id) => request('POST', `/api/auth/password-reset/${id}`),

  members: async () => (await request('GET', '/api/users')).map((m) => ({ ...m, institutionId: m.institutionId ?? undefined })),
  approveMember: (id) => request('POST', `/api/users/${id}/approve`),
  rejectMember: (id) => request('POST', `/api/users/${id}/reject`),
  updateProfile: (id, { dept, email, extension }) => request('PUT', `/api/users/${id}`, { dept, email, extension }),
  changePassword: (id, currentPassword, newPassword) =>
    request('PUT', `/api/users/${id}/password`, { currentPassword, newPassword }),

  grantTask: (id, taskId) => request('POST', `/api/users/${id}/tasks/${taskId}`),
  revokeTask: (id, taskId) => request('DELETE', `/api/users/${id}/tasks/${taskId}`),
  taskRequests: async () => (await request('GET', '/api/task-requests')).map(toTaskRequest),
  requestTask: (id, taskId, reason) => request('POST', `/api/users/${id}/task-requests`, { businessCode: taskId, reason }),
  approveTaskRequest: (requestId) => request('POST', `/api/task-requests/${requestId}/approve`),
  rejectTaskRequest: (requestId) => request('POST', `/api/task-requests/${requestId}/reject`),

  // 업무별 회비분담기준 skill.md (taskCode: OPEN_BANKING 또는 업무 ID openbanking). 권한 없는 업무는 403
  skills: () => request('GET', '/api/v1/skills'),
  skill: (taskCode) => request('GET', `/api/v1/skills/${taskCode}`),
  saveSkill: (taskCode, content) => request('PUT', `/api/v1/skills/${taskCode}`, { content }),
  resetSkill: (taskCode) => request('POST', `/api/v1/skills/${taskCode}/reset`),
  // 1번 비즈니스 규칙 텍스트 → 3번 정산 수식 자동 생성 (저장하지 않는다). AI 키가 없으면 서버도 내장 변환기
  // → { generatedFormula, detectedPattern, explanation[], validationPassed, sampleResultNormal, sampleResultZero, source, ... }
  generateFormula: (taskCode, businessRulesText) =>
    request('POST', `/api/v1/skills/${taskCode}/generate-formula`, { businessRulesText }),
  // → { generatedScript, explanation[], unsupported[], validationPassed, validationMessage, sample[], checks[], notes[], source, model, note }
  generatePostprocess: (taskCode, specialRulesText) =>
    request('POST', `/api/v1/skills/${taskCode}/generate-postprocess`, { specialRulesText }),
  // AI 연결 상태. check=true 면 서버가 실제로 짧은 요청을 보내 키·모델이 맞는지 시험한다
  aiStatus: (check = false) => request('GET', `/api/v1/ai/status${check ? '?check=true' : ''}`),
  // 업무 관리 (추가·삭제는 시스템관리자만). 업무 1개 = md 파일 1개
  tasks: () => request('GET', '/api/v1/tasks'),
  createTask: (taskCode, name, fileName) => request('POST', '/api/v1/tasks', { taskCode, name, fileName }),
  deleteTask: (taskCode) => request('DELETE', `/api/v1/tasks/${taskCode}`),
  // 기관 관리 (시스템관리자만). 목록은 사용 중지 기관·사용 현황(산출 이력·대사·테스트·연결 회원) 포함
  institutions: () => request('GET', '/api/fee/institutions'),
  adminInstitutions: () => request('GET', '/api/v1/institutions'),
  createInstitution: (body) => request('POST', '/api/v1/institutions', body),
  updateInstitution: (id, body) => request('PUT', `/api/v1/institutions/${id}`, body),
  setInstitutionActive: (id, active) => request('POST', `/api/v1/institutions/${id}/${active ? 'activate' : 'deactivate'}`),
  deleteInstitution: (id) => request('DELETE', `/api/v1/institutions/${id}`),
  // 매칭 시험 → { value, excel: { id, name, code, matchedBy } | null, issue: {...} | null }
  matchInstitution: (value) => request('GET', `/api/v1/institutions/match?value=${encodeURIComponent(value)}`),
  // 실적 엑셀 업로드 → UploadResult { fileName, rowCount, totalCount, counts, unmatched, layout, columns, values, excluded, … }.
  // 서버가 AI(키가 없거나 실패하면 규칙 기반)로 표 구조를 판별하고, from~to 밖 날짜의 행은 빼서 excluded 로 알려 준다. 잘못된 파일은 400
  uploadPerformance: (file, period) => {
    const form = new FormData();
    form.append('file', file);
    if (period?.from && period?.to) {
      form.append('from', period.from);
      form.append('to', period.to);
    }
    return request('POST', '/api/fee/uploads', form);
  },
  // skill.md 수식으로 산출 → 화면 결과 행 형태로 (counts 를 주면 업로드 실적으로 산출)
  calculate: async (body) => {
    const res = await request('POST', '/api/v1/fees/calculate', body);
    return { ...res, rows: res.items.map(({ id, ...item }) => ({ ...item, status: '대기' })) };
  },
};
