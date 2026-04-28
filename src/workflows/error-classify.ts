export type AiErrorKind = "rate-limit" | "fatal" | "transient";

export function classifyAiError(err: unknown): AiErrorKind {
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;

  if (status === 429 || status === 529) return "rate-limit";
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return "fatal";
  }
  return "transient";
}
