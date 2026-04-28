"use client";

import { useState, useRef } from "react";

type StageName =
  | "scrape"
  | "tavily"
  | "news"
  | "profile"
  | "insights";

type StageStatus = "pending" | "running" | "ok" | "failed";

type RowState = {
  name: string;
  stages: Record<StageName, StageStatus>;
  failureMsg?: string;
};

type EmailStatus = "pending" | "running" | "ok" | "failed";

type ProgressEvent =
  | { type: "start"; totalRows: number; companies: string[] }
  | {
      type: "stage";
      rowIdx: number;
      stage: StageName | "email";
      status: "running" | "ok" | "failed";
      message?: string;
    }
  | { type: "rowDone"; rowIdx: number; success: boolean }
  | { type: "complete"; rowCount: number; emailedTo: string }
  | { type: "error"; message: string };

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const INITIAL_STAGES: Record<StageName, StageStatus> = {
  scrape: "pending",
  tavily: "pending",
  news: "pending",
  profile: "pending",
  insights: "pending",
};

const STAGE_LABELS: Record<StageName, string> = {
  scrape: "Scrape",
  tavily: "Web",
  news: "News",
  profile: "Profile",
  insights: "Insights",
};

export default function Home() {
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rows, setRows] = useState<RowState[]>([]);
  const [emailStage, setEmailStage] = useState<EmailStatus>("pending");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyEvent(event: ProgressEvent) {
    if (event.type === "start") {
      setRows(
        event.companies.map((name) => ({
          name,
          stages: { ...INITIAL_STAGES },
        })),
      );
      setEmailStage("pending");
      return;
    }

    if (event.type === "stage") {
      if (event.stage === "email") {
        setEmailStage(event.status);
        return;
      }
      const stage = event.stage;
      setRows((prev) => {
        const next = [...prev];
        const existing = next[event.rowIdx];
        if (!existing) return prev;
        next[event.rowIdx] = {
          ...existing,
          stages: { ...existing.stages, [stage]: event.status },
          failureMsg:
            event.status === "failed" ? event.message ?? existing.failureMsg : existing.failureMsg,
        };
        return next;
      });
      return;
    }

    if (event.type === "rowDone") {
      setRows((prev) => {
        const next = [...prev];
        const existing = next[event.rowIdx];
        if (!existing) return prev;
        const stages = { ...existing.stages };
        for (const key of Object.keys(stages) as StageName[]) {
          if (stages[key] === "running" || stages[key] === "pending") {
            stages[key] = event.success ? "ok" : "failed";
          }
        }
        next[event.rowIdx] = { ...existing, stages };
        return next;
      });
      return;
    }

    if (event.type === "complete") {
      setStatus({
        kind: "success",
        message: `Enriched ${event.rowCount} ${event.rowCount === 1 ? "company" : "companies"}. CSV sent to ${event.emailedTo}.`,
      });
      return;
    }

    if (event.type === "error") {
      setStatus({ kind: "error", message: event.message });
    }
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!file || !email) return;

    setStatus({ kind: "submitting" });
    setRows([]);
    setEmailStage("pending");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", email);

    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        body: formData,
      });

      const contentType = res.headers.get("Content-Type") ?? "";

      if (!res.ok || !contentType.includes("application/x-ndjson")) {
        const data = (await res.json().catch(() => null)) as
          | { ok: false; error: string }
          | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Server returned empty stream.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let sawComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          try {
            const event = JSON.parse(line) as ProgressEvent;
            applyEvent(event);
            if (event.type === "complete") sawComplete = true;
          } catch {
            // Ignore malformed line; the stream may be truncated mid-chunk.
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        try {
          const event = JSON.parse(tail) as ProgressEvent;
          applyEvent(event);
          if (event.type === "complete") sawComplete = true;
        } catch {
          // ignore
        }
      }

      if (!sawComplete) {
        setStatus((prev) =>
          prev.kind === "submitting"
            ? { kind: "error", message: "Pipeline ended without a completion event." }
            : prev,
        );
      } else {
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Lead Enrichment Pipeline
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Turn a CSV of companies into qualified sales context.
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Upload a CSV with{" "}
          <code className="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">
            Company Name
          </code>{" "}
          and{" "}
          <code className="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">
            Website
          </code>{" "}
          columns (
          <a
            href="/template.csv"
            className="underline underline-offset-4"
            download
          >
            template
          </a>
          ). We&apos;ll scrape each site, search the web for context, pull
          recent news, run a two-step AI pipeline, and email the enriched CSV
          back to you.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Recipient email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Companies CSV</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={isSubmitting}
            className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 disabled:opacity-50 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-300"
          />
          <span className="text-xs text-zinc-500">
            Required headers: <code>Company Name</code>, <code>Website</code>.
            Other columns will be (re)populated.
          </span>
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !file || !email}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isSubmitting ? (
            <>
              <Spinner /> Enriching…
            </>
          ) : (
            "Enrich and email"
          )}
        </button>

        {status.kind === "success" && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
            {status.message}
          </div>
        )}
        {status.kind === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100">
            {status.message}
          </div>
        )}
      </form>

      {(rows.length > 0 || isSubmitting) && (
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Company</th>
                {(Object.keys(STAGE_LABELS) as StageName[]).map((stage) => (
                  <th key={stage} className="px-2 py-3 text-center font-medium">
                    {STAGE_LABELS[stage]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-4 py-2 font-medium text-zinc-800 dark:text-zinc-200">
                    {row.name}
                    {row.failureMsg && (
                      <div
                        className="text-xs text-red-600 dark:text-red-400"
                        title={row.failureMsg}
                      >
                        {row.failureMsg.slice(0, 80)}
                      </div>
                    )}
                  </td>
                  {(Object.keys(STAGE_LABELS) as StageName[]).map((stage) => (
                    <td key={stage} className="px-2 py-2 text-center">
                      <StageDot status={row.stages[stage]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-zinc-500">Email delivery</span>
            <StageDot status={emailStage} withLabel />
          </div>
        </section>
      )}

      <footer className="text-xs text-zinc-500">
        Pipeline: website scrape → Tavily web search → NewsAPI → Claude profile
        extraction → Claude sales/risk synthesis → Resend email.
      </footer>
    </main>
  );
}

function StageDot({
  status,
  withLabel = false,
}: {
  status: StageStatus | EmailStatus;
  withLabel?: boolean;
}) {
  const map: Record<StageStatus, { color: string; label: string }> = {
    pending: { color: "bg-zinc-200 dark:bg-zinc-700", label: "Pending" },
    running: {
      color: "bg-amber-400 animate-pulse",
      label: "Running",
    },
    ok: { color: "bg-emerald-500", label: "Done" },
    failed: { color: "bg-red-500", label: "Failed" },
  };
  const { color, label } = map[status];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${color}`}
        aria-label={label}
        title={label}
      />
      {withLabel && <span className="text-zinc-600 dark:text-zinc-300">{label}</span>}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
