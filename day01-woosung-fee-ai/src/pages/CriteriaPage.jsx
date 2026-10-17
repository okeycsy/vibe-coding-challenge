import { useEffect, useState } from 'react';
import { BrainCircuit, CircleCheck, History, Plus, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { Alert, Button, Card } from '../ui.jsx';

const EXAMPLE = `기본회비 20%는 참가기관 균등 분담
실적회비 80%는 실적 비례
실적 항목: 압류 1, 추심 1, 해제 0.5
10원 미만 절사`;

export default function CriteriaPage({ works, onChanged, aiEngine }) {
  const [code, setCode] = useState('');
  const [detail, setDetail] = useState(null);
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  const [draft, setDraft] = useState(null);      // { rule, errors, notes, description, engine }
  const [ruleJson, setRuleJson] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [newWork, setNewWork] = useState({ code: '', name: '' });

  useEffect(() => { if (!code && works.length) setCode(works[0].code); }, [works, code]);
  const loadDetail = (c = code) => c && api.criteria(c).then(setDetail).catch((e) => setError(e.message));
  useEffect(() => { setDraft(null); setText(''); setSaved(''); setError(''); loadDetail(); }, [code]);

  const run = (key, fn) => async () => {
    setBusy(key); setError(''); setSaved('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const learn = run('learn', async () => {
    const out = await api.learn(code, { text, hint });
    setDraft(out);
    setRuleJson(JSON.stringify(out.rule, null, 2));
  });

  const revalidate = run('validate', async () => {
    let rule;
    try { rule = JSON.parse(ruleJson); } catch { throw new Error('규칙 JSON 형식이 올바르지 않습니다.'); }
    const out = await api.validate(rule);
    setDraft((d) => ({ ...d, ...out }));
  });

  const save = run('save', async () => {
    const rule = JSON.parse(ruleJson);
    const w = await api.saveCriteria(code, { rule, sourceText: text, engine: draft.engine });
    setSaved(`v${w.activeVersion}으로 저장하고 바로 적용했습니다.`);
    setDraft(null); setText('');
    await Promise.all([onChanged(), loadDetail()]);
  });

  const activate = (v) => run(`act${v}`, async () => {
    await api.activate(code, v);
    setSaved(`v${v}을 다시 적용했습니다.`);
    await Promise.all([onChanged(), loadDetail()]);
  })();

  const addWork = run('add', async () => {
    const w = await api.addWork(newWork);
    setNewWork({ code: '', name: '' });
    await onChanged();
    setCode(w.code);
  });

  const active = detail?.versions.find((v) => v.version === detail.activeVersion);

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <div className="space-y-5">
        <Card title="업무">
          <div className="space-y-1.5">
            {works.map((w) => (
              <button key={w.code} type="button" onClick={() => setCode(w.code)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                  w.code === code ? 'bg-navy-800 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}>
                {w.name}
                <span className={`text-[11px] ${w.code === code ? 'text-navy-200' : 'text-slate-400'}`}>{w.rule ? `v${w.activeVersion}` : '—'}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <div className="text-xs font-semibold text-slate-600">업무 추가</div>
            <input className="input" placeholder="업무명 (예: 금융정보 업무)" value={newWork.name} onChange={(e) => setNewWork({ ...newWork, name: e.target.value })} />
            <input className="input" placeholder="코드 (영문, 예: fininfo)" value={newWork.code} onChange={(e) => setNewWork({ ...newWork, code: e.target.value })} />
            <Button variant="secondary" className="w-full" icon={Plus} loading={busy === 'add'} disabled={!newWork.code || !newWork.name} onClick={addWork}>추가</Button>
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Alert>{error}</Alert>
        {saved && <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CircleCheck className="h-4 w-4" />{saved}</div>}

        <Card title={`현재 적용 중인 분담기준${active ? ` · v${active.version}` : ''}`} icon={ShieldCheck}>
          {active ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-sm font-semibold text-navy-900">{active.rule.summary}</div>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {active.description.map((d) => <li key={d} className="flex gap-2"><span className="text-navy-400">•</span>{d}</li>)}
                </ul>
              </div>
              <div>
                <div className="label">기준 원문</div>
                <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-700">{active.sourceText || '(원문 없음)'}</pre>
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">아직 등록된 분담기준이 없습니다. 아래에서 기준을 학습시켜 주세요.</p>}
        </Card>

        <Card title="분담기준 학습" icon={BrainCircuit}
          right={<span className="text-xs text-slate-500">{aiEngine && aiEngine !== 'rule-based' ? `Claude가 해석합니다 (${aiEngine})` : 'API 키가 없어 정형 문장만 해석합니다'}</span>}>
          <div className="space-y-3">
            <div>
              <div className="flex items-end justify-between">
                <label className="label">바뀐 회비 분담기준 (규정 문구·메모를 그대로 붙여 넣으세요)</label>
                <button type="button" className="mb-1.5 text-xs font-semibold text-navy-600 hover:underline" onClick={() => setText(EXAMPLE)}>예시 넣기</button>
              </div>
              <textarea className="input h-36 font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
            </div>
            <div>
              <label className="label">실적 파일의 항목(열) 이름 — 선택</label>
              <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="예: 압류, 추심, 해제" />
            </div>
            <Button icon={Sparkles} loading={busy === 'learn'} disabled={!text.trim()} onClick={learn}>기준 학습</Button>
          </div>

          {draft && (
            <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-navy-900">학습 결과 확인</h3>
                <span className="text-xs text-slate-500">해석: {draft.engine === 'rule-based' ? '규칙 기반 해석기' : draft.engine}</span>
              </div>
              <Alert>{draft.errors?.map((e) => <div key={e}>{e}</div>)}</Alert>
              {draft.description?.length > 0 && (
                <ul className="space-y-1 rounded-md bg-navy-50 p-3 text-sm text-navy-900">
                  {draft.description.map((d) => <li key={d}>• {d}</li>)}
                </ul>
              )}
              <Alert kind="info">{draft.rule?.notes?.map((n) => <div key={n}>{n}</div>)}</Alert>
              <div>
                <label className="label">산출 규칙 (JSON) — 필요하면 직접 고친 뒤 다시 검증하세요</label>
                <textarea className="input h-64 font-mono text-xs" value={ruleJson} onChange={(e) => setRuleJson(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" icon={ShieldCheck} loading={busy === 'validate'} onClick={revalidate}>다시 검증</Button>
                <Button icon={Save} loading={busy === 'save'} disabled={draft.errors?.length > 0} onClick={save}>새 버전으로 저장·적용</Button>
              </div>
            </div>
          )}
        </Card>

        {detail?.versions?.length > 0 && (
          <Card title="버전 이력" icon={History}>
            <ul className="divide-y divide-slate-100">
              {detail.versions.map((v) => (
                <li key={v.version} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    <div className="text-sm font-semibold text-navy-900">
                      v{v.version} · {v.rule.summary}
                      {v.version === detail.activeVersion && <span className="ml-2 rounded bg-navy-800 px-1.5 py-px text-[10px] text-white">적용 중</span>}
                    </div>
                    <div className="text-xs text-slate-500">{new Date(v.createdAt).toLocaleString('ko-KR')} · {v.engine}</div>
                  </div>
                  {v.version !== detail.activeVersion && (
                    <Button variant="secondary" className="px-3 py-1 text-xs" loading={busy === `act${v.version}`} onClick={() => activate(v.version)}>이 버전 적용</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
