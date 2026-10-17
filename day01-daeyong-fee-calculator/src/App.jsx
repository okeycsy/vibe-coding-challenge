import { useRef, useState } from 'react';
import { calculateFees } from './feeCalc.js';
import { parseWorkbook, buildResultWorkbook, downloadWorkbook } from './excel.js';

const won = (n) => n.toLocaleString('ko-KR');
const pct = (x) => (x * 100).toFixed(2);

export default function App() {
  const [feeText, setFeeText] = useState('');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // { orgs, warnings }
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const totalFee = Number(feeText.replace(/[^\d]/g, '')) || 0;

  const onFeeChange = (e) => {
    const digits = e.target.value.replace(/[^\d]/g, '').replace(/^0+/, '');
    setFeeText(digits ? won(Number(digits)) : '');
    setResult(null);
  };

  const onFileChange = async (e) => {
    const f = e.target.files?.[0];
    setResult(null);
    setError('');
    setParsed(null);
    setFile(f || null);
    if (!f) return;
    try {
      setParsed(parseWorkbook(await f.arrayBuffer()));
    } catch (err) {
      setError(`엑셀을 읽지 못했습니다: ${err.message}`);
    }
  };

  const onCalculate = () => {
    setError('');
    try {
      setResult(calculateFees(totalFee, parsed.orgs));
    } catch (err) {
      setError(err.message);
    }
  };

  const onDownload = () => {
    const wb = buildResultWorkbook(result, { sourceName: file?.name });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadWorkbook(wb, `회비산출결과_${stamp}.xlsx`);
  };

  const warnings = [...(parsed?.warnings ?? []), ...(result?.warnings ?? [])];
  const canCalculate = totalFee > 0 && parsed?.orgs?.length > 0;

  return (
    <div className="page">
      <header>
        <h1>금융정보업무 회비 산출</h1>
        <p className="sub">
          회비 총액의 <b>25%</b>는 기관 수로 균등 분배하고, <b>75%</b>는 압류·추심·해제 건수 합계 비율로 안분합니다.
        </p>
      </header>

      <section className="inputs">
        <label className="field">
          <span>회비 총액 (원)</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="예: 100,000,000"
            value={feeText}
            onChange={onFeeChange}
          />
        </label>

        <div className="field">
          <span>건수 엑셀 파일</span>
          <div className="file-row">
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
              파일 선택
            </button>
            <span className="file-name">{file ? file.name : '선택된 파일 없음'}</span>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFileChange} />
          </div>
          <a className="hint" href="./sample-input.xlsx" download>
            예시 양식 내려받기
          </a>
        </div>

        <button type="button" className="primary" disabled={!canCalculate} onClick={onCalculate}>
          회비 산출
        </button>
      </section>

      {parsed && !result && (
        <p className="info">{parsed.orgs.length}개 기관을 읽었습니다. 회비 총액을 입력하고 산출을 누르세요.</p>
      )}
      {error && <p className="error">{error}</p>}
      {warnings.length > 0 && (
        <ul className="warn">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {result && (
        <section className="result">
          <div className="summary">
            <div><span>회비 총액</span><b>{won(result.totalFee)}원</b></div>
            <div><span>균등분 (25%)</span><b>{won(result.equalPool)}원</b></div>
            <div><span>건수비례분 (75%)</span><b>{won(result.ratioPool)}원</b></div>
            <div><span>기관 / 전체 건수</span><b>{result.rows.length}개 / {won(result.totalCount)}건</b></div>
            <button type="button" className="primary" onClick={onDownload}>
              결과 엑셀 내려받기
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>순번</th>
                  <th>기관명</th>
                  <th>압류</th>
                  <th>추심</th>
                  <th>해제</th>
                  <th>합계건수</th>
                  <th>비율(%)</th>
                  <th>균등분담액</th>
                  <th>건수비례분담액</th>
                  <th>회비</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td>{i + 1}</td>
                    <td className="name">{r.name}</td>
                    <td>{won(r.seizure)}</td>
                    <td>{won(r.collection)}</td>
                    <td>{won(r.release)}</td>
                    <td>{won(r.count)}</td>
                    <td>{pct(r.ratio)}</td>
                    <td>{won(r.equalShare)}</td>
                    <td>{won(r.ratioShare)}</td>
                    <td className="fee">{won(r.fee)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>합계</td>
                  <td>{won(result.totals.seizure)}</td>
                  <td>{won(result.totals.collection)}</td>
                  <td>{won(result.totals.release)}</td>
                  <td>{won(result.totals.count)}</td>
                  <td>100.00</td>
                  <td>{won(result.totals.equalShare)}</td>
                  <td>{won(result.totals.ratioShare)}</td>
                  <td className="fee">{won(result.totals.fee)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="note">
            원 단위 처리: 원 미만은 버리고, 남는 원은 소수점 이하가 큰 기관부터 1원씩 배정해 합계가 총액과 정확히 맞도록 했습니다.
          </p>
        </section>
      )}
    </div>
  );
}
