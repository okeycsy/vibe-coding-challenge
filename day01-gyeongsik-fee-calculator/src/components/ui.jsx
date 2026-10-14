import { CircleCheck, Clock, Hourglass } from 'lucide-react';

export function Card({ title, step, icon: Icon, right, children, className = '' }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            {step && (
              <span className="rounded-md bg-brand-700 text-white text-[11px] font-bold px-2 py-0.5">STEP {step}</span>
            )}
            {Icon && <Icon className="w-4 h-4 text-brand-500" />}
            <h2 className="font-semibold text-brand-900">{title}</h2>
          </div>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATUS_STYLE = {
  대기: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: Hourglass },
  확인중: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  완료: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CircleCheck },
};

export function StatusBadge({ status, onClick }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      title={onClick ? '클릭하여 상태 변경' : undefined}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls} ${
        onClick ? 'hover:ring-2 hover:ring-brand-200 cursor-pointer' : ''
      }`}
    >
      <Icon className="w-3 h-3" />
      {status}
    </Tag>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  const tone = toast.tone === 'error' ? 'bg-rose-600' : 'bg-brand-800';
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${tone} text-white text-sm rounded-lg shadow-lg px-4 py-3 animate-fadein`}>
      {toast.message}
    </div>
  );
}

export function Select({ label, value, onChange, children, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-50"
      >
        {children}
      </select>
    </label>
  );
}
