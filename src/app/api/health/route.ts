import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const env = getEnv();
  getDb().prepare("SELECT 1").get();
  return NextResponse.json({ ok: true, provider: env.CAREPOOL_PROVIDER, offline: env.CAREPOOL_OFFLINE, db: "ok" });
}
