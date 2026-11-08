// 검색 결과에서 "사서 되팔면 남는" 매물을 골라낸다.
import { computeProfit, type FeeSettings, type ProfitBreakdown } from "./fees";
import {
  conditionGroup,
  estimateMarket,
  listingTotal,
  TitleMatcher,
  type ConditionGroup,
  type Listing,
  type MarketEstimate,
} from "./comps";

/** 사냥 목록 한 줄: "이 검색어로, 이 상태로, 최소 얼마 남으면 알려줘" */
export interface Hunt {
  id: string;
  query: string;
  condition: ConditionGroup;
  categoryId?: string;
  /** 매입 총액 상한 (배송비 포함) */
  maxBuy?: number;
  minProfit: number;
  /** 0.25 = 25% */
  minRoi: number;
  /** 제목에 있으면 제외할 단어 */
  excludes: string[];
  createdAt: string;
  /** 누가 만들었나. Claude 는 자기가 만든 사냥만 고치거나 끌 수 있다. */
  source?: "me" | "claude";
  /** Claude 가 이 사냥을 고른 이유 */
  reason?: string;
}

export type Verdict = "buy" | "check" | "skip";

export interface DealReview {
  verdict: Verdict;
  reason: string;
  /** 같은 매물이라도 가격이 바뀌면 다시 본다 */
  price: number;
  reviewedAt: string;
}

export type DealWarning = "priceTooLow" | "lowFeedback" | "shipsFromAbroad" | "shippingUnknown" | "lowConfidence";

export const WARNING_LABEL: Record<DealWarning, string> = {
  priceTooLow: "시세의 40% 미만 — 사기·다른 물건일 수 있음",
  lowFeedback: "판매자 평점 낮음",
  shipsFromAbroad: "해외 발송",
  shippingUnknown: "배송비 미표시 (추정치 사용)",
  lowConfidence: "비교 매물이 적거나 시세가 들쭉날쭉",
};

const PENALTY: Record<DealWarning, number> = {
  priceTooLow: 0.3,
  lowFeedback: 0.7,
  shipsFromAbroad: 0.8,
  shippingUnknown: 0.85,
  lowConfidence: 0.6,
};

export interface Deal {
  huntId: string;
  listing: Listing;
  estimate: MarketEstimate;
  breakdown: ProfitBreakdown;
  warnings: DealWarning[];
  /** 정렬용: 순이익 × 신뢰도 보정 */
  score: number;
  review?: DealReview;
}

export interface ScanResult {
  huntId: string;
  estimate?: MarketEstimate;
  deals: Deal[];
  /** 왜 걸러졌는지 개수 (디버깅·튜닝용) */
  rejected: Record<string, number>;
  candidateCount: number;
  compCount: number;
  scannedAt: string;
  /** Claude 검토가 실패했을 때 이유 (딜은 그대로 보여줌) */
  reviewError?: string;
}

export interface EvaluateInput {
  hunt: Hunt;
  /** 싼 순·최신순으로 가져온 구매 후보 */
  candidates: Listing[];
  /** 시세 계산용 (판매중 매물, 기본 정렬) */
  activeComps: Listing[];
  /** 판매완료 매물 (Marketplace Insights 권한이 있을 때만) */
  soldComps?: Listing[];
  fees: FeeSettings;
  marketCountry: string;
}

export function compFilter(hunt: Hunt) {
  const matcher = new TitleMatcher(hunt.query, hunt.excludes);
  return (l: Listing): string | undefined => {
    if (!matcher.matches(l.title)) return "titleMismatch";
    if (matcher.junkHit(l.title)) return "junk";
    if (conditionGroup(l.conditionId) !== hunt.condition) return "condition";
    return undefined;
  };
}

export function evaluateDeals(input: EvaluateInput): ScanResult {
  const { hunt, fees } = input;
  const reject = compFilter(hunt);
  const rejected: Record<string, number> = {};
  const bump = (k: string) => (rejected[k] = (rejected[k] ?? 0) + 1);

  const usable = (l: Listing) => !reject(l) && l.buyingOptions.includes("FIXED_PRICE");
  const soldTotals = (input.soldComps ?? []).filter((l) => !reject(l)).map((l) => listingTotal(l) ?? l.price);
  const activeTotals = input.activeComps.filter(usable).map(listingTotal).filter((n): n is number => n !== undefined);

  const estimate = (soldTotals.length >= 5 ? estimateMarket(soldTotals, "sold") : undefined) ?? estimateMarket(activeTotals, "active");

  const base = {
    huntId: hunt.id,
    estimate,
    candidateCount: input.candidates.length,
    compCount: estimate?.sampleSize ?? 0,
    scannedAt: new Date().toISOString(),
  };
  if (!estimate) return { ...base, deals: [], rejected: { noEstimate: input.candidates.length } };

  const seen = new Set<string>();
  const deals: Deal[] = [];

  for (const l of input.candidates) {
    if (seen.has(l.itemId)) continue;
    seen.add(l.itemId);

    const why = reject(l);
    if (why) {
      bump(why);
      continue;
    }
    if (!l.buyingOptions.includes("FIXED_PRICE")) {
      bump("auctionOnly");
      continue;
    }

    const warnings: DealWarning[] = [];
    let buyShipping = l.shipping;
    if (buyShipping === undefined) {
      buyShipping = fees.unknownShippingEstimate;
      warnings.push("shippingUnknown");
    }
    const buyTotal = l.price + buyShipping;
    if (hunt.maxBuy !== undefined && buyTotal > hunt.maxBuy) {
      bump("overMaxBuy");
      continue;
    }

    const breakdown = computeProfit({ buyPrice: l.price, buyShipping, saleTotal: estimate.quickSale }, fees);
    if (breakdown.profit < hunt.minProfit) {
      bump("lowProfit");
      continue;
    }
    if (breakdown.roi < hunt.minRoi) {
      bump("lowRoi");
      continue;
    }

    if (buyTotal < estimate.median * 0.4) warnings.push("priceTooLow");
    if ((l.sellerFeedbackPercent !== undefined && l.sellerFeedbackPercent < 97) || (l.sellerFeedbackScore !== undefined && l.sellerFeedbackScore < 5)) {
      warnings.push("lowFeedback");
    }
    if (l.country && l.country !== input.marketCountry) warnings.push("shipsFromAbroad");
    if (estimate.confidence === "low") warnings.push("lowConfidence");

    const confidenceFactor = estimate.confidence === "high" ? 1 : estimate.confidence === "medium" ? 0.85 : 1;
    const score = warnings.reduce((s, w) => s * PENALTY[w], breakdown.profit * confidenceFactor);

    deals.push({ huntId: hunt.id, listing: l, estimate, breakdown, warnings, score: Math.round(score * 100) / 100 });
  }

  deals.sort((a, b) => b.score - a.score);
  return { ...base, deals, rejected };
}
