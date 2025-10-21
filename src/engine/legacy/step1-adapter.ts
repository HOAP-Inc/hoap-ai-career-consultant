import { extractQualificationIdsFromText, matchLicenseLabels } from "../tags";
import type { Meta, Status } from "../../models/state";

type Step1Result = {
  status: Pick<Status, "qual_ids">;
  meta: Meta;
  response?: string;
};

type Step1AdapterParams = {
  userMessage: string;
  sessionId: string;
};

const pendingChoices = new Map<string, string[]>();

const toFullWidth = (s: string): string => s.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
const toHalfWidth = (s: string): string => s.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");

const normalize = (input: string): string =>
  toHalfWidth(toFullWidth(String(input || "")))
    .toLowerCase()
    .replace(/[ \t\r\n\u3000。、・／\\＿\-–—~～!?！？。、，．・]/g, "");

function uniqueOptions(options: string[]): string[] {
  const seen = new Map<string, string>();
  for (const option of options) {
    const key = normalize(option);
    if (!seen.has(key)) {
      seen.set(key, option);
    }
  }
  return Array.from(seen.values());
}

function formatPrompt(options: string[], retry: boolean): string {
  const body = options.map((opt) => `［${opt}］`).join("／");
  if (retry) {
    return `ごめん、もう一度教えて！この中だとどれが一番近い？『${body}』`;
  }
  return `どれが一番近い？『${body}』`;
}

function resolveChoice(options: string[], userMessage: string): string | null {
  const normalizedOptions = new Map(options.map((opt) => [normalize(opt), opt]));
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  const normalizedInput = normalize(trimmed);
  if (normalizedOptions.has(normalizedInput)) {
    return normalizedOptions.get(normalizedInput) ?? null;
  }

  const labels = matchLicenseLabels(trimmed);
  if (labels.length === 1) {
    const resolved = normalizedOptions.get(normalize(labels[0]));
    if (resolved) return resolved;
  } else if (labels.length > 1) {
    const intersect = labels
      .map((label) => normalizedOptions.get(normalize(label)))
      .filter((value): value is string => Boolean(value));
    if (intersect.length === 1) {
      return intersect[0];
    }
  }

  return null;
}

export function runStep1Adapter({ userMessage, sessionId }: Step1AdapterParams): Step1Result {
  const text = String(userMessage || "").trim();

  if (!text) {
    pendingChoices.delete(sessionId);
    return {
      status: { qual_ids: [] },
      meta: { step: 2 },
    };
  }

  const pending = pendingChoices.get(sessionId);
  if (pending && pending.length) {
    const choice = resolveChoice(pending, text);
    if (choice) {
      pendingChoices.delete(sessionId);
      const qualIds = extractQualificationIdsFromText(choice);
      return {
        status: { qual_ids: qualIds },
        meta: { step: 2 },
      };
    }

    const question = formatPrompt(pending, true);
    return {
      status: {},
      meta: { step: 1 },
      response: question,
    };
  }

  const matchedLabels = uniqueOptions(matchLicenseLabels(text));
  const normalizedInput = normalize(text);
  const exactMatch = matchedLabels.find((label) => normalize(label) === normalizedInput);

  if (exactMatch) {
    pendingChoices.delete(sessionId);
    const qualIds = extractQualificationIdsFromText(exactMatch);
    return {
      status: { qual_ids: qualIds },
      meta: { step: 2 },
    };
  }

  if (matchedLabels.length === 1) {
    pendingChoices.delete(sessionId);
    const qualIds = extractQualificationIdsFromText(matchedLabels[0]);
    return {
      status: { qual_ids: qualIds },
      meta: { step: 2 },
    };
  }

  if (matchedLabels.length > 1) {
    const options = matchedLabels.slice(0, 6);
    pendingChoices.set(sessionId, options);
    const question = formatPrompt(options, false);
    return {
      status: {},
      meta: { step: 1 },
      response: question,
    };
  }

  pendingChoices.delete(sessionId);
  const qualIds = extractQualificationIdsFromText(text);
  return {
    status: { qual_ids: qualIds },
    meta: { step: 2 },
  };
}
