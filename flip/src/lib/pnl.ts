import { computeProfit, type FeeSettings } from "./fees";
import { itemCost, type InventoryItem } from "./data";

/** 팔린 물건의 실제 이익 (실제 판매액·실제 라벨비가 있으면 그걸 쓴다). 안 팔렸으면 예상치. */
export function itemProfit(item: InventoryItem, fees: FeeSettings) {
  const saleTotal = item.saleTotal ?? item.draft?.price ?? item.expectedSale ?? 0;
  const b = computeProfit(
    { buyPrice: item.buyPrice, buyShipping: item.buyShipping, saleTotal },
    { ...fees, purchaseTaxRate: 0, outboundShipping: item.actualShipping ?? fees.outboundShipping },
  );
  const cost = itemCost(item);
  const profit = Math.round((b.proceeds - cost) * 100) / 100;
  return { ...b, cost, purchaseTax: item.buyTax, profit, roi: cost > 0 ? profit / cost : 0, realized: item.status === "sold" };
}

export function portfolio(items: InventoryItem[], fees: FeeSettings) {
  let invested = 0;
  let realized = 0;
  let expected = 0;
  let soldCount = 0;
  for (const i of items) {
    if (i.status === "cancelled") continue;
    const p = itemProfit(i, fees);
    if (i.status === "sold") {
      realized += p.profit;
      soldCount++;
    } else {
      invested += p.cost;
      expected += p.profit;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { openCost: r(invested), realizedProfit: r(realized), expectedProfit: r(expected), soldCount };
}
