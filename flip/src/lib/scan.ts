// 사냥 하나 = eBay 검색 3번 (시세용 기본정렬, 싼 순, 새로 올라온 순) + 판매완료(가능하면).
import { compFilter, evaluateDeals, type Hunt, type ScanResult } from "./deals";
import { estimateMarket, listingTotal, type ConditionGroup } from "./comps";
import { maxBuyFor } from "./fees";
import { getScan, getSettings, listHunts, saveScan } from "./data";
import { aiConfigured } from "./ai/claude";
import { rankReviewed, reviewDeals } from "./ai/review";
import { searchActive, searchSold } from "./ebay/browse";
import { ebayConfig } from "./ebay/config";

export async function runHunt(hunt: Hunt): Promise<ScanResult> {
  const settings = await getSettings();
  const cfg = ebayConfig();
  const base = { query: hunt.query, condition: hunt.condition, categoryId: hunt.categoryId };

  const [activeComps, cheapest, newest, soldComps] = await Promise.all([
    searchActive({ ...base, limit: 200 }),
    searchActive({ ...base, sort: "price", limit: 100, maxPrice: hunt.maxBuy }),
    searchActive({ ...base, sort: "newlyListed", limit: 100, maxPrice: hunt.maxBuy }),
    searchSold(base),
  ]);

  const result = evaluateDeals({
    hunt,
    candidates: [...newest, ...cheapest],
    activeComps,
    soldComps,
    fees: settings.fees,
    marketCountry: cfg.marketplace.country,
  });

  if (aiConfigured() && result.deals.length) {
    const prev = await getScan(hunt.id);
    const previous = new Map((prev?.deals ?? []).filter((d) => d.review).map((d) => [d.listing.itemId, d.review!]));
    const reviewed = await reviewDeals(hunt, result.deals, previous);
    result.deals = rankReviewed(reviewed.deals);
    result.reviewError = reviewed.error;
  }

  await saveScan(result);
  return result;
}

export async function runAllHunts() {
  const hunts = await listHunts();
  const results: ScanResult[] = [];
  const errors: { huntId: string; message: string }[] = [];
  // Browse API 일일 한도(기본 5,000회)를 생각해서 순차 실행
  for (const h of hunts) {
    try {
      results.push(await runHunt(h));
    } catch (e) {
      errors.push({ huntId: h.id, message: (e as Error).message });
    }
  }
  return { results, errors };
}

/**
 * Claude 가 "이 물건 사냥할 만한가?"를 확인할 때 쓰는 시세 탐색.
 * 사냥과 같은 필터로 비교 매물을 추리고, 지금 바로 딜이 될 만한 싼 매물이 몇 개인지도 센다.
 */
export async function probeMarket(query: string, condition: ConditionGroup, minProfit: number) {
  const settings = await getSettings();
  const hunt: Hunt = { id: "probe", query, condition, minProfit, minRoi: 0, excludes: [], createdAt: "" };
  const [active, sold] = await Promise.all([searchActive({ query, condition, limit: 200 }), searchSold({ query, condition })]);
  const rejectReason = compFilter(hunt);
  const usable = active.filter((l) => !rejectReason(l) && l.buyingOptions.includes("FIXED_PRICE"));
  const totals = usable.map(listingTotal).filter((n): n is number => n !== undefined);
  const soldTotals = (sold ?? []).filter((l) => !rejectReason(l)).map((l) => listingTotal(l) ?? l.price);
  const estimate = (soldTotals.length >= 5 ? estimateMarket(soldTotals, "sold") : undefined) ?? estimateMarket(totals, "active");
  const maxBuy = estimate ? maxBuyFor(estimate.quickSale, minProfit, settings.fees) : undefined;
  return {
    query,
    condition,
    rawResults: active.length,
    comparableListings: usable.length,
    rejectedAsOtherOrJunk: active.length - usable.length,
    soldDataAvailable: sold !== undefined,
    estimate,
    /** 이 가격 이하(배송 포함)로 사야 minProfit 이 남는다 */
    maxBuyForTargetProfit: maxBuy,
    /** 지금 그 가격 이하로 올라온 매물 수 */
    listingsUnderMaxBuyNow: maxBuy === undefined ? 0 : totals.filter((t) => t <= maxBuy).length,
    cheapestTotals: [...totals].sort((a, b) => a - b).slice(0, 5),
    sampleTitles: usable.slice(0, 5).map((l) => l.title),
  };
}
