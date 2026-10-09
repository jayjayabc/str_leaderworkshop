// 스피드 퀴즈 자동 판정 (Quiz v1.0)
//
// 이 파일은 의존성이 없다(타입도 여기서 정의) — scripts/quiz-judge-test.mjs가 그대로 트랜스파일해 돌린다.
//
// 판정 결과
//   'correct' | 'wrong' | 'review'(자동 판정 불가 — 운영자가 ✓/✗로 결정)
//
// 판정 종류
//   numeric  — 답이 숫자 하나. min~max(포함) 안이면 정답. 한국어 단위(만·억·조)를 읽는다.
//   text     — 짧은 텍스트. 정규화 후 accept 중 하나와 같으면 정답, contains 중 하나를 포함해도 정답.
//   keywords — 여러 부분이 모두 있어야 하는 답. all의 각 항목(대안 배열 가능)이 모두 있어야 하고,
//              any가 있으면 그중 하나 이상, none에 걸리면 오답. 're:'로 시작하면 정규식.
//   manual   — 자동 판정하지 않는다('review').

export type Verdict = 'correct' | 'wrong';
export type AutoVerdict = Verdict | 'review';

/** 한국어 단위 → 배수 */
const MULTIPLIER: Record<string, number> = { 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12 };

export interface NumericJudge {
  type: 'numeric';
  target: number;
  min: number;
  max: number;
  /**
   * 답의 단위. '만'·'억'·'조'면 target/min/max가 그 단위 기준이다
   * (예: 격차 158억 → unit '억', target 158). 그 밖의 단위(%, 명, 년 …)는 표시용.
   */
  unit?: string;
  /** 숫자로 읽히지 않는 정답 표현(예: '네곳') */
  accept?: string[];
  /** 허용 범위를 정한 근거 — 문서화용 */
  why?: string;
}

export interface TextJudge {
  type: 'text';
  accept: string[];
  /** 정규화한 답에 이 중 하나가 들어 있으면 정답 */
  contains?: string[];
  why?: string;
}

/** 문자열 = 부분 일치(정규화 후), 're:…' = 정규식(가벼운 정규화 후), 배열 = 그중 하나 */
export type KeywordPattern = string | string[];

export interface KeywordsJudge {
  type: 'keywords';
  all: KeywordPattern[];
  any?: KeywordPattern[];
  none?: KeywordPattern[];
  why?: string;
}

export interface ManualJudge {
  type: 'manual';
  /** 운영자가 볼 채점 기준 */
  rubric?: string;
  why?: string;
}

/** 여러 칸 답 — 칸마다 따로 판정해 모두 맞아야 정답 (칸 구분은 ' | ') */
export interface FieldsJudge {
  type: 'fields';
  parts: JudgeSpec[];
  why?: string;
}

export type JudgeSpec = NumericJudge | TextJudge | KeywordsJudge | ManualJudge | FieldsJudge;

// ─── 정규화 ─────────────────────────────────────────────────

/**
 * 유니코드 정규화(NFKC) + 전각 숫자·기호를 반각으로.
 * NFKC가 중요하다: 아이폰·맥 일부 입력/붙여넣기는 한글을 자모 분해형(NFD)으로 보내므로,
 * 그대로 두면 '마스턴캐피탈'이 정답 목록의 '마스턴'과 다른 문자열이 되어 오답 처리된다.
 */
function toHalfWidth(s: string): string {
  return s.normalize('NFKC').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 텍스트 판정용 정규화:
 * trim · 소문자 · 공백/쉼표/마침표/가운뎃점/따옴표/괄호 제거 · 단위(원 억 조 명 개 년 곳 %p 배 %) 제거
 */
export function normalizeText(input: string): string {
  let s = toHalfWidth(input).trim().toLowerCase();
  s = s.replace(/%p|％p/g, '');
  s = s.replace(/[\s,.·ㆍ'"`‘’“”()（）\[\]{}!?~\-_/]/g, '');
  s = s.replace(/[원억조명개년곳배%]/g, '');
  return s;
}

/** 키워드 정규식용 가벼운 정규화 — 소문자, 전각→반각, 공백 하나로 */
export function normalizeLight(input: string): string {
  return toHalfWidth(input).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 답에서 숫자 하나를 읽는다. 단위 배수를 곱해 '절대값'과, 단위가 쓰였는지를 돌려준다.
 *   "2,793만" → 27,930,000 (단위 있음) · "158억 원" → 15,800,000,000 · "14.2%" → 14.2
 *   "1조 2,000억" → 1.2e12 (여러 토막은 더한다)
 * 숫자가 없으면 null.
 */
export function parseKoreanNumber(input: string): { value: number; hadMultiplier: boolean } | null {
  const s = toHalfWidth(input).replace(/,/g, '').replace(/\s+/g, '');
  // 숫자와 한국어 자릿수(십·백·천 / 만·억·조)를 차례로 읽는다 — "3천만", "2천8백만", "1만8천", "1억 2000"
  const SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
  const re = /(-?\d+(?:\.\d+)?)|(조|억|만|천|백|십)/g;
  let total = 0;
  let small = 0;
  let pending: number | null = null;
  let found = false;
  let hadMultiplier = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) continue;
      if (pending !== null) {
        // 단위 없이 숫자가 두 개 이어지면(예: "3 4") 모호 — 앞 숫자까지만
        if (!hadMultiplier && small === 0) break;
        small += pending;
      }
      pending = n;
      found = true;
    } else if (found || m[2] in SMALL) {
      const u = m[2];
      if (u in SMALL) {
        small += (pending ?? 1) * SMALL[u];
        pending = null;
        hadMultiplier = true;
        found = true;
      } else {
        const section = small + (pending ?? 0) || 1;
        total += section * MULTIPLIER[u];
        small = 0;
        pending = null;
        hadMultiplier = true;
      }
    }
  }
  total += small + (pending ?? 0);
  return found ? { value: total, hadMultiplier } : null;
}

function matchPattern(pattern: KeywordPattern, text: string, light: string): boolean {
  const list = Array.isArray(pattern) ? pattern : [pattern];
  return list.some((p) => {
    if (p.startsWith('re:')) {
      try {
        return new RegExp(p.slice(3), 'u').test(light);
      } catch {
        return false;
      }
    }
    const needle = normalizeText(p);
    return needle.length > 0 && text.includes(needle);
  });
}

/**
 * 숫자형 답에서 볼 부분을 고른다 — "풀이를 같이 쓴" 답을 위해.
 *   % 문항: "683억, 14.2%" → "14.2%" (퍼센트가 붙은 숫자)
 *   그 밖: "1126-968=158", "40만/216만 → 18.5" → 마지막 = 또는 → 뒤
 */
export function numericFocus(raw: string, unit?: string): string {
  const s = toHalfWidth(raw);
  if (unit === '%') {
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*(%|퍼센트|프로)(?!p)/);
    if (m) return m[1];
  }
  const cut = Math.max(s.lastIndexOf('='), s.lastIndexOf('→'), s.lastIndexOf('->') >= 0 ? s.lastIndexOf('->') + 1 : -1);
  if (cut >= 0 && /\d/.test(s.slice(cut + 1))) return s.slice(cut + 1);
  return raw;
}

// ─── 판정 ───────────────────────────────────────────────────

export function judge(spec: JudgeSpec, answer: string): AutoVerdict {
  const raw = (answer ?? '').trim();
  if (!raw) return 'wrong';

  switch (spec.type) {
    case 'manual':
      return 'review';

    case 'fields': {
      const parts = raw.split('|').map((x) => x.trim());
      let review = false;
      for (let i = 0; i < spec.parts.length; i += 1) {
        const v = judge(spec.parts[i], parts[i] ?? '');
        if (v === 'wrong') return 'wrong';
        if (v === 'review') review = true;
      }
      return review ? 'review' : 'correct';
    }

    case 'text': {
      const n = normalizeText(raw);
      if (!n) return 'wrong';
      if (spec.accept.some((a) => normalizeText(a) === n)) return 'correct';
      if (spec.contains?.some((c) => n.includes(normalizeText(c)))) return 'correct';
      return 'wrong';
    }

    case 'keywords': {
      const n = normalizeText(raw);
      const light = normalizeLight(raw);
      if (spec.none?.some((p) => matchPattern(p, n, light))) return 'wrong';
      if (!spec.all.every((p) => matchPattern(p, n, light))) return 'wrong';
      if (spec.any && !spec.any.some((p) => matchPattern(p, n, light))) return 'wrong';
      return 'correct';
    }

    case 'numeric': {
      if (spec.accept?.some((a) => normalizeText(a) === normalizeText(raw))) return 'correct';
      const parsed = parseKoreanNumber(numericFocus(raw, spec.unit));
      if (!parsed) return 'wrong';
      const unitMul = spec.unit && MULTIPLIER[spec.unit] ? MULTIPLIER[spec.unit] : 1;
      let v = parsed.value;
      if (parsed.hadMultiplier) {
        // "158억" → 절대값 → 답 단위(억)로
        v = v / unitMul;
      } else if (unitMul > 1 && Math.abs(v) > Math.abs(spec.max) * 10) {
        // 단위 없이 절대값을 쓴 경우(예: 27930000) → 답 단위로
        v = v / unitMul;
      }
      // 부동소수 오차 여유
      const eps = 1e-9;
      return v >= spec.min - eps && v <= spec.max + eps ? 'correct' : 'wrong';
    }

    default:
      return 'review';
  }
}

/** 운영자 화면용 한 줄 요약 */
export function describeJudge(spec: JudgeSpec): string {
  switch (spec.type) {
    case 'numeric': {
      const u = spec.unit ?? '';
      return spec.min === spec.max
        ? `숫자 ${spec.target}${u} (정확히)`
        : `숫자 ${spec.target}${u} (허용 ${spec.min}~${spec.max}${u})`;
    }
    case 'text':
      return `텍스트: ${spec.accept.slice(0, 4).join(' / ')}${spec.contains?.length ? ` · 포함 ${spec.contains.join(' / ')}` : ''}`;
    case 'keywords':
      return `키워드 ${spec.all.length}개 모두${spec.none?.length ? ' · 금지어 있음' : ''}`;
    case 'manual':
      return '수동 채점';
    case 'fields':
      return `칸별 판정 — ${spec.parts.map((p, i) => `${i + 1}) ${describeJudge(p)}`).join(' · ')}`;
    default:
      return '';
  }
}

/**
 * 참가자 화면용 — 공개된 정답 시각 목록에서 내 제출이 몇 번째 정답인지(1부터).
 * 같은 문자열이 있으면 그 위치, 없으면(표기 차이) 시각 비교로 센다. 목록에 없으면 null.
 */
export function correctRank(times: readonly string[] | undefined, mine: string | undefined | null): number | null {
  if (!times?.length || !mine) return null;
  const exact = times.indexOf(mine);
  if (exact >= 0) return exact + 1;
  const t = new Date(mine).getTime();
  if (!Number.isFinite(t)) return null;
  const n = times.filter((x) => new Date(x).getTime() <= t).length;
  return n > 0 ? n : null;
}
