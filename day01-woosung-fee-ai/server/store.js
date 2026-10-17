// 업무와 업무별 분담기준(버전 이력)을 JSON 파일에 저장한다.
// 운영 시스템에서는 이 모듈만 DB 저장소로 바꾸면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCriteriaText } from './engine/learn.js';
import { validateRule } from './engine/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FEE_AI_DATA_DIR || path.join(here, '..', 'data');
const FILE = path.join(DATA_DIR, 'works.json');

// 예시 업무. 실제 금융결제원 분담기준이 아니라 동작을 보이기 위한 가상의 기준이다.
const SEED = [
  {
    code: 'cms', name: 'CMS 업무(예시)',
    text: '기본회비 25%는 참가기관 균등 분담\n실적회비 75%는 처리건수 비례\n원 미만 절사',
  },
  {
    code: 'interbank', name: '타행환 업무(예시)',
    text: '10%는 균등 분담, 90%는 실적 비례\n실적 항목: 송금 1, 조회 0.2\n10원 미만 절사',
  },
  {
    code: 'giro', name: '지로 업무(예시)',
    text: '30% 균등 분담\n70% 구간별 가중치 - 0건 이상 1, 5,000건 이상 2, 20,000건 이상 3\n원 미만 절사',
  },
];

function seed() {
  const now = new Date().toISOString();
  return {
    works: SEED.map((s) => {
      const { rule } = validateRule(parseCriteriaText(s.text));
      return { code: s.code, name: s.name, activeVersion: 1, versions: [{ version: 1, rule, sourceText: s.text, engine: 'seed', createdAt: now }] };
    }),
  };
}

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = seed();
    save();
  }
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}

const summary = (w) => {
  const active = w.versions.find((v) => v.version === w.activeVersion);
  return { code: w.code, name: w.name, activeVersion: w.activeVersion, versions: w.versions.length, rule: active?.rule ?? null, updatedAt: active?.createdAt };
};

export function listWorks() {
  return load().works.map(summary);
}

export function getWork(code) {
  const w = load().works.find((x) => x.code === code);
  if (!w) throw notFound(`업무 '${code}'를 찾을 수 없습니다.`);
  return w;
}

export function activeRule(code) {
  const w = getWork(code);
  const v = w.versions.find((x) => x.version === w.activeVersion);
  if (!v) throw notFound(`'${w.name}'에 등록된 분담기준이 없습니다.`);
  return { work: w, version: v };
}

export function addWork({ code, name }) {
  const c = String(code ?? '').trim().toLowerCase();
  const n = String(name ?? '').trim();
  if (!/^[a-z0-9-]{2,30}$/.test(c)) throw badRequest('업무 코드는 영문 소문자·숫자·하이픈 2~30자입니다.');
  if (!n) throw badRequest('업무명을 입력하세요.');
  const db = load();
  if (db.works.some((w) => w.code === c)) throw badRequest(`업무 코드 '${c}'가 이미 있습니다.`);
  db.works.push({ code: c, name: n, activeVersion: 0, versions: [] });
  save();
  return summary(db.works.at(-1));
}

// 새 분담기준을 다음 버전으로 저장하고 바로 적용한다.
export function saveCriteria(code, { rule: raw, sourceText, engine }) {
  const { rule, errors } = validateRule(raw);
  if (errors.length) throw badRequest(errors.join(' '));
  const w = getWork(code);
  const version = (w.versions.at(-1)?.version ?? 0) + 1;
  w.versions.push({ version, rule, sourceText: String(sourceText ?? ''), engine: String(engine ?? 'manual'), createdAt: new Date().toISOString() });
  w.activeVersion = version;
  save();
  return summary(w);
}

export function activateVersion(code, version) {
  const w = getWork(code);
  if (!w.versions.some((v) => v.version === Number(version))) throw notFound(`버전 ${version}이 없습니다.`);
  w.activeVersion = Number(version);
  save();
  return summary(w);
}

const err = (status) => (msg) => Object.assign(new Error(msg), { status });
const notFound = err(404);
const badRequest = err(400);

// 테스트용
export function _reset() { cache = null; }
