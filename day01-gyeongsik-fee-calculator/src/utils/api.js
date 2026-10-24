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

// 모든 응답은 { success, message, data } 형태. 실패하면 ApiError(status, message, data)를 던진다.
async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
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

  // 업무별 skill.md (taskCode: OPEN_BANKING 또는 업무 ID openbanking)
  skill: (taskCode) => request('GET', `/api/v1/fees/skill/${taskCode}`),
  saveSkill: (taskCode, markdown, updatedBy) => request('PUT', `/api/v1/fees/skill/${taskCode}`, { markdown, updatedBy }),
  resetSkill: (taskCode, updatedBy) =>
    request('DELETE', `/api/v1/fees/skill/${taskCode}?updatedBy=${encodeURIComponent(updatedBy)}`),
  // skill.md 수식으로 산출 → 화면 결과 행 형태로
  calculate: async (body) => {
    const res = await request('POST', '/api/v1/fees/calculate', body);
    return { ...res, rows: res.items.map(({ id, ...item }) => ({ ...item, status: '대기' })) };
  },
};
