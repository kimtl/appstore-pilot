// 앱 데이터: 사냥 목록, 최근 스캔 결과, 재고(산 물건), 설정.
import { randomUUID } from "node:crypto";
import { kv } from "./store";
import { DEFAULT_FEES, type FeeSettings } from "./fees";
import type { Hunt, ScanResult } from "./deals";
import type { Address } from "./ebay/sell";

export interface Settings {
  fees: FeeSettings;
  policies?: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
  merchantLocationKey?: string;
  address?: Address;
}

export interface ListingDraft {
  title: string;
  description: string;
  /** Inventory API condition enum (USED_EXCELLENT 등) */
  condition: string;
  conditionDescription?: string;
  categoryId: string;
  aspects: Record<string, string[]>;
  price: number;
  imageUrls: string[];
  brand?: string;
  mpn?: string;
}

export type ItemStatus = "bought" | "listed" | "sold" | "cancelled";

export interface InventoryItem {
  id: string;
  status: ItemStatus;
  title: string;
  imageUrl?: string;
  sourceItemId: string;
  sourceUrl?: string;
  currency: string;
  boughtAt: string;
  buyPrice: number;
  buyShipping: number;
  buyTax: number;
  /** 살 때 본 '빨리 팔리는 가격' */
  expectedSale?: number;
  draft?: ListingDraft;
  sku?: string;
  offerId?: string;
  listingId?: string;
  listedAt?: string;
  lastError?: string;
  soldAt?: string;
  /** 구매자가 낸 총액 (세금 제외) */
  saleTotal?: number;
  /** 실제 라벨 비용 */
  actualShipping?: number;
  orderId?: string;
  notes?: string;
}

export const itemCost = (i: InventoryItem) => i.buyPrice + i.buyShipping + i.buyTax;

// ── 설정 ─────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const s = await kv().get<Settings>("settings");
  return { ...s, fees: { ...DEFAULT_FEES, ...s?.fees } };
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await kv().set("settings", { ...cur, ...patch });
}

// ── 사냥 목록 ────────────────────────────────────

export async function listHunts(): Promise<Hunt[]> {
  return (await kv().get<Hunt[]>("hunts")) ?? [];
}

export async function saveHunt(h: Omit<Hunt, "id" | "createdAt"> & { id?: string }): Promise<Hunt> {
  const hunts = await listHunts();
  const existing = h.id ? hunts.find((x) => x.id === h.id) : undefined;
  const hunt: Hunt = { ...h, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? new Date().toISOString() };
  await kv().set("hunts", existing ? hunts.map((x) => (x.id === hunt.id ? hunt : x)) : [...hunts, hunt]);
  return hunt;
}

export async function deleteHunt(id: string) {
  await kv().set("hunts", (await listHunts()).filter((h) => h.id !== id));
  await kv().del(`scan-${id}`);
}

export async function getScan(huntId: string) {
  return kv().get<ScanResult>(`scan-${huntId}`);
}

export async function saveScan(scan: ScanResult) {
  await kv().set(`scan-${scan.huntId}`, scan);
}

// ── 재고 ─────────────────────────────────────────

export async function listInventory(): Promise<InventoryItem[]> {
  return (await kv().get<InventoryItem[]>("inventory")) ?? [];
}

export async function getInventoryItem(id: string) {
  return (await listInventory()).find((i) => i.id === id);
}

export async function addInventoryItem(item: Omit<InventoryItem, "id">): Promise<InventoryItem> {
  const full = { ...item, id: randomUUID() };
  await kv().set("inventory", [full, ...(await listInventory())]);
  return full;
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryItem>): Promise<InventoryItem> {
  const items = await listInventory();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error("재고에 없는 물건입니다.");
  items[idx] = { ...items[idx], ...patch };
  await kv().set("inventory", items);
  return items[idx];
}

export async function deleteInventoryItem(id: string) {
  await kv().set("inventory", (await listInventory()).filter((i) => i.id !== id));
}
