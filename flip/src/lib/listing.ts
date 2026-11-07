// 산 물건을 다시 eBay 에 올리는 흐름.
import type { InventoryItem, ListingDraft, Settings } from "./data";
import type { Item } from "./ebay/browse";
import type { Order } from "./ebay/sell";

/** Browse conditionId → Inventory API condition enum */
export const CONDITION_ENUM: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "3000": "USED_EXCELLENT",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

export const CONDITION_LABEL: Record<string, string> = {
  NEW: "새 제품",
  NEW_OTHER: "새 제품 (개봉)",
  NEW_WITH_DEFECTS: "새 제품 (하자)",
  CERTIFIED_REFURBISHED: "공식 리퍼",
  EXCELLENT_REFURBISHED: "리퍼 최상",
  VERY_GOOD_REFURBISHED: "리퍼 상",
  GOOD_REFURBISHED: "리퍼 중",
  SELLER_REFURBISHED: "판매자 리퍼",
  LIKE_NEW: "거의 새것",
  USED_EXCELLENT: "중고 최상",
  USED_VERY_GOOD: "중고 상",
  USED_GOOD: "중고 중",
  USED_ACCEPTABLE: "중고 하",
  FOR_PARTS_OR_NOT_WORKING: "부품용/고장",
};

/** eBay 등록 시 따로 넘기는 항목이라 aspects 에서는 뺀다 */
const SKIP_ASPECTS = new Set(["condition", "item condition"]);

export function aspectsFromItem(item: Pick<Item, "localizedAspects">): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of item.localizedAspects ?? []) {
    if (SKIP_ASPECTS.has(a.name.toLowerCase())) continue;
    const values = a.value.split(/\s*,\s*/).filter(Boolean).slice(0, 30);
    out[a.name] = [...new Set([...(out[a.name] ?? []), ...values])];
  }
  return out;
}

/**
 * 원래 판매자의 사진과 설명은 저작권이 그쪽에 있으므로 가져오지 않는다.
 * 제목·카테고리·스펙(aspects)만 가져오고, 사진은 물건이 도착하면 직접 찍어서 올린다.
 */
export function draftFromItem(item: Item, price: number): ListingDraft {
  const condition = CONDITION_ENUM[item.conditionId ?? "3000"] ?? "USED_EXCELLENT";
  const aspects = aspectsFromItem(item);
  const spec = Object.entries(aspects)
    .slice(0, 12)
    .map(([k, v]) => `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(v.join(", "))}</li>`)
    .join("");
  return {
    title: item.title.slice(0, 80),
    description: [
      `<p>${escapeHtml(item.title)}</p>`,
      spec ? `<ul>${spec}</ul>` : "",
      `<p>Condition: ${escapeHtml(item.condition ?? "Used")}. Please see photos for the exact item you will receive.</p>`,
      `<p>Ships within 1 business day, carefully packed.</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
    condition,
    categoryId: item.categoryId ?? "",
    aspects,
    price,
    imageUrls: [],
    brand: item.brand,
    mpn: item.mpn,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function validateDraft(d: ListingDraft, settings: Settings): string[] {
  const problems: string[] = [];
  if (!d.title.trim()) problems.push("제목이 비어 있어요.");
  if (d.title.length > 80) problems.push("제목은 80자까지예요.");
  if (!d.categoryId) problems.push("카테고리 ID 가 없어요.");
  if (!(d.price > 0)) problems.push("가격을 입력해 주세요.");
  if (d.imageUrls.length === 0) problems.push("직접 찍은 사진을 1장 이상 올려 주세요.");
  if (!settings.policies) problems.push("설정에서 배송·결제·반품 정책을 골라 주세요.");
  if (!settings.merchantLocationKey) problems.push("설정에서 발송지 주소를 저장해 주세요.");
  return problems;
}

export const skuFor = (item: Pick<InventoryItem, "id">) => `FLIP-${item.id.slice(0, 8).toUpperCase()}`;

/** 최근 주문 중 내 리스팅이 팔린 것을 찾는다. */
export function matchSales(items: InventoryItem[], orders: Order[]) {
  const matches: { item: InventoryItem; order: Order; saleTotal: number }[] = [];
  for (const item of items) {
    if (item.status !== "listed") continue;
    for (const order of orders) {
      if (order.orderPaymentStatus && order.orderPaymentStatus !== "PAID") continue;
      const line = order.lineItems.find((li) => (item.listingId && li.legacyItemId === item.listingId) || (item.sku && li.sku === item.sku));
      if (!line) continue;
      // 세금은 eBay 가 걷어서 내므로 빼고, 상품가 + 구매자 부담 배송비만 본다.
      const v = (a?: { value: string }) => (a ? Number.parseFloat(a.value) : 0);
      matches.push({ item, order, saleTotal: v(line.lineItemCost) + v(line.deliveryCost?.shippingCost) });
      break;
    }
  }
  return matches;
}
