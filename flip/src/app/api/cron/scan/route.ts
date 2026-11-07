// Vercel Cron 이 매일 부른다 (vercel.json). CRON_SECRET 을 설정하면 Vercel 이 Authorization 헤더에 넣어준다.
import { NextResponse, type NextRequest } from "next/server";
import { runAllHunts } from "@/lib/scan";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { results, errors } = await runAllHunts();
  return NextResponse.json({ hunts: results.length, deals: results.reduce((s, r) => s + r.deals.length, 0), errors });
}
