// lib/decideStep56.js
import fs from "fs";
import path from "path";
import OpenAI from "openai";

/** tags.json を読み込んで { [id]: name } を返す */
export function loadAvailablePurposes(tagsJsonPath = path.resolve(process.cwd(), "tags.json")) {
  const raw = fs.readFileSync(tagsJsonPath, "utf-8");
  const data = JSON.parse(raw);
  const arr = Array.isArray(data?.tags) ? data.tags : [];
  const dict = {};
  for (const t of arr) {
    if (t && (t.id ?? null) !== null && t.name) dict[String(t.id)] = String(t.name);
  }
  return dict;
}

/** JSON を安全に取り出す（```json ... ```や文字混入にも対応） */
export function extractJsonSafe(s) {
  if (!s) return null;
  // フェンス除去
  const fence = s.match(/```json[\s\S]*?```/);
  const body = fence ? fence[0].replace(/```json|```/g, "").trim() : s.trim();

  // 先頭 { から末尾 } を抜き出して parse
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = body.substring(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // 余計な末尾カンマなど軽微な崩れに再挑戦
    try {
      const compact = slice
        .replace(/\r/g, "")
        .replace(/\n/g, " ")
        .replace(/,\s*([}\]])/g, "$1"); // 末尾カンマ除去
      return JSON.parse(compact);
    } catch {
      return null;
    }
  }
}

/**
 * STEP5/6 決定器
 * - mode: "must_ng" | "must_have"
 * - systemPromptPath: prompts/step56_must_decider_system.txt をそのまま読み込む
 */
export async function decideStep56({
  userText,
  mode,
  recentTexts = [],
  role = "",
  place = "",
  turnIndex = 0,
  tagsJsonPath = path.resolve(process.cwd(), "tags.json"),
  systemPromptPath = path.resolve(process.cwd(), "prompts/step56_must_decider_system.txt"),
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const available_purposes = loadAvailablePurposes(tagsJsonPath);
  const system = fs.readFileSync(systemPromptPath, "utf-8");

  const payload = {
    locale: "ja",
    stage: { turn_index: Math.max(0, Math.min(2, Number(turnIndex) || 0)) },
    user_text: String(userText || ""),
    recent_texts: Array.isArray(recentTexts) ? recentTexts : [],
    role: String(role || ""),
    place: String(place || ""),
    mode: mode === "must_ng" || mode === "must_have" ? mode : "must_ng",
    available_purposes,
  };

  const client = new OpenAI({ apiKey });
  const rsp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });

  const raw = rsp?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonSafe(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      empathy: "",
      paraphrase: "",
      should_offer_choices: false,
      finalize_suggestion: false,
      candidates: [],
      unmatched_title: null,
      ask_next: null,
      flags: { oncall: false, night: false, overtime: false, weekend_off: false, salary_floor: false },
      _raw: raw,
    };
  }
  return parsed;
}
