import type { ItemStatus } from "./data";

export function money(n: number | undefined, currency = "USD") {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export function ago(iso: string | undefined) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  bought: "구매함 · 등록 전",
  listed: "판매중",
  sold: "팔림",
  cancelled: "취소/반품",
};

