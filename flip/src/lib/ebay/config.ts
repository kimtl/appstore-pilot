// eBay 설정은 전부 환경변수에서 읽는다. 시크릿은 서버에만 있고 브라우저로 내려가지 않는다.

export interface Marketplace {
  id: string;
  currency: string;
  country: string;
  language: string;
}

export const MARKETPLACES: Record<string, Marketplace> = {
  EBAY_US: { id: "EBAY_US", currency: "USD", country: "US", language: "en-US" },
  EBAY_GB: { id: "EBAY_GB", currency: "GBP", country: "GB", language: "en-GB" },
  EBAY_DE: { id: "EBAY_DE", currency: "EUR", country: "DE", language: "de-DE" },
  EBAY_AU: { id: "EBAY_AU", currency: "AUD", country: "AU", language: "en-AU" },
  EBAY_CA: { id: "EBAY_CA", currency: "CAD", country: "CA", language: "en-CA" },
};

export interface EbayConfig {
  sandbox: boolean;
  clientId: string;
  clientSecret: string;
  /** eBay 개발자 콘솔의 RuName (redirect_uri 자리에 들어가는 값) */
  ruName: string;
  marketplace: Marketplace;
  apiBase: string;
  authBase: string;
  mediaBase: string;
}

export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

export const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";
export const INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export class ConfigError extends Error {}

export function ebayConfig(env: NodeJS.ProcessEnv = process.env): EbayConfig {
  const sandbox = env.EBAY_ENV === "sandbox";
  const clientId = env.EBAY_CLIENT_ID ?? "";
  const clientSecret = env.EBAY_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new ConfigError("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET 환경변수가 없습니다.");
  const marketplace = MARKETPLACES[env.EBAY_MARKETPLACE ?? "EBAY_US"] ?? MARKETPLACES.EBAY_US;
  return {
    sandbox,
    clientId,
    clientSecret,
    ruName: env.EBAY_RUNAME ?? "",
    marketplace,
    // EBAY_API_BASE 는 테스트용 가짜 eBay 서버를 가리킬 때만 쓴다.
    apiBase: env.EBAY_API_BASE ?? (sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com"),
    authBase: env.EBAY_API_BASE ?? (sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com"),
    mediaBase: env.EBAY_API_BASE ?? (sandbox ? "https://apim.sandbox.ebay.com" : "https://apim.ebay.com"),
  };
}

export function isConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
}
