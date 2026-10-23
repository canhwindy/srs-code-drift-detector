import fs from "fs";
import path from "path";

const LOG_FILE = path.join(process.cwd(), "server/logs/srs_suggestions.jsonl");

export function appendSrsLog(entry: {
  gapFindingId: string;
  userInstruction: string;
  gapDescription: string;
  useCaseName: string;
  suggestion: string;
}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });

  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    // Non-critical — never break the main flow
  }
}
