// 화면 공용: HTML 이스케이프, 숫자 표시, 작은 조각
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const n = (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('ko-KR'));
export const won = (v) => (v === null || v === undefined ? '-' : `${n(v)}원`);
export const signed = (v) => (Number(v) > 0 ? `+${won(v)}` : won(v));
export const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;
export const rule = (id) => `<span class="badge rule">${esc(id)}</span>`;
export const STATUS_KO = { ok: '일치', fail: '불일치', warn: '확인 필요', error: '오류', info: '안내' };

export const select = (attrs, options, value) =>
  `<select ${attrs}>${options.map((o) => `<option value="${esc(o.value ?? '')}" ${String(o.value ?? '') === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;

export const issuesList = (issues) => (issues.length
  ? `<ul class="issues">${issues.map((i) => `<li class="${i.level}">${badge(i.level === 'error' ? 'fail' : i.level, STATUS_KO[i.level] ?? i.level)} ${i.rule ? rule(i.rule) : ''} ${esc(i.message)}</li>`).join('')}</ul>`
  : '');

export const field = (label, inner, note = '') => `<label class="f"><span>${label}</span>${inner}${note ? `<small>${note}</small>` : ''}</label>`;
