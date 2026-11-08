// 나 혼자 쓰는 앱: 비밀번호 하나(APP_PASSWORD)로 잠근다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "flip_session";

function expected(): string | undefined {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return undefined;
  return createHmac("sha256", pw).update("flip-session-v1").digest("hex");
}

export function passwordRequired() {
  // 배포 환경에서는 비밀번호가 없으면 아예 못 들어오게 한다 (실수로 공개되지 않게).
  return Boolean(process.env.APP_PASSWORD) || Boolean(process.env.VERCEL) || Boolean(process.env.RENDER);
}

export function checkPassword(input: string): string | undefined {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return undefined;
  const a = Buffer.from(input);
  const b = Buffer.from(pw);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return expected();
}

export function sessionValid(value: string | undefined): boolean {
  if (!passwordRequired()) return true;
  const exp = expected();
  if (!exp || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(exp);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isLoggedIn() {
  return sessionValid((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireLogin() {
  if (!(await isLoggedIn())) throw new Error("로그인이 필요합니다.");
}
