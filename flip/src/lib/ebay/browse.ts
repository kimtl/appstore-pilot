// Browse API (판매중 매물 검색) + Marketplace Insights (판매완료, 승인된 키에서만).
import { CONDITION_IDS, type ConditionGroup, type Listing } from "../comps";
import { ebayFetch, EbayApiError } from "./client";
import { ebayConfig, INSIGHTS_SCOPE } from "./config";
import { appToken, EbayAuthError } from "./oauth";

export interface Amount {
  value: string;
  currency: string;
}

export interface ItemSummary {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price?: Amount;
  currentBidPrice?: Amount;
  shippingOptions?: { shippingCostType?: string; shippingCost?: Amount }[];
  condition?: string;
  conditionId?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  itemWebUrl?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  buyingOptions?: string[];
  itemLocation?: { country?: string; postalCode?: string };
  categories?: { categoryId?: string; categoryName?: string }[];
  // item_sales/search 전용
  lastSoldPrice?: Amount;
  lastSoldDate?: string;
}

export interface SearchResponse {
  total?: number;
  next?: string;
  itemSummaries?: ItemSummary[];
  itemSales?: ItemSummary[];
}

export interface Item {
  itemId: string;
  legacyItemId?: string;
  title: string;
  shortDescription?: string;
  price?: Amount;
  categoryId?: string;
  categoryPath?: string;
  condition?: string;
  conditionId?: string;
  conditionDescription?: string;
  brand?: string;
  mpn?: string;
  gtin?: string;
  image?: { imageUrl?: string };
  additionalImages?: { imageUrl?: string }[];
  localizedAspects?: { name: string; value: string }[];
  itemWebUrl?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[];
}

const num = (a?: Amount) => (a ? Number.parseFloat(a.value) : undefined);

export function toListing(s: ItemSummary): Listing {
  const priceAmt = s.lastSoldPrice ?? s.price ?? s.currentBidPrice;
  const ship = s.shippingOptions?.find((o) => o.shippingCost) ?? s.shippingOptions?.[0];
  let shipping: number | undefined;
  if (ship?.shippingCost) shipping = num(ship.shippingCost);
  else if (ship?.shippingCostType === "FIXED") shipping = 0;
  return {
    itemId: s.itemId,
    legacyItemId: s.legacyItemId,
    title: s.title,
    price: num(priceAmt) ?? 0,
    shipping,
    currency: priceAmt?.currency ?? "USD",
    conditionId: s.conditionId,
    condition: s.condition,
    imageUrl: s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl,
    webUrl: s.itemWebUrl,
    sellerName: s.seller?.username,
    sellerFeedbackPercent: s.seller?.feedbackPercentage ? Number.parseFloat(s.seller.feedbackPercentage) : undefined,
    sellerFeedbackScore: s.seller?.feedbackScore,
    country: s.itemLocation?.country,
    buyingOptions: s.buyingOptions ?? (s.lastSoldPrice ? ["FIXED_PRICE"] : []),
    categoryId: s.categories?.[0]?.categoryId,
    soldDate: s.lastSoldDate,
  };
}

export interface SearchParams {
  query: string;
  condition: ConditionGroup;
  categoryId?: string;
  sort?: "price" | "newlyListed" | "endingSoonest";
  maxPrice?: number;
  limit?: number;
  fixedPriceOnly?: boolean;
}

export function buildFilter(p: SearchParams, currency: string, country: string): string {
  const f = [`conditionIds:{${CONDITION_IDS[p.condition].join("|")}}`, `deliveryCountry:${country}`];
  if (p.fixedPriceOnly !== false) f.push("buyingOptions:{FIXED_PRICE}");
  if (p.maxPrice !== undefined) f.push(`price:[..${p.maxPrice}]`, `priceCurrency:${currency}`);
  return f.join(",");
}

export async function searchActive(p: SearchParams): Promise<Listing[]> {
  const cfg = ebayConfig();
  const { data } = await ebayFetch<SearchResponse>("/buy/browse/v1/item_summary/search", {
    token: await appToken(),
    query: {
      q: p.query,
      category_ids: p.categoryId,
      filter: buildFilter(p, cfg.marketplace.currency, cfg.marketplace.country),
      sort: p.sort,
      limit: p.limit ?? 100,
    },
  });
  return (data.itemSummaries ?? []).map(toListing);
}

/** 판매완료 시세. 키에 Marketplace Insights 권한이 없으면 undefined (판매중 매물로 대신 추정). */
let insightsDenied = false;
export async function searchSold(p: SearchParams): Promise<Listing[] | undefined> {
  if (insightsDenied || process.env.EBAY_USE_INSIGHTS !== "1") return undefined;
  const cfg = ebayConfig();
  try {
    const { data } = await ebayFetch<SearchResponse>("/buy/marketplace_insights/v1_beta/item_sales/search", {
      token: await appToken(INSIGHTS_SCOPE),
      query: {
        q: p.query,
        category_ids: p.categoryId,
        filter: `conditionIds:{${CONDITION_IDS[p.condition].join("|")}}`,
        limit: 200,
      },
    });
    return (data.itemSales ?? []).map(toListing);
  } catch (e) {
    if (e instanceof EbayAuthError || (e instanceof EbayApiError && (e.status === 403 || e.status === 401))) {
      insightsDenied = true;
      return undefined;
    }
    throw e;
  }
}

export async function getItem(itemId: string): Promise<Item> {
  const { data } = await ebayFetch<Item>(`/buy/browse/v1/item/${encodeURIComponent(itemId)}`, { token: await appToken() });
  return data;
}

/** 레거시 숫자 ID(주소창의 /itm/123456) → Browse itemId */
export async function getItemByLegacyId(legacyId: string): Promise<Item> {
  const { data } = await ebayFetch<Item>("/buy/browse/v1/item/get_item_by_legacy_id", {
    token: await appToken(),
    query: { legacy_item_id: legacyId },
  });
  return data;
}
