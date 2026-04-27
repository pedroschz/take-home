import { Resend } from "resend";

export async function sendEnrichedCsv(args: {
  to: string;
  csv: string;
  filename: string;
  rowCount: number;
  companyNames: string[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";

  const resend = new Resend(apiKey);

  const preview = args.companyNames
    .slice(0, 10)
    .map(escapeHtml)
    .join(", ");
  const more =
    args.companyNames.length > 10
      ? ` and ${args.companyNames.length - 10} more`
      : "";

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #18181b;">
      <h2 style="margin: 0 0 16px;">Your enriched companies are ready</h2>
      <p>We enriched <strong>${args.rowCount}</strong> ${args.rowCount === 1 ? "company" : "companies"}: ${preview}${more}.</p>
      <p>The enriched CSV is attached. Each row includes industry, target customer, key offering, three sales angles, three risk signals, and a recent news summary.</p>
      <p style="color: #71717a; font-size: 12px; margin-top: 24px;">Sent by your Lead Enrichment Pipeline.</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from,
    to: args.to,
    subject: `Enriched leads · ${args.rowCount} ${args.rowCount === 1 ? "company" : "companies"}`,
    html,
    attachments: [
      {
        filename: args.filename,
        content: Buffer.from(args.csv, "utf8"),
      },
    ],
  });

  if (error) {
    throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
