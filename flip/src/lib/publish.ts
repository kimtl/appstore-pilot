import { getInventoryItem, getSettings, listInventory, saveSettings, updateInventoryItem, type InventoryItem } from "./data";
import { ebayConfig } from "./ebay/config";
import { createLocation, createOffer, listLocations, publishOffer, putInventoryItem, recentOrders, updateOffer, type Address, type OfferBody } from "./ebay/sell";
import { matchSales, skuFor, validateDraft } from "./listing";

export const LOCATION_KEY = "flip-home";

export async function saveShipFrom(address: Address) {
  const existing = await listLocations();
  if (!existing.some((l) => l.merchantLocationKey === LOCATION_KEY)) await createLocation(LOCATION_KEY, address);
  await saveSettings({ address, merchantLocationKey: LOCATION_KEY });
}

export async function publishInventoryItem(id: string): Promise<InventoryItem> {
  const item = await getInventoryItem(id);
  if (!item?.draft) throw new Error("등록 초안이 없습니다.");
  const settings = await getSettings();
  const problems = validateDraft(item.draft, settings);
  if (problems.length) throw new Error(problems.join(" "));

  const cfg = ebayConfig();
  const d = item.draft;
  const sku = item.sku ?? skuFor(item);

  try {
    await putInventoryItem(sku, {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: d.condition,
      conditionDescription: d.conditionDescription || undefined,
      product: {
        title: d.title,
        description: d.description,
        aspects: Object.keys(d.aspects).length ? d.aspects : undefined,
        imageUrls: d.imageUrls,
        brand: d.brand,
        mpn: d.mpn,
      },
    });

    const offer: OfferBody = {
      sku,
      marketplaceId: cfg.marketplace.id,
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId: d.categoryId,
      listingDescription: d.description,
      listingPolicies: settings.policies!,
      pricingSummary: { price: { value: d.price.toFixed(2), currency: cfg.marketplace.currency } },
      merchantLocationKey: settings.merchantLocationKey!,
    };

    // 이전에 오퍼까지 만들고 게시에서 실패했다면 같은 오퍼를 고쳐서 다시 게시한다.
    let offerId = item.offerId;
    if (offerId) await updateOffer(offerId, offer);
    else offerId = await createOffer(offer);
    await updateInventoryItem(id, { sku, offerId });

    const listingId = item.listingId ?? (await publishOffer(offerId));
    return updateInventoryItem(id, { status: "listed", sku, offerId, listingId, listedAt: new Date().toISOString(), lastError: undefined });
  } catch (e) {
    await updateInventoryItem(id, { sku, lastError: (e as Error).message });
    throw e;
  }
}

/** 이미 게시된 리스팅의 가격만 바꾼다 (오퍼 수정은 게시된 리스팅에 바로 반영됨). */
export async function repriceInventoryItem(id: string, price: number) {
  const item = await getInventoryItem(id);
  if (!item?.draft || !item.offerId) throw new Error("게시된 오퍼가 없습니다.");
  const draft = { ...item.draft, price };
  await updateInventoryItem(id, { draft });
  const settings = await getSettings();
  const cfg = ebayConfig();
  await updateOffer(item.offerId, {
    sku: item.sku!,
    marketplaceId: cfg.marketplace.id,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: draft.categoryId,
    listingDescription: draft.description,
    listingPolicies: settings.policies!,
    pricingSummary: { price: { value: price.toFixed(2), currency: cfg.marketplace.currency } },
    merchantLocationKey: settings.merchantLocationKey!,
  });
}

export async function syncSales() {
  const listed = (await listInventory()).filter((i) => i.status === "listed");
  if (!listed.length) return [];
  const matches = matchSales(listed, await recentOrders(60));
  for (const m of matches) {
    await updateInventoryItem(m.item.id, {
      status: "sold",
      soldAt: m.order.creationDate,
      saleTotal: m.saleTotal,
      orderId: m.order.orderId,
    });
  }
  return matches.map((m) => ({ id: m.item.id, title: m.item.title, saleTotal: m.saleTotal }));
}
