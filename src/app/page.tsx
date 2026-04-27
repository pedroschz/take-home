"use client";

import { useState, useRef } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string; rows: number }
  | { kind: "error"; message: string };

export default function Home() {
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !email) return;

    setStatus({ kind: "submitting" });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", email);

    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as
        | { ok: true; rows: number }
        | { ok: false; error: string };

      if (!res.ok || !data.ok) {
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      setStatus({
        kind: "success",
        rows: data.rows,
        message: `Enriched ${data.rows} ${data.rows === 1 ? "company" : "companies"}. CSV sent to ${email}.`,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
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
          columns. We&apos;ll scrape each site, search the web for context,
          pull recent news, run a two-step AI pipeline, and email the enriched
          CSV back to you.
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
              <Spinner /> Enriching… this can take a minute
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

      <footer className="text-xs text-zinc-500">
        Pipeline: website scrape → Tavily web search → NewsAPI → Claude profile
        extraction → Claude sales/risk synthesis → Resend email.
      </footer>
    </main>
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
