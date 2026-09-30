import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { readConfigs, writeConfigs } from "@/lib/csv";
import type { Config } from "@/lib/types";

// This data is read from Vercel Blob and changes on every write — never
// cache, or reads can lag behind the latest write.
export const dynamic = "force-dynamic";

export async function GET() {
  const configs = await readConfigs();
  return NextResponse.json(configs);
}

export async function POST(request: Request) {
  const body = await request.json();
  const configs = await readConfigs();
  const newConfig: Config = {
    id: uuid(),
    configName: body.configName,
    creatorsCategory: body.creatorsCategory,
    analysisInstruction: body.analysisInstruction,
  };
  configs.push(newConfig);
  await writeConfigs(configs);
  return NextResponse.json(newConfig, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const configs = await readConfigs();
  const index = configs.findIndex((c) => c.id === body.id);
  if (index === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  configs[index] = { ...configs[index], ...body };
  await writeConfigs(configs);
  return NextResponse.json(configs[index]);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const configs = await readConfigs();
  const filtered = configs.filter((c) => c.id !== id);
  await writeConfigs(filtered);
  return NextResponse.json({ success: true });
}
