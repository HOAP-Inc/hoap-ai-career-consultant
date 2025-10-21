import type { Phase, Status } from "../models/state";

export type ConversationValidationResult = {
  ok: boolean;
  response: string;
};

export type GenerationValidationResult = {
  ok: boolean;
  status: Partial<Status>;
};

const MIN_CAN_WILL = 60;
const MAX_CAN_WILL = 90;
const MIN_SELF = 100;
const MAX_SELF = 280;
const MIN_DOING_BEING = 280;
const MAX_DOING_BEING = 320;

const clamp = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

const clampNewlines = (text: string, maxBreaks: number): string => {
  let breaks = 0;
  let out = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (breaks < maxBreaks) {
        breaks += 1;
        out += ch;
      } else {
        out += " ";
      }
    } else {
      out += ch;
    }
  }
  return out;
};

const sanitizeText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function validateConversationOutput(phase: Phase, data: unknown): ConversationValidationResult {
  const obj = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const response = sanitizeText(obj.response);
  if (!response) {
    return { ok: false, response: "" };
  }

  if (phase === "empathy" && /[?？]/.test(response)) {
    return { ok: false, response: "" };
  }

  if (phase === "deepening" && /(うんうん|たしかに)/.test(response)) {
    return { ok: false, response: "" };
  }

  return { ok: true, response };
}

function pickStatusField(data: unknown, field: keyof Status): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  const status = typeof obj.status === "object" && obj.status !== null ? (obj.status as Record<string, unknown>) : {};
  if (field in status) return status[field];
  if (field in obj) return obj[field];
  return undefined;
}

export function validateGenerationOutput(step: number, data: unknown, attempt: number): GenerationValidationResult {
  const result: Partial<Status> = {};
  let ok = true;

  const ensureRange = (value: unknown, min: number, max: number): { text: string; valid: boolean } => {
    let text = sanitizeText(value);
    if (!text) return { text: "", valid: false };
    text = clamp(text, max);
    const valid = text.length >= min;
    return { text, valid };
  };

  if (step === 2) {
    const { text, valid } = ensureRange(pickStatusField(data, "can_text"), MIN_CAN_WILL, MAX_CAN_WILL);
    if (!valid) ok = false;
    result.can_text = text;
  } else if (step === 3) {
    const { text, valid } = ensureRange(pickStatusField(data, "will_text"), MIN_CAN_WILL, MAX_CAN_WILL);
    if (!valid) ok = false;
    result.will_text = text;
  } else if (step === 4) {
    const { text, valid } = ensureRange(pickStatusField(data, "must_have_text"), MIN_CAN_WILL, MAX_CAN_WILL);
    if (!valid) ok = false;
    result.must_have_text = text;
  } else if (step === 5) {
    const { text, valid } = ensureRange(pickStatusField(data, "self_text"), MIN_SELF, MAX_SELF);
    if (!valid) ok = false;
    result.self_text = text;
  } else if (step === 6) {
    let doing = sanitizeText(pickStatusField(data, "doing_text"));
    let being = sanitizeText(pickStatusField(data, "being_text"));
    doing = clampNewlines(doing, 2);
    being = clampNewlines(being, 2);
    doing = clamp(doing, MAX_DOING_BEING);
    being = clamp(being, MAX_DOING_BEING);
    const validDoing = doing.length >= MIN_DOING_BEING;
    const validBeing = being.length >= MIN_DOING_BEING;
    if (!validDoing || !validBeing) ok = false;
    result.doing_text = doing;
    result.being_text = being;
  } else {
    ok = false;
  }

  if (!ok && attempt >= 2) {
    // Fallback after second failure
    if (step === 2) {
      result.can_text = "";
    } else if (step === 3) {
      result.will_text = "";
    } else if (step === 4) {
      result.must_have_text = "";
    } else if (step === 5) {
      result.self_text = "";
    } else if (step === 6) {
      result.doing_text = "";
      result.being_text = "";
    }
    ok = true;
  }

  return { ok, status: result };
}
