// eBay OAuth: 앱 토큰(공개 검색용)과 내 계정 토큰(등록·주문 조회용).
import { kv } from "../store";
import { APP_SCOPE, ebayConfig, USER_SCOPES, type EbayConfig } from "./config";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface UserTokens {
  refreshToken: string;
  refreshTokenExpiresAt: number;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  connectedAt: string;
}

export class EbayAuthError extends Error {}

const USER_KEY = "ebay-user";

async function tokenRequest(cfg: EbayConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${cfg.apiBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new EbayAuthError(`eBay 토큰 요청 실패 (${res.status}): ${json.error_description ?? json.error ?? "알 수 없음"}`);
  }
  return json;
}

// 앱 토큰은 2시간짜리. 서버리스 인스턴스 안에서만 캐시해도 충분하다.
const appTokens = new Map<string, { token: string; exp: number }>();

export async function appToken(scope = APP_SCOPE, cfg = ebayConfig()): Promise<string> {
  const hit = appTokens.get(scope);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest(cfg, { grant_type: "client_credentials", scope });
  appTokens.set(scope, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export function authorizeUrl(state: string, cfg = ebayConfig()): string {
  if (!cfg.ruName) throw new EbayAuthError("EBAY_RUNAME 환경변수가 없습니다.");
  const u = new URL(`${cfg.authBase}/oauth2/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.ruName);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", USER_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * eBay 가 돌려준 URL(또는 code 값만)을 받아 토큰으로 바꾼다.
 * RuName 의 accept URL 을 이 앱의 /api/oauth/callback 으로 걸어두면 자동이고,
 * 로컬에서 쓸 때는 eBay 기본 완료 페이지 주소를 복사해서 붙여넣으면 된다.
 */
export function extractCode(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.searchParams.get("code") ?? undefined;
  } catch {
    // URL 이 아니면 code 자체로 본다 (이미 디코딩됐을 수도, 아닐 수도 있음)
    return s.includes("%") ? decodeURIComponent(s) : s;
  }
}

export async function exchangeCode(code: string, cfg = ebayConfig()): Promise<UserTokens> {
  const t = await tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.ruName });
  if (!t.refresh_token) throw new EbayAuthError("eBay 가 refresh token 을 주지 않았습니다.");
  const tokens: UserTokens = {
    refreshToken: t.refresh_token,
    refreshTokenExpiresAt: Date.now() + (t.refresh_token_expires_in ?? 0) * 1000,
    accessToken: t.access_token,
    accessTokenExpiresAt: Date.now() + t.expires_in * 1000,
    connectedAt: new Date().toISOString(),
  };
  await kv().set(USER_KEY, tokens);
  return tokens;
}

export async function userConnection(): Promise<UserTokens | undefined> {
  const t = await kv().get<UserTokens>(USER_KEY);
  if (!t || t.refreshTokenExpiresAt < Date.now()) return undefined;
  return t;
}

export async function disconnectUser() {
  await kv().del(USER_KEY);
}

export async function userToken(cfg = ebayConfig()): Promise<string> {
  const t = await userConnection();
  if (!t) throw new EbayAuthError("eBay 계정이 연결되지 않았습니다. 설정에서 연결해 주세요.");
  if (t.accessToken && (t.accessTokenExpiresAt ?? 0) > Date.now() + 60_000) return t.accessToken;
  const r = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: t.refreshToken, scope: USER_SCOPES.join(" ") });
  await kv().set(USER_KEY, { ...t, accessToken: r.access_token, accessTokenExpiresAt: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}
