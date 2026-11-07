import { ebayConfig, type EbayConfig } from "./config";

export interface EbayErrorDetail {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name: string; value: string }[];
}

export class EbayApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly errors: EbayErrorDetail[],
  ) {
    const msg = errors.map((e) => e.longMessage ?? e.message).filter(Boolean).join(" / ");
    super(`eBay ${status} ${path}${msg ? `: ${msg}` : ""}`);
  }
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  token: string;
  base?: "api" | "media";
  headers?: Record<string, string>;
  cfg?: EbayConfig;
}

export interface EbayResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export async function ebayFetch<T>(path: string, opts: RequestOptions): Promise<EbayResponse<T>> {
  const cfg = opts.cfg ?? ebayConfig();
  const url = new URL((opts.base === "media" ? cfg.mediaBase : cfg.apiBase) + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/json",
    "X-EBAY-C-MARKETPLACE-ID": cfg.marketplace.id,
    "Accept-Language": cfg.marketplace.language,
    ...opts.headers,
  };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Language"] = cfg.marketplace.language;
  }

  const res = await fetch(url, { method: opts.method ?? "GET", headers, body, cache: "no-store" });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const errors = (data as { errors?: EbayErrorDetail[] })?.errors ?? [{ message: typeof data === "string" ? data.slice(0, 300) : res.statusText }];
    throw new EbayApiError(res.status, path, errors);
  }
  return { status: res.status, data: data as T, headers: res.headers };
}
