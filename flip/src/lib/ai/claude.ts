// Claude 호출 공통 설정.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

/**
 * 안전 분류기가 요청을 거절하면 서버가 Anthropic 권장 모델로 다시 돌린다.
 * (중고 거래 판단에서 거절될 일은 드물지만, 거절되면 그 사냥/리뷰만 비게 되므로 켜둔다.)
 */
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | undefined;
export function claude() {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY 환경변수가 없습니다.");
  client ??= new Anthropic();
  return client;
}

export class ClaudeRefusal extends Error {}

export function assertNotRefused(msg: { stop_reason: string | null; stop_details?: { explanation?: string | null } | null }) {
  if (msg.stop_reason === "refusal") throw new ClaudeRefusal(`Claude 가 요청을 거절했어요: ${msg.stop_details?.explanation ?? "이유 없음"}`);
}
