import { describe, expect, it } from "vitest";
import { evaluateDeals, type Hunt } from "./deals";
import { DEFAULT_FEES } from "./fees";
import type { Listing } from "./comps";

const hunt: Hunt = {
  id: "h1",
  query: "nintendo switch oled",
  condition: "used",
  minProfit: 20,
  minRoi: 0.2,
  excludes: [],
  createdAt: "2026-01-01",
};

let n = 0;
const L = (title: string, price: number, extra: Partial<Listing> = {}): Listing => ({
  itemId: `v1|${++n}|0`,
  title,
  price,
  shipping: 0,
  currency: "USD",
  conditionId: "3000",
  buyingOptions: ["FIXED_PRICE"],
  country: "US",
  sellerFeedbackPercent: 99.5,
  sellerFeedbackScore: 500,
  ...extra,
});

const comps = [250, 255, 260, 262, 265, 268, 270, 275, 280, 285, 290].map((p) => L("Nintendo Switch OLED White", p));

describe("evaluateDeals", () => {
  it("시세보다 충분히 싼 매물만 남기고 이익 순으로 정렬한다", () => {
    const r = evaluateDeals({
      hunt,
      activeComps: comps,
      candidates: [
        L("Nintendo Switch OLED Neon", 150),
        L("Nintendo Switch OLED console", 160),
        L("Nintendo Switch OLED", 240), // 이익 부족
        L("Nintendo Switch OLED FOR PARTS", 60), // 정크
        L("Nintendo Switch Lite", 90), // 다른 물건
        L("Nintendo Switch OLED", 140, { conditionId: "1000" }), // 상태 다름
        L("Nintendo Switch OLED", 140, { buyingOptions: ["AUCTION"] }), // 즉시구매 불가
      ],
      fees: DEFAULT_FEES,
      marketCountry: "US",
    });
    expect(r.estimate?.source).toBe("active");
    expect(r.deals.map((d) => d.listing.price)).toEqual([150, 160]);
    expect(r.rejected).toMatchObject({ lowProfit: 1, junk: 1, titleMismatch: 1, condition: 1, auctionOnly: 1 });
    expect(r.deals[0].breakdown.profit).toBeGreaterThan(r.deals[1].breakdown.profit);
  });

  it("말도 안 되게 싸거나 평점이 낮으면 경고를 달고 점수를 깎는다", () => {
    const r = evaluateDeals({
      hunt,
      activeComps: comps,
      candidates: [
        L("Nintendo Switch OLED", 80),
        L("Nintendo Switch OLED", 150, { sellerFeedbackPercent: 90, country: "CN", shipping: undefined }),
      ],
      fees: DEFAULT_FEES,
      marketCountry: "US",
    });
    const tooCheap = r.deals.find((d) => d.listing.price === 80)!;
    expect(tooCheap.warnings).toContain("priceTooLow");
    const sketchy = r.deals.find((d) => d.listing.price === 150)!;
    expect(sketchy.warnings).toEqual(expect.arrayContaining(["lowFeedback", "shipsFromAbroad", "shippingUnknown"]));
    expect(sketchy.breakdown.buyShipping).toBe(DEFAULT_FEES.unknownShippingEstimate);
  });

  it("판매완료 데이터가 있으면 그걸 우선 쓴다", () => {
    const sold = [200, 205, 210, 215, 220].map((p) => L("Nintendo Switch OLED", p));
    const r = evaluateDeals({ hunt, activeComps: comps, soldComps: sold, candidates: [], fees: DEFAULT_FEES, marketCountry: "US" });
    expect(r.estimate?.source).toBe("sold");
    expect(r.estimate?.median).toBe(210);
  });

  it("매입 상한을 넘으면 제외", () => {
    const r = evaluateDeals({
      hunt: { ...hunt, maxBuy: 160 },
      activeComps: comps,
      candidates: [L("Nintendo Switch OLED", 150, { shipping: 15 })],
      fees: DEFAULT_FEES,
      marketCountry: "US",
    });
    expect(r.deals).toHaveLength(0);
    expect(r.rejected.overMaxBuy).toBe(1);
  });

  it("비교 매물이 없으면 딜을 내지 않는다", () => {
    const r = evaluateDeals({ hunt, activeComps: [], candidates: [L("Nintendo Switch OLED", 10)], fees: DEFAULT_FEES, marketCountry: "US" });
    expect(r.deals).toHaveLength(0);
    expect(r.estimate).toBeUndefined();
  });
});
