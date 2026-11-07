"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, requireLogin, SESSION_COOKIE } from "@/lib/auth";
import {
  addInventoryItem,
  deleteHunt,
  deleteInventoryItem,
  getInventoryItem,
  getScan,
  getSettings,
  listHunts,
  saveHunt,
  saveSettings,
  updateInventoryItem,
  type ListingDraft,
} from "@/lib/data";
import type { ConditionGroup } from "@/lib/comps";
import { DEFAULT_FEES, type FeeSettings } from "@/lib/fees";
import { getItem, getItemByLegacyId, type Item } from "@/lib/ebay/browse";
import { ebayConfig } from "@/lib/ebay/config";
import { authorizeUrl, disconnectUser, exchangeCode, extractCode } from "@/lib/ebay/oauth";
import { uploadImage } from "@/lib/ebay/sell";
import { draftFromItem } from "@/lib/listing";
import { publishInventoryItem, repriceInventoryItem, saveShipFrom, syncSales } from "@/lib/publish";
import { runAllHunts, runHunt } from "@/lib/scan";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrUndef = (f: FormData, k: string) => {
  const s = str(f, k);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export type ActionState = { ok?: string; error?: string } | undefined;

async function guard<T>(fn: () => Promise<T>): Promise<ActionState> {
  try {
    await requireLogin();
    const r = await fn();
    return { ok: typeof r === "string" ? r : "완료" };
  } catch (e) {
    if (isRedirect(e)) throw e;
    return { error: (e as Error).message };
  }
}

function isRedirect(e: unknown) {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

// ── 로그인 ──────────────────────────────────────

export async function login(_: ActionState, f: FormData): Promise<ActionState> {
  const session = checkPassword(str(f, "password"));
  if (!session) return { error: "비밀번호가 틀렸어요." };
  (await cookies()).set(SESSION_COOKIE, session, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ── 사냥 ───────────────────────────────────────

export async function saveHuntAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const query = str(f, "query");
    if (!query) throw new Error("검색어를 입력해 주세요.");
    await saveHunt({
      id: str(f, "id") || undefined,
      query,
      condition: (str(f, "condition") || "used") as ConditionGroup,
      categoryId: str(f, "categoryId") || undefined,
      maxBuy: numOrUndef(f, "maxBuy"),
      minProfit: numOrUndef(f, "minProfit") ?? 20,
      minRoi: (numOrUndef(f, "minRoi") ?? 25) / 100,
      excludes: str(f, "excludes").split(",").map((s) => s.trim()).filter(Boolean),
    });
    revalidatePath("/hunts");
    return "저장했어요.";
  });
}

export async function deleteHuntAction(f: FormData) {
  await requireLogin();
  await deleteHunt(str(f, "id"));
  revalidatePath("/hunts");
  revalidatePath("/");
}

export async function scanHuntAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const hunt = (await listHunts()).find((h) => h.id === str(f, "id"));
    if (!hunt) throw new Error("사냥 목록에 없어요.");
    const r = await runHunt(hunt);
    revalidatePath("/");
    revalidatePath("/hunts");
    return `딜 ${r.deals.length}개 (후보 ${r.candidateCount}개, 비교 ${r.compCount}개)`;
  });
}

export async function scanAllAction(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const { results, errors } = await runAllHunts();
    revalidatePath("/");
    const total = results.reduce((s, r) => s + r.deals.length, 0);
    if (errors.length) throw new Error(`딜 ${total}개. 실패 ${errors.length}건: ${errors.map((e) => e.message).join(" / ")}`);
    return `사냥 ${results.length}개에서 딜 ${total}개`;
  });
}

// ── 구매 → 재고 ─────────────────────────────────

async function addFromItem(item: Item, buy: { price: number; shipping: number }, expectedSale?: number) {
  const settings = await getSettings();
  const cfg = ebayConfig();
  const tax = Math.round((buy.price + buy.shipping) * settings.fees.purchaseTaxRate * 100) / 100;
  const salePrice = expectedSale ?? Number.parseFloat(item.price?.value ?? "0");
  return addInventoryItem({
    status: "bought",
    title: item.title,
    imageUrl: item.image?.imageUrl,
    sourceItemId: item.itemId,
    sourceUrl: item.itemWebUrl,
    currency: cfg.marketplace.currency,
    boughtAt: new Date().toISOString(),
    buyPrice: buy.price,
    buyShipping: buy.shipping,
    buyTax: tax,
    expectedSale,
    draft: draftFromItem(item, Math.round(salePrice)),
  });
}

/** 딜 카드의 "샀어요" */
export async function markBoughtAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await guard(async () => {
    const scan = await getScan(str(f, "huntId"));
    const deal = scan?.deals.find((d) => d.listing.itemId === str(f, "itemId"));
    if (!deal) throw new Error("스캔 결과에서 이 매물을 찾지 못했어요. 다시 스캔해 주세요.");
    const item = await getItem(deal.listing.itemId);
    const created = await addFromItem(
      item,
      { price: numOrUndef(f, "price") ?? deal.listing.price, shipping: numOrUndef(f, "shipping") ?? deal.breakdown.buyShipping },
      deal.estimate.quickSale,
    );
    id = created.id;
  });
  if (r?.error) return r;
  redirect(`/inventory/${id}`);
}

/** eBay 상품 주소(또는 번호)로 직접 추가 */
export async function addByUrlAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await guard(async () => {
    const input = str(f, "url");
    const legacy = input.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/)?.[1] ?? input.match(/^\d{9,}$/)?.[0];
    if (!legacy) throw new Error("eBay 상품 주소(…/itm/123456789012)를 붙여넣어 주세요.");
    const item = await getItemByLegacyId(legacy);
    const created = await addFromItem(item, { price: numOrUndef(f, "price") ?? 0, shipping: numOrUndef(f, "shipping") ?? 0 });
    id = created.id;
  });
  if (r?.error) return r;
  redirect(`/inventory/${id}`);
}

// ── 재고 → 등록 ─────────────────────────────────

export async function saveDraftAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const id = str(f, "id");
    const item = await getInventoryItem(id);
    if (!item?.draft) throw new Error("초안이 없어요.");
    const aspects: Record<string, string[]> = {};
    for (const line of str(f, "aspects").split("\n")) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).split(",").map((s) => s.trim()).filter(Boolean);
      if (k && v.length) aspects[k] = v;
    }
    const draft: ListingDraft = {
      ...item.draft,
      title: str(f, "title").slice(0, 80),
      price: numOrUndef(f, "price") ?? item.draft.price,
      condition: str(f, "condition") || item.draft.condition,
      conditionDescription: str(f, "conditionDescription") || undefined,
      categoryId: str(f, "categoryId"),
      description: str(f, "description"),
      aspects,
    };
    await updateInventoryItem(id, {
      draft,
      buyPrice: numOrUndef(f, "buyPrice") ?? item.buyPrice,
      buyShipping: numOrUndef(f, "buyShipping") ?? item.buyShipping,
      buyTax: numOrUndef(f, "buyTax") ?? item.buyTax,
      notes: str(f, "notes") || undefined,
    });
    revalidatePath(`/inventory/${id}`);
    return "저장했어요.";
  });
}

/** 브라우저에서 줄인 사진 한 장을 eBay 이미지 서버에 올린다. */
export async function uploadPhotoAction(id: string, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const file = f.get("photo");
    if (!(file instanceof Blob) || file.size === 0) throw new Error("사진이 없어요.");
    const url = await uploadImage(file, `flip-${id.slice(0, 8)}-${Date.now()}.jpg`);
    const item = await getInventoryItem(id);
    if (!item?.draft) throw new Error("초안이 없어요.");
    await updateInventoryItem(id, { draft: { ...item.draft, imageUrls: [...item.draft.imageUrls, url].slice(0, 24) } });
    revalidatePath(`/inventory/${id}`);
  });
}

export async function removePhotoAction(f: FormData) {
  await requireLogin();
  const id = str(f, "id");
  const item = await getInventoryItem(id);
  if (!item?.draft) return;
  await updateInventoryItem(id, { draft: { ...item.draft, imageUrls: item.draft.imageUrls.filter((u) => u !== str(f, "url")) } });
  revalidatePath(`/inventory/${id}`);
}

export async function publishAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const item = await publishInventoryItem(str(f, "id"));
    revalidatePath(`/inventory/${item.id}`);
    revalidatePath("/inventory");
    return `등록했어요. 리스팅 번호 ${item.listingId}`;
  });
}

export async function repriceAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const price = numOrUndef(f, "price");
    if (!price) throw new Error("가격을 입력해 주세요.");
    await repriceInventoryItem(str(f, "id"), price);
    revalidatePath(`/inventory/${str(f, "id")}`);
    return `가격을 ${price} 로 바꿨어요.`;
  });
}

export async function markSoldAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const id = str(f, "id");
    await updateInventoryItem(id, {
      status: "sold",
      soldAt: new Date().toISOString(),
      saleTotal: numOrUndef(f, "saleTotal"),
      actualShipping: numOrUndef(f, "actualShipping"),
    });
    revalidatePath(`/inventory/${id}`);
    revalidatePath("/inventory");
  });
}

export async function updateShippingAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const id = str(f, "id");
    await updateInventoryItem(id, { actualShipping: numOrUndef(f, "actualShipping"), saleTotal: numOrUndef(f, "saleTotal") });
    revalidatePath(`/inventory/${id}`);
    return "저장했어요.";
  });
}

export async function setStatusAction(f: FormData) {
  await requireLogin();
  const id = str(f, "id");
  const status = str(f, "status") as "bought" | "cancelled";
  await updateInventoryItem(id, { status });
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
}

export async function deleteItemAction(f: FormData) {
  await requireLogin();
  await deleteInventoryItem(str(f, "id"));
  revalidatePath("/inventory");
  redirect("/inventory");
}

export async function syncSalesAction(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const sold = await syncSales();
    revalidatePath("/inventory");
    return sold.length ? `팔린 물건 ${sold.length}개: ${sold.map((s) => s.title).join(", ")}` : "새로 팔린 물건이 없어요.";
  });
}

// ── 설정 ───────────────────────────────────────

const OAUTH_STATE_COOKIE = "flip_oauth_state";

export async function connectEbayAction() {
  await requireLogin();
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  redirect(authorizeUrl(state));
}

export async function pasteCodeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const code = extractCode(str(f, "code"));
    if (!code) throw new Error("eBay 가 보여준 주소를 통째로 붙여넣어 주세요.");
    await exchangeCode(code);
    revalidatePath("/settings");
    return "eBay 계정을 연결했어요.";
  });
}

export async function disconnectEbayAction() {
  await requireLogin();
  await disconnectUser();
  revalidatePath("/settings");
}

export async function savePoliciesAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const policies = { fulfillmentPolicyId: str(f, "fulfillment"), paymentPolicyId: str(f, "payment"), returnPolicyId: str(f, "return") };
    if (!policies.fulfillmentPolicyId || !policies.paymentPolicyId || !policies.returnPolicyId) throw new Error("정책 세 가지를 모두 골라 주세요.");
    await saveSettings({ policies });
    revalidatePath("/settings");
    return "정책을 저장했어요.";
  });
}

export async function saveAddressAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const address = {
      city: str(f, "city"),
      stateOrProvince: str(f, "stateOrProvince") || undefined,
      postalCode: str(f, "postalCode"),
      country: str(f, "country").toUpperCase(),
    };
    if (!address.city || !address.postalCode || address.country.length !== 2) throw new Error("도시, 우편번호, 국가코드(2자리)를 입력해 주세요.");
    await saveShipFrom(address);
    revalidatePath("/settings");
    return "발송지를 저장했어요.";
  });
}

const FEE_FIELDS: { key: keyof FeeSettings; percent?: boolean }[] = [
  { key: "finalValueFeeRate", percent: true },
  { key: "perOrderFeeLow" },
  { key: "perOrderFeeHigh" },
  { key: "perOrderFeeThreshold" },
  { key: "resaleTaxRate", percent: true },
  { key: "promotedRate", percent: true },
  { key: "purchaseTaxRate", percent: true },
  { key: "outboundShipping" },
  { key: "packaging" },
  { key: "unknownShippingEstimate" },
];

export async function saveFeesAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const fees = { ...DEFAULT_FEES };
    for (const { key, percent } of FEE_FIELDS) {
      const n = numOrUndef(f, key);
      if (n !== undefined) fees[key] = percent ? n / 100 : n;
    }
    await saveSettings({ fees });
    revalidatePath("/settings");
    return "수수료 설정을 저장했어요.";
  });
}
