import { useState } from 'react';
import { Eye, EyeOff, Lock, LogIn, ShieldAlert, User } from 'lucide-react';

// ▼ 로고 교체 위치: 준비한 로고 파일을 public/ 에 넣고 이 경로만 바꾸면 된다 (예: 'logo.png').
//   지금은 금융결제원 CI 심벌마크를 기본으로 쓴다.
const LOGO_SRC = 'kftc-symbol.png';

// 시연용 테스트 계정. 실제 인증은 백엔드 연동 시 교체한다.
const DEMO_ACCOUNT = { id: 'admin', password: '1234' };
const MAX_ATTEMPTS = 5;

function LogoShowcase() {
  return (
    <div className="logo-stage">
      <div className="logo-glow" />
      <div className="logo-3d">
        {/* 뒤쪽 레이어를 겹쳐 회전할 때 두께가 보이게 한다 */}
        {[4, 3, 2, 1].map((d) => (
          <img key={d} src={LOGO_SRC} alt="" aria-hidden className="logo-layer logo-edge" style={{ transform: `translateZ(${-d * 3}px)` }} />
        ))}
        <img src={LOGO_SRC} alt="금융결제원 심벌마크" className="logo-layer" />
        {/* 로고 모양으로 마스킹한 대각선 빛줄기 */}
        <div
          className="logo-shimmer"
          style={{ WebkitMaskImage: `url(${LOGO_SRC})`, maskImage: `url(${LOGO_SRC})` }}
        />
      </div>
    </div>
  );
}

export default function LoginPage({ onLogin }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [error, setError] = useState('');

  const locked = failCount >= MAX_ATTEMPTS;

  const submit = (e) => {
    e.preventDefault();
    if (locked) return;
    if (!id.trim() || !password) {
      setError('ID(사번)와 비밀번호를 모두 입력해 주세요.');
      return;
    }
    if (id.trim() === DEMO_ACCOUNT.id && password === DEMO_ACCOUNT.password) {
      setFailCount(0);
      setError('');
      onLogin();
      return;
    }
    const next = failCount + 1;
    setFailCount(next);
    setPassword('');
    setError(next >= MAX_ATTEMPTS ? '' : 'ID 또는 비밀번호가 올바르지 않습니다.');
  };

  const resetLock = () => {
    setFailCount(0);
    setError('');
    setPassword('');
  };

  return (
    <div className="min-h-screen flex">
      {/* 왼쪽: 로고 쇼케이스 (lg 이상에서만) */}
      <section className="hidden lg:flex w-1/2 relative overflow-hidden flex-col items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 text-white">
        <div className="absolute inset-0 login-grid opacity-40" />
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-brand-500/25 blur-3xl" />

        <div className="relative flex flex-col items-center">
          <LogoShowcase />
          <h1 className="mt-14 text-3xl font-bold tracking-tight">금융결제원 회비자동산출시스템</h1>
          <p className="mt-3 text-brand-200">AI 기반 업무별 회비 자동 산출 및 대사 플랫폼</p>
        </div>
        <p className="absolute bottom-6 text-[11px] text-brand-300/80">KFTC Fee Calculation System</p>
      </section>

      {/* 오른쪽: 로그인 폼 */}
      <section className="w-full lg:w-1/2 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-sm">
          {/* 창모드(작은 화면)에서만 보이는 미니 로고 */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src={LOGO_SRC} alt="금융결제원 심벌마크" className="w-16 h-16 drop-shadow-[0_0_14px_rgba(23,140,220,0.45)]" />
            <p className="mt-3 text-lg font-bold text-brand-900">금융결제원 회비자동산출시스템</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-2xl font-bold text-brand-900">로그인</h2>
            <p className="mt-1 text-sm text-slate-500">사번과 비밀번호를 입력해 주세요.</p>

            {locked && (
              <div className="mt-5 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <p>비밀번호 5회 오입력으로 계정이 잠겼습니다. 관리자에게 초기화를 요청하세요.</p>
              </div>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 mb-1">ID (사번)</span>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    disabled={locked}
                    autoComplete="username"
                    autoFocus
                    placeholder="사번 입력"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-slate-500 mb-1">비밀번호</span>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={locked}
                    autoComplete="current-password"
                    placeholder="비밀번호 입력"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={locked}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 hover:text-slate-600 disabled:opacity-50"
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>

              {!locked && (error || failCount > 0) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-rose-600">{error}</span>
                  {failCount > 0 && (
                    <span className="font-medium text-rose-600 tabular-nums">
                      오류 횟수: {failCount}/{MAX_ATTEMPTS}회
                    </span>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={locked}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-700 to-accent-500 py-2.5 text-sm font-semibold text-white shadow hover:shadow-md disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
              >
                <LogIn className="w-4 h-4" /> 로그인
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] text-slate-400">시연용 계정 ID: admin / PW: 1234</p>

            {locked && (
              <div className="mt-3 text-center">
                <button
                  onClick={resetLock}
                  className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                >
                  [시연용: 잠금 초기화]
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
