// 비교 매물(comps)로 "이 물건이 보통 얼마에 팔리나"를 추정한다.

export type ConditionGroup = "new" | "used" | "parts";

/** eBay conditionId → 묶음. 새 제품과 중고를 같이 비교하면 시세가 엉망이 된다. */
export const CONDITION_IDS: Record<ConditionGroup, string[]> = {
  new: ["1000", "1500", "1750"],
  used: ["2000", "2010", "2020", "2030", "2500", "2750", "3000", "4000", "5000", "6000"],
  parts: ["7000"],
};

export function conditionGroup(conditionId: string | undefined): ConditionGroup {
  if (!conditionId) return "used";
  for (const [group, ids] of Object.entries(CONDITION_IDS) as [ConditionGroup, string[]][]) {
    if (ids.includes(conditionId)) return group;
  }
  return "used";
}

/** 검색 결과 한 줄을 우리가 쓰기 좋은 모양으로 정리한 것. */
export interface Listing {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price: number;
  /** undefined = 계산형 배송이라 알 수 없음 */
  shipping?: number;
  currency: string;
  conditionId?: string;
  condition?: string;
  imageUrl?: string;
  webUrl?: string;
  sellerName?: string;
  sellerFeedbackPercent?: number;
  sellerFeedbackScore?: number;
  country?: string;
  buyingOptions: string[];
  categoryId?: string;
  /** 판매완료 데이터에서 온 경우 */
  soldDate?: string;
}

export const listingTotal = (l: Listing) => (l.shipping === undefined ? undefined : l.price + l.shipping);

// ── 제목 매칭 ────────────────────────────────────────────

const UNIT_JOIN = /(\d+)\s+(gb|tb|mb|mm|cm|in|inch|oz|ml|w|mah|hz|k)\b/g;

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(UNIT_JOIN, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export const tokens = (s: string) => normalizeTitle(s).split(" ").filter(Boolean);

/**
 * 고장/부품용/박스만 등 시세를 망치는 매물. 검색어에 해당 단어를 직접 넣은 경우(예: "for parts")에는 적용하지 않는다.
 */
export const JUNK_PHRASES = [
  "for parts",
  "parts only",
  "not working",
  "non working",
  "broken",
  "cracked",
  "damaged",
  "faulty",
  "defective",
  "as is",
  "untested",
  "no power",
  "box only",
  "empty box",
  "case only",
  "manual only",
  "cover only",
  "charger only",
  "read description",
  "read desc",
  "please read",
  "icloud locked",
  "activation lock",
  "bad esn",
  "blacklisted",
  "replica",
  "dummy",
  "display model",
  "lot of",
  "bundle of",
  "photo only",
  "picture only",
];

export class TitleMatcher {
  readonly required: string[];
  readonly excluded: string[];
  private readonly junk: string[];
  private readonly compactQuery: string;

  /** 검색어에서 `-word` 는 제외어로 취급한다 (eBay 검색 문법과 동일). */
  constructor(query: string, extraExcludes: string[] = []) {
    const raw = query.split(/\s+/).filter(Boolean);
    this.excluded = [...raw.filter((w) => w.startsWith("-")).map((w) => normalizeTitle(w.slice(1))), ...extraExcludes.map(normalizeTitle)].filter(Boolean);
    this.required = tokens(raw.filter((w) => !w.startsWith("-")).join(" "));
    const q = normalizeTitle(query);
    this.junk = JUNK_PHRASES.filter((p) => !q.includes(p));
    this.compactQuery = this.required.join("");
  }

  matches(title: string): boolean {
    const norm = normalizeTitle(title);
    const set = new Set(norm.split(" "));
    const padded = ` ${norm} `;
    if (this.excluded.some((x) => padded.includes(` ${x} `))) return false;
    if (this.required.every((t) => set.has(t))) return true;
    // "iphone13" 처럼 붙여 쓴 제목 대비
    return norm.replace(/ /g, "").includes(this.compactQuery);
  }

  junkHit(title: string): string | undefined {
    const padded = ` ${normalizeTitle(title)} `;
    return this.junk.find((p) => padded.includes(` ${p} `));
  }
}

// ── 시세 추정 ────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface MarketEstimate {
  source: "sold" | "active";
  sampleSize: number;
  low: number; // 25%
  median: number;
  high: number; // 75%
  /** 빨리 팔리는 가격: 판매완료면 40%, 판매중 매물이면 30% 지점 */
  quickSale: number;
  /** (p75 - p25) / median. 작을수록 시세가 또렷하다. */
  dispersion: number;
  confidence: Confidence;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 판매중(active) 매물은 비싸게 걸어둔 채 안 팔리는 것들이 오래 남아 있어서 위로 치우친다.
 * 그래서 판매중 기준일 때는 아래쪽 30% 지점을 "빨리 팔리는 가격"으로 본다.
 */
export function estimateMarket(totals: number[], source: "sold" | "active"): MarketEstimate | undefined {
  const sorted = totals.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length < 3) return undefined;

  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const kept = sorted.filter((n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr);

  const median = percentile(kept, 0.5);
  const low = percentile(kept, 0.25);
  const high = percentile(kept, 0.75);
  const quickSale = percentile(kept, source === "sold" ? 0.4 : 0.3);
  const dispersion = median > 0 ? (high - low) / median : 1;

  // 판매중 매물만으로는 실제 체결가를 모르므로 한 단계 낮게 본다.
  let confidence: Confidence =
    kept.length >= 10 && dispersion <= 0.35 ? "high" : kept.length >= 5 && dispersion <= 0.6 ? "medium" : "low";
  if (source === "active" && confidence === "high") confidence = "medium";

  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    source,
    sampleSize: kept.length,
    low: r(low),
    median: r(median),
    high: r(high),
    quickSale: r(quickSale),
    dispersion: Math.round(dispersion * 1000) / 1000,
    confidence,
  };
}
