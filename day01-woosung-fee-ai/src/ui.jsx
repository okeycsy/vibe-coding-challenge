import { LoaderCircle, TriangleAlert, Info } from 'lucide-react';

export function Card({ title, icon: Icon, step, right, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
            {step && <span className="grid h-5 w-5 place-items-center rounded-full bg-navy-800 text-[11px] text-white">{step}</span>}
            {Icon && <Icon className="h-4 w-4 text-navy-500" />}
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const VARIANTS = {
  primary: 'bg-navy-800 text-white hover:bg-navy-700 disabled:bg-slate-300',
  secondary: 'border border-slate-300 bg-white text-navy-800 hover:bg-slate-50 disabled:text-slate-400',
  gold: 'bg-gold-500 text-navy-950 hover:bg-gold-400 disabled:bg-slate-300 disabled:text-white',
};

export function Button({ variant = 'primary', icon: Icon, loading, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Alert({ kind = 'error', children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null;
  const style = kind === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : kind === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-navy-100 bg-navy-50 text-navy-800';
  const Icon = kind === 'info' ? Info : TriangleAlert;
  return (
    <div className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${style}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-navy-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
