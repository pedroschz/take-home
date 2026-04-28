import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { parseInputCsv } from "@/lib/csv";
import type { ProgressEvent } from "@/lib/progress";
import { enrichWorkflow } from "@/workflows/enrich-workflow";

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

    const run = await start(enrichWorkflow, [rows, email]);
    console.log(
      `[route] workflow started runId=${run.runId} rows=${rows.length} email=${JSON.stringify(email)}`,
    );

    const encoder = new TextEncoder();
    const ndjson = run.readable.pipeThrough(
      new TransformStream<ProgressEvent, Uint8Array>({
        transform(event, controller) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        },
      }),
    );

    return new Response(ndjson, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform",
        "X-Workflow-Run-Id": run.runId,
      },
    });
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
