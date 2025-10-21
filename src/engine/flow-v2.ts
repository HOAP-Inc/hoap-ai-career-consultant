import type { Meta, Phase, Status } from "../models/state";
import { readPrompt } from "./prompt-loader";
import {
  validateConversationOutput,
  validateGenerationOutput,
  type ConversationValidationResult,
  type GenerationValidationResult,
} from "./validator";
import { runStep4Adapter } from "./legacy/step4-adapter";

const MAX_CYCLES = 3;

type InternalPhase = Phase | "generation";

type SessionState = {
  step: number;
  phase: InternalPhase;
  cycles: number;
};

const sessions = new Map<string, SessionState>();

export type RouteStepArgs = {
  sessionId: string;
  status: Status;
  meta: Meta;
  userMessage: string;
};

export type RouteStepResult = {
  status: Status;
  meta: Meta;
  response?: string;
};

function getSessionState(sessionId: string, step: number): SessionState {
  const current = sessions.get(sessionId);
  if (!current || current.step !== step) {
    const fresh: SessionState = { step, phase: "intro", cycles: 0 };
    sessions.set(sessionId, fresh);
    return fresh;
  }
  return current;
}

function parseLLMResponse(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }
  return null;
}

function shouldEnterGeneration(response: string, cycles: number): boolean {
  if (!response) return false;
  const markers = ["十分な具体性あり", "GENERATION_READY", "具体性は十分" ];
  if (markers.some((m) => response.includes(m))) {
    return true;
  }
  return cycles >= MAX_CYCLES;
}

function mergeStatus(base: Status, patch: Partial<Status>): Status {
  const next: Status = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<[keyof Status, Status[keyof Status]]>) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

async function runConversationPhase(params: {
  step: number;
  phase: Phase;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
}): Promise<ConversationValidationResult> {
  const prompt = readPrompt(params.step);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callLLM(prompt, {
        step: params.step,
        phase: params.phase,
        status: params.status,
        meta: params.meta,
        userMessage: params.userMessage,
        cycleCount: params.cycleCount,
        mode: "conversation",
      });
      const parsed = parseLLMResponse(raw);
      const validation = validateConversationOutput(params.phase, parsed);
      if (validation.ok) {
        return validation;
      }
    } catch {
      // ignore and retry
    }
  }
  return { ok: true, response: "" };
}

async function runGenerationPhase(params: {
  step: number;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
}): Promise<GenerationValidationResult> {
  const prompt = readPrompt(params.step);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callLLM(prompt, {
        step: params.step,
        phase: "generation",
        status: params.status,
        meta: params.meta,
        userMessage: params.userMessage,
        cycleCount: params.cycleCount,
        mode: "generation",
      });
      const parsed = parseLLMResponse(raw);
      const validation = validateGenerationOutput(params.step, parsed, attempt);
      if (validation.ok) {
        return validation;
      }
    } catch {
      // ignore and retry
    }
  }
  // Final fallback (validator should have produced fallback values on second attempt)
  return validateGenerationOutput(params.step, {}, 2);
}

export async function routeStep({ sessionId, status, meta, userMessage }: RouteStepArgs): Promise<RouteStepResult> {
  const step = Number(meta?.step ?? 0);
  if (!Number.isFinite(step) || step < 2 || step > 6) {
    throw new Error(`Unsupported step: ${meta?.step}`);
  }

  const session = getSessionState(sessionId, step);

  if (session.phase === "intro") {
    const validation = await runConversationPhase({
      step,
      phase: "intro",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
    });
    session.phase = "empathy";
    return {
      status,
      meta: { step, phase: "intro" },
      response: validation.response,
    };
  }

  if (session.phase === "empathy") {
    const validation = await runConversationPhase({
      step,
      phase: "empathy",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
    });
    session.phase = "deepening";
    return {
      status,
      meta: { step, phase: "empathy" },
      response: validation.response,
    };
  }

  if (session.phase === "deepening") {
    const validation = await runConversationPhase({
      step,
      phase: "deepening",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
    });
    session.cycles += 1;
    if (shouldEnterGeneration(validation.response, session.cycles)) {
      session.phase = "generation";
    } else if (session.cycles >= MAX_CYCLES) {
      session.phase = "generation";
    } else {
      session.phase = "empathy";
    }
    return {
      status,
      meta: { step, phase: "deepening" },
      response: validation.response,
    };
  }

  // generation phase
  const generation = await runGenerationPhase({
    step,
    status,
    meta,
    userMessage,
    cycleCount: session.cycles,
  });

  let patchedStatus = generation.status;

  if (step === 4) {
    const adapter = runStep4Adapter(userMessage);
    patchedStatus = { ...patchedStatus, must_have_ids: adapter.status.must_have_ids };
  }

  const merged = mergeStatus(status, patchedStatus);

  const nextStep = step === 6 ? 7 : step + 1;
  sessions.delete(sessionId);

  return {
    status: merged,
    meta: { step: nextStep },
  };
}

type LLMInput = {
  step: number;
  phase: string;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
  mode: "conversation" | "generation";
};

async function callLLM(_prompt: string, input: LLMInput): Promise<string> {
  // Stub implementation that emulates deterministic LLM behaviour.
  if (input.mode === "generation") {
    return JSON.stringify({ status: buildGenerationPayload(input.step) });
  }
  return JSON.stringify({
    control: { phase: input.phase },
    response: buildConversationResponse(input.phase as Phase, input.cycleCount),
  });
}

function buildConversationResponse(phase: Phase, cycleCount: number): string {
  if (phase === "intro") {
    return "こんにちは！まずは今のご状況を少し教えてもらえるかな？";
  }
  if (phase === "empathy") {
    return "それは大変だったね。気持ちに寄り添いながら整理していこう。";
  }
  if (phase === "deepening") {
    if (cycleCount >= 2) {
      return "教えてくれた内容で十分な具体性ありと判断できたよ。次に進もう。";
    }
    return "もう少し詳しく状況を聞かせてもらってもいいかな？";
  }
  return "";
}

function buildGenerationPayload(step: number): Partial<Status> {
  if (step === 2) {
    return { can_text: buildFixedLengthText(70) };
  }
  if (step === 3) {
    return { will_text: buildFixedLengthText(72) };
  }
  if (step === 4) {
    return { must_have_text: buildFixedLengthText(75) };
  }
  if (step === 5) {
    return { self_text: buildFixedLengthText(140) };
  }
  if (step === 6) {
    const doing = buildFixedLengthText(300);
    const being = buildFixedLengthText(300);
    return { doing_text: insertNewline(doing), being_text: insertNewline(being) };
  }
  return {};
}

function buildFixedLengthText(target: number): string {
  const base = "私は利用者さんの想いを大切にしながら丁寧に行動してきました。";
  let result = "";
  while (result.length < target) {
    result += base;
  }
  return result.slice(0, target);
}

function insertNewline(text: string): string {
  if (text.length < 2) return text;
  const midpoint = Math.floor(text.length / 2);
  return `${text.slice(0, midpoint)}\n${text.slice(midpoint)}`;
}
