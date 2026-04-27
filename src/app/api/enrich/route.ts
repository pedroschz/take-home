import { NextResponse } from "next/server";
import { buildEnrichedCsv, parseInputCsv } from "@/lib/csv";
import { sendEnrichedCsv } from "@/lib/email";
import { enrichAll } from "@/lib/enrich";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 25;
const MAX_FILE_BYTES = 1_000_000;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim();
    const file = form.get("file");

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Invalid recipient email." },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing CSV file." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "CSV file is empty." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `CSV too large (max ${MAX_FILE_BYTES / 1000}KB).`,
        },
        { status: 400 },
      );
    }

    const text = await file.text();

    let rows;
    try {
      rows = parseInputCsv(text);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "CSV parse failed",
        },
        { status: 400 },
      );
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Too many rows: ${rows.length}. Max allowed is ${MAX_ROWS}.`,
        },
        { status: 400 },
      );
    }

    const enriched = await enrichAll(rows, 3);
    const csv = buildEnrichedCsv(enriched);

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    await sendEnrichedCsv({
      to: email,
      csv,
      filename: `enriched-leads-${stamp}.csv`,
      rowCount: enriched.length,
      companyNames: enriched.map((r) => r["Company Name"]),
    });

    return NextResponse.json({ ok: true, rows: enriched.length });
  } catch (err) {
    console.error("Enrich pipeline failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Pipeline failed",
      },
      { status: 500 },
    );
  }
}
