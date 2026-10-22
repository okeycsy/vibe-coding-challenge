// 화면 공용 부품
import { useEffect, useState } from 'react';

export const fmt = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('ko-KR'));
export const fmtWon = (n) => `${fmt(n)}원`;
export const fmtSigned = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const digits = (v) => String(v).replace(/[^\d]/g, '').slice(0, 15);

// 콤마가 들어가는 원 단위 금액 입력. allowEmpty면 비웠을 때 null
export function MoneyInput({ id, value, onChange, allowEmpty = false, placeholder = '0', className = '', ...rest }) {
  return (
    <span className={`money ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={value === null || value === undefined ? '' : fmt(value)}
        onChange={(e) => {
          const d = digits(e.target.value);
          onChange(d === '' ? (allowEmpty ? null : 0) : Number(d));
        }}
        {...rest}
      />
      <span className="money-unit">원</span>
    </span>
  );
}

// 건수 입력 (빈칸 허용, 잘못된 값은 그대로 보여 주고 상위에서 검증)
export function CountInput({ value, onChange, invalid, ...rest }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => setText(value === undefined || value === null ? '' : String(value)), [value]);
  return (
    <input
      className={`count ${invalid ? 'is-invalid' : ''}`}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      {...rest}
    />
  );
}

export function Field({ label, htmlFor, hint, pending, children, wide = false }) {
  return (
    <div className={`field ${wide ? 'field-wide' : ''}`}>
      <div className="field-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {pending && <PendingBadge />}
      </div>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export const PendingBadge = ({ text = '확인 필요' }) => <span className="badge badge-warn">{text}</span>;

const STATUS = { ok: ['일치', 'badge-ok'], fail: ['불일치', 'badge-fail'], warn: ['확인 필요', 'badge-warn'], info: ['참고', 'badge-info'], error: ['오류', 'badge-fail'] };
export const StatusBadge = ({ status, text }) => <span className={`badge ${STATUS[status][1]}`}>{text ?? STATUS[status][0]}</span>;

// 선택지 카드 (라디오)
export function Choice({ name, options, value, onChange }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={`choice-item ${value === o.value ? 'is-on' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="choice-title">{o.label}</span>
          {o.desc && <span className="choice-desc">{o.desc}</span>}
        </label>
      ))}
    </div>
  );
}

export function Section({ title, desc, actions, children, id }) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {desc && <p className="section-desc">{desc}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Issues({ issues }) {
  if (!issues?.length) return null;
  const order = { error: 0, warn: 1, info: 2 };
  return (
    <ul className="issues">
      {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((i, k) => (
        <li key={k} className={`issue issue-${i.level}`}>
          <StatusBadge status={i.level === 'error' ? 'error' : i.level} text={{ error: '오류', warn: '확인 필요', info: '참고' }[i.level]} />
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export const ROUNDING_OPTIONS = [
  { value: 'floor', label: '내림' },
  { value: 'round', label: '반올림' },
  { value: 'ceil', label: '올림' },
];

export function Select({ id, value, onChange, options, ...rest }) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
