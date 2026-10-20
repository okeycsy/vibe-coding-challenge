import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { MAX_YEAR, MIN_YEAR, maskDate, normalizeDate, parseDate, toISO } from '../utils/period';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 숫자로 직접 입력하거나 달력에서 고르는 날짜 입력칸.
// value는 입력 중인 문자열 그대로이고, 검증은 부모가 parseDate로 한다.
export default function DateField({ label, value, onChange, error, rangeFrom, rangeTo }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <label className="block">
        <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
        <div className="relative">
          <input
            value={value}
            onChange={(e) => onChange(maskDate(e.target.value))}
            onPaste={(e) => {
              e.preventDefault();
              onChange(normalizeDate(e.clipboardData.getData('text')));
            }}
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            maxLength={10}
            aria-invalid={!!error}
            className={`w-full rounded-lg border bg-white pl-3 pr-10 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 ${
              error ? 'border-rose-400 focus:ring-rose-200' : 'border-slate-300 focus:ring-brand-300'
            }`}
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-brand-500 hover:bg-brand-50"
            aria-label={`${label} 달력 열기`}
            aria-expanded={open}
          >
            <CalendarDays className="w-4 h-4" />
          </button>
        </div>
      </label>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
      {open && (
        <Calendar
          selected={parseDate(value).date}
          rangeFrom={parseDate(rangeFrom ?? '').date}
          rangeTo={parseDate(rangeTo ?? '').date}
          onPick={(d) => {
            onChange(toISO(d));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Calendar({ selected, rangeFrom, rangeTo, onPick }) {
  const base = selected ?? new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const move = (delta) =>
    setView(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const first = new Date(view.y, view.m, 1);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(view.y, view.m, i - first.getDay() + 1));
  const todayISO = toISO(new Date());
  const iso = (d) => d && toISO(d);
  const inRange = (d) => rangeFrom && rangeTo && rangeFrom <= rangeTo && d >= rangeFrom && d <= rangeTo;
  const years = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i);

  return (
    <div
      role="dialog"
      aria-label="날짜 선택 달력"
      className="absolute left-0 top-full mt-1 z-30 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg animate-fadein"
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => move(-1)}
          className="p-1.5 rounded hover:bg-slate-100"
          aria-label="이전 달"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1 text-sm font-semibold text-brand-900">
          <select
            value={view.y}
            onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
            className="rounded border border-slate-200 px-1 py-0.5"
            aria-label="연도 선택"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <select
            value={view.m}
            onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
            className="rounded border border-slate-200 px-1 py-0.5"
            aria-label="월 선택"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}월
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => move(1)} className="p-1.5 rounded hover:bg-slate-100" aria-label="다음 달">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i === 0 ? 'text-rose-400' : i === 6 ? 'text-brand-400' : ''}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d) => {
          const key = toISO(d);
          const out = d.getMonth() !== view.m;
          const isSel = key === iso(selected);
          return (
            <button
              type="button"
              key={key}
              onClick={() => onPick(d)}
              aria-label={key}
              aria-pressed={isSel}
              className={`h-8 text-xs rounded-md tabular-nums transition ${
                isSel
                  ? 'bg-brand-700 text-white font-semibold'
                  : inRange(d)
                    ? 'bg-brand-50 text-brand-800'
                    : out
                      ? 'text-slate-300 hover:bg-slate-50'
                      : 'text-slate-700 hover:bg-brand-50'
              } ${key === todayISO && !isSel ? 'ring-1 ring-accent-500' : ''}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onPick(new Date())}
          className="rounded px-2 py-1 text-[11px] text-brand-600 hover:bg-brand-50"
        >
          오늘
        </button>
      </div>
    </div>
  );
}
