// 사냥 하나 = eBay 검색 3번 (시세용 기본정렬, 싼 순, 새로 올라온 순) + 판매완료(가능하면).
import { evaluateDeals, type Hunt, type ScanResult } from "./deals";
import { getSettings, listHunts, saveScan } from "./data";
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
