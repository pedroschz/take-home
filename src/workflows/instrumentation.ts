import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { classifyAiError } from "./error-classify";

export function log(
  scope: string,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const tail = extra
    ? " " +
      Object.entries(extra)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
    : "";
  console.log(`[${scope}] ${msg}${tail}`);
}

export function trunc(value: unknown, max = 160): string {
  const s =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : String(value);
  return s.slice(0, max);
}

export function attemptOf(): number {
  try {
    return getStepMetadata().attempt ?? 1;
  } catch {
    return 1;
  }
}

export async function timed<T>(
  scope: string,
  base: Record<string, unknown>,
  fn: () => Promise<T>,
  summarize: (r: T) => { ok: boolean; extra?: Record<string, unknown> },
): Promise<T> {
  const t0 = Date.now();
  log(scope, "start", { ...base, attempt: attemptOf() });
  try {
    const result = await fn();
    const { ok, extra } = summarize(result);
    log(scope, ok ? "ok" : "failed", {
      ...base,
      took_ms: Date.now() - t0,
      ...extra,
    });
    return result;
  } catch (err) {
    log(scope, "failed", {
      ...base,
      took_ms: Date.now() - t0,
      error: trunc(err),
    });
    throw err;
  }
}

export async function timedAi<T>(
  scope: string,
  base: Record<string, unknown>,
  fn: () => Promise<T>,
  summarize: (r: T) => Record<string, unknown>,
): Promise<T> {
  const t0 = Date.now();
  log(scope, "start", { ...base, attempt: attemptOf() });
  try {
    const result = await fn();
    log(scope, "ok", {
      ...base,
      took_ms: Date.now() - t0,
      ...summarize(result),
    });
    return result;
  } catch (err) {
    const kind = classifyAiError(err);
    const msg = trunc(err);
    log(scope, "failed", {
      ...base,
      took_ms: Date.now() - t0,
      kind,
      error: msg,
    });
    if (kind === "rate-limit") {
      throw new RetryableError(`AI rate limited: ${msg}`, {
        retryAfter: "30s",
      });
    }
    if (kind === "fatal") {
      throw new FatalError(`AI auth/config error: ${msg}`);
    }
    throw err;
  }
}
