async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, options);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const msg = type.includes('json') ? (await res.json()).error : await res.text();
    throw new Error(msg || `요청 실패 (${res.status})`);
  }
  return type.includes('json') ? res.json() : res;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export const api = {
  health: () => request('/health'),
  works: () => request('/works'),
  addWork: (body) => request('/works', json('POST', body)),
  criteria: (code) => request(`/works/${code}/criteria`),
  learn: (code, body) => request(`/works/${code}/criteria/learn`, json('POST', body)),
  validate: (rule) => request('/rules/validate', json('POST', { rule })),
  saveCriteria: (code, body) => request(`/works/${code}/criteria`, json('POST', body)),
  activate: (code, version) => request(`/works/${code}/criteria/${version}/activate`, json('POST')),
  parseFile: (file, year) => request(
    `/performance/parse?filename=${encodeURIComponent(file.name)}&year=${year}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
  ),
  calculate: (body) => request('/fees/calculate', json('POST', body)),
  async exportXlsx(body) {
    const res = await request('/fees/export', json('POST', body));
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) ?? [])[1] ?? 'fee.xlsx');
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
