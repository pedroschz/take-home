import Papa from "papaparse";
import { ENRICHED_HEADERS, type CompanyInputRow, type EnrichedRow } from "./types";

export function parseInputCsv(text: string): CompanyInputRow[] {
  const cleaned = text.replace(/^﻿/, "");

  if (cleaned.trim().length === 0) {
    throw new Error("CSV file is empty.");
  }

  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const fatal = result.errors.find(
      (e) => e.type !== "FieldMismatch" && e.code !== "UndetectableDelimiter",
    );
    if (fatal) {
      throw new Error(`CSV parse error: ${fatal.message}`);
    }
  }

  const rows: CompanyInputRow[] = [];

  for (const row of result.data) {
    const companyName = (row["Company Name"] ?? "").trim();
    const website = (row["Website"] ?? "").trim();

    if (!companyName && !website) continue;
    if (!companyName || !website) {
      throw new Error(
        `Row missing required fields. Need both 'Company Name' and 'Website'. Got: name="${companyName}", website="${website}".`,
      );
    }

    rows.push({ companyName, website });
  }

  if (rows.length === 0) {
    throw new Error(
      "No data rows found. CSV must include a header row with 'Company Name' and 'Website' plus at least one data row.",
    );
  }

  return rows;
}

export function buildEnrichedCsv(rows: EnrichedRow[]): string {
  return Papa.unparse(rows, {
    columns: ENRICHED_HEADERS as string[],
    quotes: true,
    newline: "\n",
  });
}
