import fs from "fs";
import path from "path";

const PROMPT_DIR = path.resolve(process.cwd(), "prompts");

export function readPrompt(step: number): string {
  if (!Number.isFinite(step)) {
    throw new Error("step must be a finite number");
  }

  if (!fs.existsSync(PROMPT_DIR)) {
    throw new Error(`Prompt directory not found: ${PROMPT_DIR}`);
  }

  const pattern = new RegExp(`^step${step}_.+\\.txt$`);
  const entries = fs.readdirSync(PROMPT_DIR).filter((file) => pattern.test(file));

  if (entries.length === 0) {
    throw new Error(`Prompt for step ${step} not found`);
  }

  if (entries.length > 1) {
    throw new Error(`Multiple prompts found for step ${step}`);
  }

  const filePath = path.join(PROMPT_DIR, entries[0]);
  return fs.readFileSync(filePath, "utf-8");
}
