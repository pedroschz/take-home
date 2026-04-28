export type StageName =
  | "scrape"
  | "tavily"
  | "news"
  | "profile"
  | "insights";

export type StageStatus = "running" | "ok" | "failed";

export type ProgressEvent =
  | { type: "start"; totalRows: number; companies: string[] }
  | {
      type: "stage";
      rowIdx: number;
      stage: StageName;
      status: StageStatus;
      message?: string;
    }
  | { type: "email"; status: StageStatus; message?: string }
  | { type: "rowDone"; rowIdx: number; success: boolean }
  | { type: "complete"; rowCount: number; emailedTo: string }
  | { type: "error"; message: string };
