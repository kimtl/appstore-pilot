// Vercel Cron 이 매일 부른다 (vercel.json). CRON_SECRET 을 설정하면 Vercel 이 Authorization 헤더에 넣어준다.
// 자동 정찰이 켜져 있으면 Claude 가 먼저 사냥 목록을 고치고, 그다음 모든 사냥을 스캔한다.
import { NextResponse, type NextRequest } from "next/server";
import { aiConfigured } from "@/lib/ai/claude";
import { runScout } from "@/lib/ai/scout";
import { getSettings } from "@/lib/data";
import { runAllHunts } from "@/lib/scan";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let scout: { summary?: string; changes?: number; error?: string } | undefined;
  if (aiConfigured() && (await getSettings()).ai.autopilot) {
    try {
      const run = await runScout();
      scout = { summary: run.summary, changes: run.changes.length };
    } catch (e) {
      scout = { error: (e as Error).message };
    }
  }
  const { results, errors } = await runAllHunts();
  return NextResponse.json({ scout, hunts: results.length, deals: results.reduce((s, r) => s + r.deals.length, 0), errors });
}
