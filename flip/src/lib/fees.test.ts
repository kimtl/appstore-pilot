import { describe, expect, it } from "vitest";
import { computeProfit, DEFAULT_FEES, maxBuyFor } from "./fees";

describe("computeProfit", () => {
  it("$200 에 팔고 $100 에 산 경우를 손으로 계산한 값과 맞춘다", () => {
    const b = computeProfit({ buyPrice: 90, buyShipping: 10, saleTotal: 200 }, DEFAULT_FEES);
    expect(b.purchaseTax).toBe(7); // 100 × 7%
    expect(b.cost).toBe(107);
    expect(b.finalValueFee).toBe(29.1); // 200 × 1.07 × 13.6% = 29.104
    expect(b.perOrderFee).toBe(0.4);
    expect(b.proceeds).toBe(159.5); // 200 - 29.10 - 0.40 - 10 - 1
    expect(b.profit).toBe(52.5);
    expect(b.roi).toBeCloseTo(52.5 / 107);
  });

  it("$10 이하 주문은 주문당 수수료가 낮다", () => {
    expect(computeProfit({ buyPrice: 1, buyShipping: 0, saleTotal: 9 }, DEFAULT_FEES).perOrderFee).toBe(0.3);
  });

  it("광고비율을 넣으면 그만큼 줄어든다", () => {
    const plain = computeProfit({ buyPrice: 50, buyShipping: 0, saleTotal: 100 }, DEFAULT_FEES);
    const ads = computeProfit({ buyPrice: 50, buyShipping: 0, saleTotal: 100 }, { ...DEFAULT_FEES, promotedRate: 0.05 });
    expect(plain.profit - ads.profit).toBeCloseTo(5.35, 2);
  });
});

describe("maxBuyFor", () => {
  it("역산한 매입가로 사면 목표 이익이 남는다", () => {
    const max = maxBuyFor(200, 30, DEFAULT_FEES);
    const b = computeProfit({ buyPrice: max, buyShipping: 0, saleTotal: 200 }, DEFAULT_FEES);
    expect(b.profit).toBeGreaterThanOrEqual(29.98);
    expect(b.profit).toBeLessThanOrEqual(30.02);
  });
});
