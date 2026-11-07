// Sell API: 내 계정으로 등록하고 주문을 확인한다. 전부 사용자 토큰이 필요하다.
import { ebayFetch } from "./client";
import { ebayConfig } from "./config";
import { userToken } from "./oauth";
import type { Amount } from "./browse";

export interface Policy {
  id: string;
  name: string;
}

export interface SellerPolicies {
  fulfillment: Policy[];
  payment: Policy[];
  return: Policy[];
}

export async function listPolicies(): Promise<SellerPolicies> {
  const cfg = ebayConfig();
  const token = await userToken();
  const q = { marketplace_id: cfg.marketplace.id };
  const [f, p, r] = await Promise.all([
    ebayFetch<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string }[] }>("/sell/account/v1/fulfillment_policy", { token, query: q }),
    ebayFetch<{ paymentPolicies?: { paymentPolicyId: string; name: string }[] }>("/sell/account/v1/payment_policy", { token, query: q }),
    ebayFetch<{ returnPolicies?: { returnPolicyId: string; name: string }[] }>("/sell/account/v1/return_policy", { token, query: q }),
  ]);
  return {
    fulfillment: (f.data.fulfillmentPolicies ?? []).map((x) => ({ id: x.fulfillmentPolicyId, name: x.name })),
    payment: (p.data.paymentPolicies ?? []).map((x) => ({ id: x.paymentPolicyId, name: x.name })),
    return: (r.data.returnPolicies ?? []).map((x) => ({ id: x.returnPolicyId, name: x.name })),
  };
}

export interface Location {
  merchantLocationKey: string;
  name?: string;
}

export async function listLocations(): Promise<Location[]> {
  const { data } = await ebayFetch<{ locations?: Location[] }>("/sell/inventory/v1/location", { token: await userToken() });
  return data.locations ?? [];
}

export interface Address {
  city: string;
  stateOrProvince?: string;
  postalCode: string;
  country: string;
}

export async function createLocation(key: string, address: Address): Promise<void> {
  await ebayFetch(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
    method: "POST",
    token: await userToken(),
    body: { location: { address }, locationTypes: ["WAREHOUSE"], name: "Flip", merchantLocationStatus: "ENABLED" },
  });
}

/** 내가 찍은 사진을 eBay 이미지 서버(EPS)에 올리고 URL 을 받는다. */
export async function uploadImage(file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", file, filename);
  const token = await userToken();
  const res = await ebayFetch<{ imageUrl?: string }>("/commerce/media/v1_beta/image/create_image_from_file", {
    method: "POST",
    base: "media",
    token,
    body: form,
  });
  if (res.data?.imageUrl) return res.data.imageUrl;
  const location = res.headers.get("location");
  if (!location) throw new Error("eBay 가 업로드한 이미지 위치를 돌려주지 않았습니다.");
  const imageId = location.split("/").pop()!;
  const { data } = await ebayFetch<{ imageUrl: string }>(`/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`, {
    base: "media",
    token,
  });
  return data.imageUrl;
}

export interface InventoryItemBody {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: string;
  conditionDescription?: string;
  product: {
    title: string;
    description: string;
    aspects?: Record<string, string[]>;
    imageUrls: string[];
    brand?: string;
    mpn?: string;
    upc?: string[];
  };
}

export async function putInventoryItem(sku: string, body: InventoryItemBody) {
  await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", token: await userToken(), body });
}

export interface OfferBody {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingPolicies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
  pricingSummary: { price: Amount };
  merchantLocationKey: string;
}

export async function createOffer(body: OfferBody): Promise<string> {
  const { data } = await ebayFetch<{ offerId: string }>("/sell/inventory/v1/offer", { method: "POST", token: await userToken(), body });
  return data.offerId;
}

export async function updateOffer(offerId: string, body: OfferBody) {
  await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { method: "PUT", token: await userToken(), body });
}

export async function publishOffer(offerId: string): Promise<string> {
  const { data } = await ebayFetch<{ listingId: string }>(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
    method: "POST",
    token: await userToken(),
  });
  return data.listingId;
}

export async function withdrawOffer(offerId: string) {
  await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, { method: "POST", token: await userToken() });
}

export interface Order {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  pricingSummary?: { total?: Amount; priceSubtotal?: Amount; deliveryCost?: Amount };
  lineItems: {
    lineItemId: string;
    legacyItemId?: string;
    sku?: string;
    title?: string;
    lineItemCost?: Amount;
    deliveryCost?: { shippingCost?: Amount };
    total?: Amount;
  }[];
  buyer?: { username?: string };
}

export async function recentOrders(days = 30): Promise<Order[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await ebayFetch<{ orders?: Order[] }>("/sell/fulfillment/v1/order", {
    token: await userToken(),
    query: { filter: `creationdate:[${since}..]`, limit: 200 },
  });
  return data.orders ?? [];
}
