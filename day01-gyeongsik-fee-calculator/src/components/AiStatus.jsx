import { useEffect, useState } from 'react';
import { Bot, LoaderCircle, TriangleAlert } from 'lucide-react';
import { api, apiEnabled } from '../utils/api';

export const SOURCE_LABEL = { AI: 'AI 생성', RULE: '규칙 기반 생성 (AI 키 없음)', RULE_FALLBACK: 'AI 실패 → 규칙 기반 생성' };

// AI 가 없을 때 무엇으로 대신하는지 (빌더마다 다르다). 3번 수식은 AI 전용이라 대신할 것이 없다
const WITHOUT_AI = {
  fallback: { offline: '서버 미연결 상태라 AI 대신 내장 변환기로 만듭니다.', noKey: '서버가 AI 키를 읽지 못해 내장 변환기로 만듭니다.' },
  none: {
    offline: '서버 미연결(Mock) 상태라 AI 수식 생성을 쓸 수 없습니다. 아래에서 변수와 수식을 직접 작성해 주세요.',
    noKey: '서버가 AI 키를 읽지 못해 수식을 생성할 수 없습니다. 아래에서 변수와 수식을 직접 작성하거나,',
  },
};

// [AI 계산식 빌더] 생성 버튼 옆: 서버가 AI 키를 읽었는지, 실제 호출이 되는지(연결 시험) 보여 준다. 키 값은 서버가 내보내지 않는다.
// without = 'fallback'(AI 없으면 내장 변환기) | 'none'(AI 전용). onStatus 로 서버 AI 상태({ enabled, … })를 알려 준다
export function AiStatusLine({ without = 'fallback', onStatus }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const text = WITHOUT_AI[without] ?? WITHOUT_AI.fallback;

  useEffect(() => {
    if (!apiEnabled) return;
    let alive = true;
    api
      .aiStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        onStatus?.(s);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const s = await api.aiStatus(true);
      setStatus(s);
      onStatus?.(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  if (!apiEnabled) {
    return <p className="mt-1.5 text-[11px] text-slate-500">{text.offline}</p>;
  }
  if (error) return <p className="mt-1.5 text-[11px] text-rose-600">AI 상태 확인 실패: {error}</p>;
  if (!status) return null;
  if (!status.enabled) {
    return (
      <p className="mt-1.5 flex gap-1 text-[11px] text-amber-700">
        <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
        {text.noKey} 백엔드(Render) Environment에 AI_API_KEY를 넣고 저장한 뒤 재배포(Manual Deploy)해 주세요.
      </p>
    );
  }
  return (
    <div className="mt-1.5 text-[11px]">
      <p className="flex flex-wrap items-center gap-1.5 text-slate-600">
        <Bot className="w-3.5 h-3.5 text-violet-500" />
        AI 연결: {status.provider} · <span className="font-mono">{status.model}</span>
        <button onClick={check} disabled={checking} className="ml-1 flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 hover:bg-slate-50">
          {checking && <LoaderCircle className="w-3 h-3 animate-spin" />} 연결 시험
        </button>
      </p>
      {status.check && (
        <p className={`mt-1 ${status.check.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {status.check.ok ? '✅ ' : '⚠️ '}
          {status.check.message}
        </p>
      )}
    </div>
  );
}

// 생성 결과가 AI 가 아니면 왜 아닌지(서버 note) 보여 준다
export function SourceNote({ result }) {
  if (!result?.note || result.source === 'AI') return null;
  return (
    <p className="mt-2 flex gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
      <TriangleAlert className="w-4 h-4 shrink-0" /> {result.note}
    </p>
  );
}
