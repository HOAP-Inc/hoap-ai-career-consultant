import type { NextApiRequest, NextApiResponse } from "next";
import { runStep1Adapter } from "../../engine/legacy/step1-adapter";
import { routeStep } from "../../engine/flow-v2";
import type { Meta, Phase, Status } from "../../models/state";

type ErrorResponse = { error: true; message: string };

type SuccessResponse = {
  status: Status;
  meta: Meta;
  response?: string;
};

const ALLOWED_PHASES: Phase[] = ["intro", "empathy", "deepening", "generation"];

function normalizeStatus(input: unknown): Status {
  const obj = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const status: Status = {};

  if (Array.isArray(obj.qual_ids)) {
    const ids = obj.qual_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (ids.length) status.qual_ids = ids;
  }
  const stringKeys: Array<keyof Pick<Status, "can_text" | "will_text" | "must_have_text" | "self_text" | "doing_text" | "being_text">> = [
    "can_text",
    "will_text",
    "must_have_text",
    "self_text",
    "doing_text",
    "being_text",
  ];
  for (const key of stringKeys) {
    const value = obj[key];
    if (typeof value === "string") {
      status[key] = value;
    }
  }
  if (Array.isArray(obj.must_have_ids)) {
    const ids = obj.must_have_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    status.must_have_ids = ids;
  }
  return status;
}

function normalizeMeta(input: unknown): Meta {
  const obj = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const stepRaw = Number(obj.step ?? 0);
  const step = Number.isFinite(stepRaw) ? stepRaw : 0;
  const meta: Meta = { step };
  const phase = obj.phase;
  if (typeof phase === "string" && (ALLOWED_PHASES as string[]).includes(phase)) {
    meta.phase = phase as Phase;
  }
  return meta;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: true, message: "Method not allowed" });
    return;
  }

  try {
    const bodyRaw = req.body;
    let body: Record<string, unknown> = {};
    if (typeof bodyRaw === "string") {
      try {
        body = JSON.parse(bodyRaw) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else if (typeof bodyRaw === "object" && bodyRaw) {
      body = bodyRaw as Record<string, unknown>;
    }
    const userMessage = typeof (body as any).userMessage === "string" ? (body as any).userMessage : "";
    const status = normalizeStatus((body as any).status);
    const meta = normalizeMeta((body as any).meta);
    const sessionIdRaw = typeof (body as any).sessionId === "string" ? (body as any).sessionId : "";
    const sessionId = sessionIdRaw || "default";

    if (meta.step === 1) {
      const legacy = runStep1Adapter({ userMessage, sessionId });
      const mergedStatus = { ...status, ...legacy.status };
      const payload: SuccessResponse = { status: mergedStatus, meta: legacy.meta };
      if (legacy.response != null) {
        payload.response = legacy.response;
      }
      res.status(200).json(payload);
      return;
    }

    if (meta.step >= 2 && meta.step <= 6) {
      const result = await routeStep({ sessionId, status, meta, userMessage });
      res.status(200).json(result);
      return;
    }

    res.status(400).json({ error: true, message: "Unsupported step" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: true, message });
  }
}
