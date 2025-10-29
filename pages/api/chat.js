const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const PROMPTS_DIR = path.join(process.cwd(), "prompts");

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error("prompt_read_failed", filePath, err);
    return "";
  }
}

const STEP_PROMPTS = {
  1: safeRead(path.join(PROMPTS_DIR, "step1_license_system.txt")),
  2: safeRead(path.join(PROMPTS_DIR, "step2_can_system.txt")),
  3: safeRead(path.join(PROMPTS_DIR, "step3_will_system.txt")),
  4: safeRead(path.join(PROMPTS_DIR, "step4_must_system.txt")),
  5: safeRead(path.join(PROMPTS_DIR, "step5_self_system.txt")),
  6: safeRead(path.join(PROMPTS_DIR, "step6_doingbeing_system.txt")),
};
const COMMON_PROMPT = safeRead(path.join(PROMPTS_DIR, "common_instructions.txt"));
const LLM_BRAKE_PROMPT = safeRead(path.join(PROMPTS_DIR, "llm_brake_system.txt"));

function loadJson(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("json_read_failed", fileName, err);
    return null;
  }
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.items)) return value.items;
  if (value && typeof value === "object" && Array.isArray(value.qualifications)) return value.qualifications;
  return [];
}

const QUALIFICATIONS = ensureArray(loadJson("qualifications.json"));
const LICENSE_SOURCES = loadJson("licenses.json") || {};

const QUAL_NAME_BY_ID = new Map();
const QUAL_ID_BY_NORMAL = new Map();

function normKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]/g, "");
}

function normalizePick(value) {
  return String(value || "")
    .trim()
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/\s+/g, " ");
}

for (const item of QUALIFICATIONS) {
  const id = Number(item?.id);
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  if (!Number.isInteger(id) || !name) continue;
  QUAL_NAME_BY_ID.set(id, name);
  QUAL_ID_BY_NORMAL.set(normKey(name), id);
}

const LICENSE_LABEL_TO_QUAL_ID = new Map();
const LICENSE_ALIAS_MAP = new Map();

function addAlias(alias, label) {
  const normalized = normKey(alias);
  if (!normalized) return;
  if (!LICENSE_ALIAS_MAP.has(normalized)) {
    LICENSE_ALIAS_MAP.set(normalized, []);
  }
  const list = LICENSE_ALIAS_MAP.get(normalized);
  if (!list.includes(label)) {
    list.push(label);
  }
}

function resolveQualificationIdByName(name) {
  if (!name) return null;
  return QUAL_ID_BY_NORMAL.get(normKey(name)) || null;
}

for (const group of Object.values(LICENSE_SOURCES || {})) {
  if (!Array.isArray(group)) continue;
  for (const entry of group) {
    if (!entry) continue;
    const label = typeof entry === "string" ? entry : String(entry.label || "").trim();
    if (!label) continue;
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
    const qualId = resolveQualificationIdByName(label);
    if (qualId) {
      LICENSE_LABEL_TO_QUAL_ID.set(label, qualId);
    }
    addAlias(label, label);
    for (const alias of aliases) {
      addAlias(alias, label);
    }
  }
}

function findLicenseLabelsByAlias(text) {
  const norm = normKey(text);
  if (!norm) return [];
  const labels = LICENSE_ALIAS_MAP.get(norm) || [];
  return labels.slice();
}

function mapLicenseLabelToQualificationId(label) {
  if (!label) return null;
  if (LICENSE_LABEL_TO_QUAL_ID.has(label)) {
    return LICENSE_LABEL_TO_QUAL_ID.get(label);
  }
  return resolveQualificationIdByName(label);
}

function isKatakana(text) {
  return /^[\u30A0-\u30FFー]+$/.test(String(text || "").trim());
}

const sessions = new Map();

function createSession(sessionId) {
  const base = {
    id: sessionId || `s_${Math.random().toString(36).slice(2)}`,
    step: 1,
    history: [],
    status: { qual_ids: [], licenses: [] },
    drill: { phase: null, awaitingChoice: false, options: [] },
    stage: { turnIndex: 0 },
    meta: { deepening_attempt_total: 0 },
  };
  return normalizeSession(base);
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return createSession();
  if (typeof session.id !== "string" || !session.id) {
    session.id = `s_${Math.random().toString(36).slice(2)}`;
  }
  if (!Array.isArray(session.history)) session.history = [];
  if (!session.status || typeof session.status !== "object") session.status = {};
  if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = [];
  if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
  if (!session.drill || typeof session.drill !== "object") {
    session.drill = { phase: null, awaitingChoice: false, options: [] };
  }
  if (!Array.isArray(session.drill.options)) session.drill.options = [];
  if (typeof session.drill.awaitingChoice !== "boolean") session.drill.awaitingChoice = false;
  if (!session.stage || typeof session.stage !== "object") {
    session.stage = { turnIndex: 0 };
  }
  if (typeof session.stage.turnIndex !== "number") session.stage.turnIndex = 0;
  if (!session.meta || typeof session.meta !== "object") {
    session.meta = { deepening_attempt_total: 0 };
  }
  if (typeof session.meta.deepening_attempt_total !== "number") {
    session.meta.deepening_attempt_total = 0;
  }
  if (!session.step || typeof session.step !== "number") session.step = 1;
  return session;
}

function resetDrill(session) {
  if (!session) return;
  session.drill = { phase: null, awaitingChoice: false, options: [] };
}

function formatOptions(options) {
  return options.map(opt => `［${opt}］`).join("／");
}

function _extractJsonBlock(rawText) {
  if (rawText == null) return null;
  const text = String(rawText).trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const snippet = text.slice(start, end + 1);
  try {
    return JSON.parse(snippet);
  } catch (err) {
    return null;
  }
}

async function callLLM(stepKey, payload, session, opts = {}) {
  if (typeof global.__TEST_LLM__ === "function") {
    try {
      const raw = await global.__TEST_LLM__({ stepKey, payload, session, opts });
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      const parsed = _extractJsonBlock(text);
      return { ok: !!parsed, _raw: text, parsed, error: parsed ? null : "schema_mismatch" };
    } catch (err) {
      return { ok: false, error: err?.message || "mock_failure" };
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "missing_api_key" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const messages = [
      { role: "system", content: COMMON_PROMPT },
      { role: "system", content: LLM_BRAKE_PROMPT },
      { role: "system", content: STEP_PROMPTS[stepKey] || "" },
      { role: "user", content: JSON.stringify(payload) },
    ];
    const response = await client.responses.create({
      model: opts.model || "gpt-4o-mini",
      input: messages,
    });
    const raw = response?.output?.[0]?.content?.[0]?.text || "";
    const parsed = _extractJsonBlock(raw);
    return { ok: !!parsed, _raw: raw, parsed, error: parsed ? null : "schema_mismatch" };
  } catch (err) {
    return { ok: false, error: err?.message || "llm_failure" };
  }
}

function getSession(sessionId) {
  if (!sessionId) return createSession();
  const existing = sessions.get(sessionId);
  if (existing) return normalizeSession(existing);
  const created = createSession(sessionId);
  sessions.set(created.id, created);
  return created;
}

function saveSession(session) {
  if (session?.id) {
    sessions.set(session.id, session);
  }
}

function buildSchemaError(step, session, message, errorCode = "schema_mismatch") {
  return {
    response: message,
    status: session.status,
    meta: { step, error: errorCode },
    drill: session.drill,
    _error: errorCode,
  };
}

async function handleStep1(session, userText) {
  session.stage.turnIndex += 1;
  const trimmed = String(userText || "").trim();

  if (session.drill.awaitingChoice) {
    const normalized = normalizePick(trimmed);
    const selected = session.drill.options.find(opt => normalizePick(opt) === normalized);
    if (!selected) {
      return {
        response: `候補から選んでね。『${formatOptions(session.drill.options)}』`,
        status: session.status,
        meta: { step: 1 },
        drill: session.drill,
      };
    }
    const qualId = mapLicenseLabelToQualificationId(selected);
    if (!qualId) {
      resetDrill(session);
      return {
        response: "IDを付与できなかったよ。別の言い方で教えてみて。",
        status: session.status,
        meta: { step: 1 },
        drill: session.drill,
      };
    }
    const qualName = QUAL_NAME_BY_ID.get(qualId) || selected;
    session.status.qual_ids = [qualId];
    session.status.licenses = [qualName];
    resetDrill(session);
    session.step = 2;
    session.stage.turnIndex = 0;
    return {
      response: `資格は「${qualName}」で進めるね！次はCanを整理しよう✨`,
      status: session.status,
      meta: { step: 2 },
      drill: session.drill,
    };
  }

  if (!trimmed) {
    return {
      response: "今の資格や研修名を一言で教えてね！",
      status: session.status,
      meta: { step: 1 },
      drill: session.drill,
    };
  }

  const directId = resolveQualificationIdByName(trimmed);
  if (directId) {
    const qualName = QUAL_NAME_BY_ID.get(directId) || trimmed;
    session.status.qual_ids = [directId];
    session.status.licenses = [qualName];
    session.step = 2;
    session.stage.turnIndex = 0;
    resetDrill(session);
    return {
      response: `了解！「${qualName}」として記録したよ。次はCanを一緒に考えよう✨`,
      status: session.status,
      meta: { step: 2 },
      drill: session.drill,
    };
  }

  const labels = findLicenseLabelsByAlias(trimmed);
  if (labels.length > 0) {
    const uniqueLabels = Array.from(new Set(labels));
    const resolved = uniqueLabels
      .map(label => ({ label, id: mapLicenseLabelToQualificationId(label) }))
      .filter(item => item.id);

    if (uniqueLabels.length === 1 && resolved.length === 1) {
      const { label, id } = resolved[0];
      session.status.qual_ids = [id];
      session.status.licenses = [QUAL_NAME_BY_ID.get(id) || label];
      session.step = 2;
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `その呼び方なら「${label}」が近いかな！このIDで進めるね✨`,
        status: session.status,
        meta: { step: 2 },
        drill: session.drill,
      };
    }

    if (resolved.length === 1) {
      const { label, id } = resolved[0];
      session.status.qual_ids = [id];
      session.status.licenses = [QUAL_NAME_BY_ID.get(id) || label];
      session.step = 2;
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `その表現なら「${label}」として登録できるよ！このIDで進めよう✨`,
        status: session.status,
        meta: { step: 2 },
        drill: session.drill,
      };
    }

    if (resolved.length > 1 && isKatakana(trimmed)) {
      const sorted = [...resolved].sort((a, b) => a.id - b.id);
      const { label, id } = sorted[0];
      session.status.qual_ids = [id];
      session.status.licenses = [QUAL_NAME_BY_ID.get(id) || label];
      session.step = 2;
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `その呼び方ならまずは「${label}」を基準に進めてみるね！`,
        status: session.status,
        meta: { step: 2 },
        drill: session.drill,
      };
    }

    session.drill.phase = "license";
    session.drill.awaitingChoice = true;
    session.drill.options = uniqueLabels;
    return {
      response: `候補がいくつかあるよ。どれが一番近い？『${formatOptions(uniqueLabels)}』`,
      status: session.status,
      meta: { step: 1 },
      drill: session.drill,
    };
  }

  return {
    response: "ごめん、まだ登録できる資格が見つからなかったよ。正式名称で教えてみて！",
    status: session.status,
    meta: { step: 1 },
    drill: session.drill,
  };
}

function buildStepPayload(session, userText, recentCount) {
  return {
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    user_text: userText,
    recent_texts: session.history.slice(-recentCount).map(item => item.text),
    status: session.status,
  };
}

function stringifyResponseParts(parts) {
  return parts.filter(Boolean).join(" ").trim();
}

async function handleStep2(session, userText) {
  session.stage.turnIndex += 1;
  const payload = buildStepPayload(session, userText, 3);
  const llm = await callLLM(2, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(2, session, "Canの整理でエラーが起きたみたい。もう一度話してみて！", llm.error);
  }
  const { empathy, paraphrase, ask_next, meta } = llm.parsed || {};
  if (typeof empathy !== "string" || typeof paraphrase !== "string" || (ask_next != null && typeof ask_next !== "string")) {
    return buildSchemaError(2, session, "Canの整理でエラーが起きたみたい。もう一度話してみて！");
  }
  session.status.can_text = paraphrase;
  if (!Array.isArray(session.status.can_texts)) {
    session.status.can_texts = [];
  }
  if (!session.status.can_texts.includes(paraphrase)) {
    session.status.can_texts.push(paraphrase);
  }
  const message = stringifyResponseParts([empathy, ask_next]) || "Canについて教えてくれてありがとう！";
  const nextStep = Number(meta?.step) || 2;
  if (nextStep !== session.step) {
    session.step = nextStep;
    session.stage.turnIndex = 0;
  }
  return {
    response: message,
    status: session.status,
    meta: { step: session.step },
    drill: session.drill,
  };
}

async function handleStep3(session, userText) {
  session.stage.turnIndex += 1;
  const payload = buildStepPayload(session, userText, 5);
  const llm = await callLLM(3, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(3, session, "Willの生成でエラーが発生したよ。少し時間を置いてみてね。", llm.error);
  }
  const parsed = llm.parsed || {};
  if (parsed?.status?.will_text && typeof parsed.status.will_text === "string") {
    session.status.will_text = parsed.status.will_text;
    if (!Array.isArray(session.status.will_texts)) {
      session.status.will_texts = [];
    }
    session.status.will_texts.push(parsed.status.will_text);
    const nextStep = Number(parsed?.meta?.step) || 4;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    return {
      response: parsed.status.will_text,
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }
  if (typeof parsed?.response === "string") {
    if (parsed?.control?.phase === "intro") {
      session.stage.turnIndex = 0;
    }
    return {
      response: parsed.response,
      status: session.status,
      meta: { step: 3, phase: parsed?.control?.phase },
      drill: session.drill,
    };
  }
  return {
    response: "Willを整理する準備をしてるよ。もう少し話してみて！",
    status: session.status,
    meta: { step: 3 },
    drill: session.drill,
  };
}

function applyMustStatus(session, status, meta) {
  session.status.must_have_ids = Array.isArray(status?.must_ids) ? status.must_ids : [];
  session.status.ng_ids = Array.isArray(status?.ng_ids) ? status.ng_ids : [];
  session.status.pending_ids = Array.isArray(status?.pending_ids) ? status.pending_ids : [];
  session.status.direction_map = status?.direction_map && typeof status.direction_map === "object" ? status.direction_map : {};
  session.status.status_bar = typeof status?.status_bar === "string" ? status.status_bar : "";
  session.status.must_text = typeof status?.must_text === "string" ? status.must_text : "";
  if (meta?.deepening_attempt_total != null) {
    const total = Number(meta.deepening_attempt_total);
    if (!Number.isNaN(total)) {
      session.meta.deepening_attempt_total = total;
    }
  }
}

async function handleStep4(session, userText) {
  session.stage.turnIndex += 1;
  const payload = {
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    user_text: userText,
    recent_texts: session.history.slice(-6).map(item => item.text),
    status: session.status,
    deepening_attempt_total: session.meta.deepening_attempt_total,
  };
  const llm = await callLLM(4, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(4, session, "Mustの整理に失敗しちゃった。もう一度教えてもらえる？", llm.error);
  }
  const parsed = llm.parsed || {};
  if (parsed?.status && typeof parsed.status === "object") {
    applyMustStatus(session, parsed.status, parsed.meta || {});
    const nextStep = Number(parsed?.meta?.step) || 5;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    return {
      response: session.status.must_text || "Mustのまとめを更新したよ。",
      status: session.status,
      meta: { step: session.step, deepening_attempt_total: session.meta.deepening_attempt_total },
      drill: session.drill,
    };
  }
  if (parsed?.meta?.deepening_attempt != null) {
    const increment = Number(parsed.meta.deepening_attempt);
    if (!Number.isNaN(increment) && increment > 0) {
      session.meta.deepening_attempt_total += increment;
      if (session.meta.deepening_attempt_total > 3) {
        session.meta.deepening_attempt_total = 3;
      }
    }
  }
  if (parsed?.meta?.deepening_attempt_total != null) {
    const total = Number(parsed.meta.deepening_attempt_total);
    if (!Number.isNaN(total)) {
      session.meta.deepening_attempt_total = Math.min(total, 3);
    }
  }
  if (parsed?.control?.phase) {
    return {
      response: parsed.response || "もう少し詳しく聞かせてほしいな。",
      status: session.status,
      meta: {
        step: 4,
        phase: parsed.control.phase,
        deepening_attempt_total: session.meta.deepening_attempt_total,
      },
      drill: session.drill,
    };
  }
  return {
    response: "Mustの整理を続けているよ。気になる条件を教えてね。",
    status: session.status,
    meta: { step: 4, deepening_attempt_total: session.meta.deepening_attempt_total },
    drill: session.drill,
  };
}

async function handleStep5(session, userText) {
  session.stage.turnIndex += 1;
  const payload = buildStepPayload(session, userText, 6);
  const llm = await callLLM(5, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(5, session, "Selfの生成で少しつまずいたよ。もう一度話してみてね。", llm.error);
  }
  const parsed = llm.parsed || {};
  if (parsed?.status?.self_text && typeof parsed.status.self_text === "string") {
    session.status.self_text = parsed.status.self_text;
    const nextStep = Number(parsed?.meta?.step) || 6;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    return {
      response: session.status.self_text,
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }
  if (typeof parsed?.response === "string") {
    return {
      response: parsed.response,
      status: session.status,
      meta: { step: 5, phase: parsed?.control?.phase },
      drill: session.drill,
    };
  }
  return {
    response: "あなた自身について、もう少し聞かせてもらえる？",
    status: session.status,
    meta: { step: 5 },
    drill: session.drill,
  };
}

async function handleStep6(session, userText) {
  session.stage.turnIndex += 1;
  const payload = buildStepPayload(session, userText, 8);
  const llm = await callLLM(6, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(6, session, "Doing/Being の生成に失敗しちゃった。少し待って再送してみてね。", llm.error);
  }
  const parsed = llm.parsed || {};
  const doing = parsed?.status?.doing_text;
  const being = parsed?.status?.being_text;
  if ((typeof doing === "string" && doing) || (typeof being === "string" && being)) {
    if (typeof doing === "string" && doing) {
      session.status.doing_text = doing;
    }
    if (typeof being === "string" && being) {
      session.status.being_text = being;
    }
    const nextStep = Number(parsed?.meta?.step) || 7;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    const message = [session.status.doing_text, session.status.being_text].filter(Boolean).join("\n\n");
    return {
      response: message || "Doing/Being を更新したよ。",
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }
  if (typeof parsed?.response === "string") {
    return {
      response: parsed.response,
      status: session.status,
      meta: { step: 6 },
      drill: session.drill,
    };
  }
  return {
    response: "これまでの話をまとめるね。少し待ってて。",
    status: session.status,
    meta: { step: 6 },
    drill: session.drill,
  };
}

function initialGreeting(session) {
  return {
    response: "やっほー！まずは今持っている資格や研修名を教えてね✨",
    status: session.status,
    meta: { step: session.step },
    drill: session.drill,
  };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { message, sessionId } = req.body || {};
  const session = getSession(sessionId);
  saveSession(session);

  if (!message) {
    const greeting = initialGreeting(session);
    res.status(200).json(greeting);
    return;
  }

  session.history.push({ role: "user", text: message, step: session.step });

  let result;
  switch (session.step) {
    case 1:
      result = await handleStep1(session, message);
      break;
    case 2:
      result = await handleStep2(session, message);
      break;
    case 3:
      result = await handleStep3(session, message);
      break;
    case 4:
      result = await handleStep4(session, message);
      break;
    case 5:
      result = await handleStep5(session, message);
      break;
    default:
      result = await handleStep6(session, message);
      break;
  }

  if (!result || typeof result !== "object") {
    res.status(500).json({
      response: "サーバ内部で処理に失敗しちゃった。時間をおいて試してみてね。",
      status: session.status,
      meta: { step: session.step, error: "unknown" },
      drill: session.drill,
      _error: "unknown",
    });
    return;
  }

  if (result.status) {
    session.status = result.status;
  }
  if (result.meta?.step != null) {
    session.step = result.meta.step;
  }
  if (result.drill) {
    session.drill = result.drill;
  }
  saveSession(session);

  res.status(200).json(result);
}

module.exports = handler;
