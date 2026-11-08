import { describe, expect, it } from "vitest";
import { aspectsFromItem, draftFromItem, matchSales, validateDraft } from "./listing";
import { toListing, buildFilter } from "./ebay/browse";
import { extractCode } from "./ebay/oauth";
import { DEFAULT_FEES } from "./fees";
import { DEFAULT_AI, type InventoryItem } from "./data";

describe("toListing", () => {
  it("Browse 검색 결과 한 줄을 정리한다", () => {
    const l = toListing({
      itemId: "v1|1234|0",
      legacyItemId: "1234",
      title: "Sony WH-1000XM4",
      price: { value: "120.50", currency: "USD" },
      shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "8.99", currency: "USD" } }],
      conditionId: "3000",
      seller: { username: "bob", feedbackPercentage: "99.1", feedbackScore: 1200 },
      buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
      itemLocation: { country: "US" },
      categories: [{ categoryId: "112529" }],
    });
    expect(l).toMatchObject({ price: 120.5, shipping: 8.99, sellerFeedbackPercent: 99.1, categoryId: "112529", country: "US" });
  });

  it("계산형 배송은 배송비를 모른다고 표시한다", () => {
    const l = toListing({ itemId: "x", title: "t", price: { value: "1", currency: "USD" }, shippingOptions: [{ shippingCostType: "CALCULATED" }] });
    expect(l.shipping).toBeUndefined();
  });

  it("검색 필터 문자열", () => {
    expect(buildFilter({ query: "x", condition: "new", maxPrice: 300 }, "USD", "US")).toBe(
      "conditionIds:{1000|1500|1750},deliveryCountry:US,buyingOptions:{FIXED_PRICE},price:[..300],priceCurrency:USD",
    );
  });
});

describe("extractCode", () => {
  it("eBay 완료 페이지 주소에서 code 를 꺼낸다", () => {
    expect(extractCode("https://auth2.ebay.com/oauth2/ThirdPartyAuthSucessFailure?isAuthSuccessful=true&code=v%5E1.1%23abc&expires_in=299")).toBe("v^1.1#abc");
    expect(extractCode("v%5E1.1%23abc")).toBe("v^1.1#abc");
    expect(extractCode("  ")).toBeUndefined();
  });
});

describe("draftFromItem", () => {
  const item = {
    itemId: "v1|1|0",
    title: "Sony WH-1000XM4 Wireless Noise Canceling Headphones - Black - Excellent condition with case",
    categoryId: "112529",
    conditionId: "4000",
    condition: "Used",
    localizedAspects: [
      { name: "Brand", value: "Sony" },
      { name: "Color", value: "Black, Silver" },
      { name: "Condition", value: "Used" },
    ],
  };

  it("제목은 80자로 자르고 상태·스펙을 옮기되 사진은 비워둔다", () => {
    const d = draftFromItem(item, 199);
    expect(d.title.length).toBeLessThanOrEqual(80);
    expect(d.condition).toBe("USED_VERY_GOOD");
    expect(d.aspects).toEqual({ Brand: ["Sony"], Color: ["Black", "Silver"] });
    expect(d.imageUrls).toEqual([]);
    expect(d.price).toBe(199);
  });

  it("aspectsFromItem 은 같은 이름을 합친다", () => {
    expect(aspectsFromItem({ localizedAspects: [{ name: "A", value: "x" }, { name: "A", value: "y, x" }] })).toEqual({ A: ["x", "y"] });
  });

  it("사진·정책·발송지가 없으면 등록을 막는다", () => {
    const problems = validateDraft(draftFromItem(item, 199), { fees: DEFAULT_FEES, ai: DEFAULT_AI });
    expect(problems).toHaveLength(3);
  });
});

describe("matchSales", () => {
  const base: InventoryItem = {
    id: "i1",
    status: "listed",
    title: "t",
    sourceItemId: "s",
    currency: "USD",
    boughtAt: "",
    buyPrice: 100,
    buyShipping: 0,
    buyTax: 0,
    listingId: "3555",
    sku: "FLIP-1",
  };
  it("리스팅 ID 로 주문을 찾아 상품가 + 배송비를 판매액으로 잡는다", () => {
    const m = matchSales(
      [base, { ...base, id: "i2", listingId: "999", sku: "FLIP-2" }],
      [
        {
          orderId: "o1",
          creationDate: "2026-11-01",
          orderPaymentStatus: "PAID",
          lineItems: [{ lineItemId: "l", legacyItemId: "3555", lineItemCost: { value: "180.00", currency: "USD" }, deliveryCost: { shippingCost: { value: "12.00", currency: "USD" } } }],
        },
        { orderId: "o2", creationDate: "2026-11-02", orderPaymentStatus: "PENDING", lineItems: [{ lineItemId: "l2", legacyItemId: "999" }] },
      ],
    );
    expect(m).toHaveLength(1);
    expect(m[0].saleTotal).toBe(192);
  });
});

import { itemProfit, portfolio } from "./pnl";

describe("pnl", () => {
  const sold: InventoryItem = {
    id: "a", status: "sold", title: "t", sourceItemId: "s", currency: "USD", boughtAt: "",
    buyPrice: 100, buyShipping: 10, buyTax: 7.7, saleTotal: 200, actualShipping: 12,
  };
  it("팔린 물건은 실제 판매액과 실제 라벨비로 계산하고 매입 세금은 기록된 값을 쓴다", () => {
    const p = itemProfit(sold, DEFAULT_FEES);
    // 200 - 29.10 - 0.40 - 12 - 1 = 157.50 ; cost 117.70
    expect(p.proceeds).toBe(157.5);
    expect(p.profit).toBe(39.8);
  });
  it("portfolio 는 취소된 건 빼고 합산", () => {
    const open: InventoryItem = { ...sold, id: "b", status: "bought", saleTotal: undefined, expectedSale: 200 };
    const cancelled: InventoryItem = { ...sold, id: "c", status: "cancelled" };
    const s = portfolio([sold, open, cancelled], DEFAULT_FEES);
    expect(s.realizedProfit).toBe(39.8);
    expect(s.openCost).toBe(117.7);
    expect(s.soldCount).toBe(1);
  });
});
