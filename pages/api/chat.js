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
  const tried = [];

  const candidates = [
    path.join(__dirname, "..", "..", fileName),
    path.join(process.cwd(), fileName),
    path.join(__dirname, "..", "..", "..", fileName),
    path.join(process.cwd(), "public", fileName),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        try {
          return JSON.parse(raw);
        } catch (err) {
          tried.push({ step: "parse_error", path: filePath, error: err && err.message });
          console.error("json_parse_failed", fileName, filePath, err && err.message);
        }
      } else {
        tried.push({ step: "not_exist", path: filePath });
      }
    } catch (err) {
      tried.push({ step: "fs_error", path: filePath, error: err && err.message });
      console.error("json_read_failed", fileName, filePath, err && err.message);
    }
  }

  console.error("json_read_failed_all", fileName, JSON.stringify(tried));
  return null;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.items)) return value.items;
  if (value && typeof value === "object" && Array.isArray(value.qualifications)) return value.qualifications;
  return [];
}

let QUALIFICATIONS = ensureArray(loadJson("qualifications.json"));
let LICENSE_SOURCES = loadJson("licenses.json") || {};
let TAGS_DATA = loadJson("tags.json") || {};

try {
  // eslint-disable-next-line global-require
  QUALIFICATIONS = ensureArray(require("../../qualifications.json"));
} catch (e) {
  // フォールバックに任せる
}

try {
  // eslint-disable-next-line global-require
  LICENSE_SOURCES = require("../../licenses.json") || {};
} catch (e) {
  // フォールバックに任せる
}

try {
  // eslint-disable-next-line global-require
  TAGS_DATA = require("../../tags.json") || {};
} catch (e) {
  // フォールバックに任せる
}

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

function isNoMessage(text) {
  if (!text) return false;
  const n = String(text || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[。、．,]/g, "")
    .toLowerCase();
  return (
    n === "ない" ||
    n === "無い" ||
    n === "ありません" ||
    n === "ないです" ||
    n === "なし" ||
    n === "無し" ||
    n === "資格なし" ||
    n === "しかくなし"
  );
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
  // セッション移行：既存セッションに新しいカウンターフィールドを初期化
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0;
  }
  if (typeof session.meta.step3_deepening_count !== "number") {
    session.meta.step3_deepening_count = 0;
  }
  if (typeof session.meta.step4_deepening_count !== "number") {
    session.meta.step4_deepening_count = 0;
  }
  if (typeof session.meta.step5_deepening_count !== "number") {
    session.meta.step5_deepening_count = 0;
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

  if (isNoMessage(trimmed)) {
    session.step = 2;
    session.stage.turnIndex = 0;
    resetDrill(session);
    // 資格なしの場合は「ありがとう！」だけを表示してSTEP2へ強制移行
    return {
      response: "ありがとう！\n\n次は、あなたが今までやってきたことでこれからも活かしていきたいこと、あなたの強みを教えて！",
      status: session.status,
      meta: { step: 2 },
      drill: session.drill,
    };
  }

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

    // ID に紐づかない場合はエラーメッセージを返さず、そのままテキスト保存する
    if (!qualId) {
      if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
      if (!session.status.licenses.includes(selected)) session.status.licenses.push(selected);

      resetDrill(session);
      session.stage.turnIndex = 0;
      return {
        response: `「${selected}」はIDに紐づかなかったので、そのまま登録したよ。ほかにあれば教えて！なければ「ない」と言ってね`,
        status: session.status,
        meta: { step: 1 },
        drill: session.drill,
      };
    }

    const qualName = QUAL_NAME_BY_ID.get(qualId) || selected;

    // IDベースで未登録なら追加（現行のID設計を尊重）
    if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = [];
    if (!session.status.qual_ids.includes(qualId)) {
      session.status.qual_ids.push(qualId);
      if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
      if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName);
    }

    resetDrill(session);
    session.stage.turnIndex = 0;
    // 継続：step は上げない（ユーザーに追加有無を確認する）
    return {
      response: `「${qualName}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
      status: session.status,
      meta: { step: 1 },
      drill: session.drill,
    };
  }

  if (!trimmed) {
    return {
      response: "今持っている資格や研修名を一言で教えてね！複数ある場合は1つずつ教えてね。",
      status: session.status,
      meta: { step: 1 },
      drill: session.drill,
    };
  }

  const directId = resolveQualificationIdByName(trimmed);
  if (directId) {
    // ID 57 (資格なし) が検出された場合、STEP2へ強制移行
    if (directId === 57) {
      session.step = 2;
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: "ありがとう！\n\n次は、あなたが今までやってきたことでこれからも活かしていきたいこと、あなたの強みを教えて！",
        status: session.status,
        meta: { step: 2 },
        drill: session.drill,
      };
    }

    const qualName = QUAL_NAME_BY_ID.get(directId) || trimmed;

    if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = [];

    if (!session.status.qual_ids.includes(directId)) {
      // 新規追加（IDベース）
      session.status.qual_ids.push(directId);
      if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
      if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName);

      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `了解！「${qualName}」だね。次、他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
        meta: { step: 1 },
        drill: session.drill,
      };
    }

    // 既に登録済み
    return {
      response: `その資格は既に登録済みだよ。他にもある？あれば教えて！なければ「ない」と言ってね`,
      status: session.status,
      meta: { step: 1 },
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
      const qualName = QUAL_NAME_BY_ID.get(id) || label;
      if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = [];
      if (!session.status.qual_ids.includes(id)) {
        session.status.qual_ids.push(id);
        if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
        if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName);
      }
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `「${label}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
        meta: { step: 1 },
        drill: session.drill,
      };
    }

if (uniqueLabels.length === 1 && resolved.length === 0) {
  const label = uniqueLabels[0];
  if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
  if (!session.status.licenses.includes(label)) session.statu.licenses.push(label);
  session.stage.turnIndex = 0;
  resetDrill(session);
  return {
    response: `「${label}」だね。他にもある？あれば教えて！なければ「ない」と言ってね`,
    status: session.status,
    meta: { step: 1 },
    drill: session.drill,
  };
}


    if (resolved.length === 1) {
      const { label, id } = resolved[0];
      const qualName = QUAL_NAME_BY_ID.get(id) || label;
      if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = [];
      if (!session.status.qual_ids.includes(id)) {
        session.status.qual_ids.push(id);
        if (!Array.isArray(session.status.licenses)) session.status.licenses = [];
        if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName);
      }
      session.stage.turnIndex = 0;
      resetDrill(session);
      return {
        response: `「${label}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
        meta: { step: 1 },
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
    response: "ごめん、その資格名が見つからなかったよ。正式名称で教えてくれる？（まだ資格の登録中だよ）",
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

async function handleStep2(session, userText) {
  // userTextがある場合のみturnIndexをインクリメント（STEP遷移時はインクリメントしない）
  if (userText && userText.trim()) {
    session.stage.turnIndex += 1;
  }
  const payload = buildStepPayload(session, userText, 3);
  const llm = await callLLM(2, payload, session, { model: "gpt-4o" });

  if (!llm.ok) {
    return buildSchemaError(2, session, "あなたの「やってきたこと、これからも活かしていきたいこと」の処理でエラーが起きたみたい。もう一度話してみて！", llm.error);
  }

  const parsed = llm.parsed || {};

  // intro フェーズの処理（STEP2初回質問）
  if (parsed?.control?.phase === "intro") {
    // deepening_countをリセット
    if (!session.meta) session.meta = {};
    session.meta.step2_deepening_count = 0;
    return {
      response: parsed.response || "次は、あなたが今までやってきたことでこれからも活かしていきたいこと、あなたの強みを教えて！",
      status: session.status,
      meta: { step: 2 },
      drill: session.drill,
    };
  }

  const { empathy, paraphrase, ask_next, meta } = parsed;

  // 基本検査
  if (typeof empathy !== "string" || typeof paraphrase !== "string" || (ask_next != null && typeof ask_next !== "string")) {
    return buildSchemaError(2, session, "あなたの「やってきたこと、これからも活かしていきたいこと」の処理でエラーが起きたみたい。もう一度話してみて！");
  }

  // 表示用と正規化（同一判定には normKey を使う）
  const paraphraseDisplay = String(paraphrase || "").trim();
  const paraphraseNorm = normKey(paraphraseDisplay);

  // session.meta 初期化（安全）
  if (!session.meta) session.meta = {};
  if (typeof session.meta.last_can_paraphrase_norm !== "string") session.meta.last_can_paraphrase_norm = "";
  if (typeof session.meta.can_repeat_count !== "number") session.meta.can_repeat_count = 0;
  if (typeof session.meta.deepening_attempt_total !== "number") session.meta.deepening_attempt_total = Number(session.meta.deepening_attempt_total || 0);

  // can_texts 履歴初期化
  if (!Array.isArray(session.status.can_texts)) session.status.can_texts = [];

  // 履歴に追加（表示文を保存するが、同一判定は正規化キーで行う）
  const alreadyInHistory = session.status.can_texts.some(ct => normKey(String(ct || "")) === paraphraseNorm);
  if (paraphraseDisplay && !alreadyInHistory) {
    session.status.can_texts.push(paraphraseDisplay);
  }

  // paraphrase の安定判定（正規化キーで比較）
  if (paraphraseNorm && session.meta.last_can_paraphrase_norm === paraphraseNorm) {
    session.meta.can_repeat_count = (Number(session.meta.can_repeat_count) || 0) + 1;
  } else {
    session.meta.can_repeat_count = 1;
    session.meta.last_can_paraphrase_norm = paraphraseNorm;
  }

  // サーバー側でdeepening_countを管理（フェイルセーフ）
  if (!session.meta) session.meta = {};
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0;
  }
  session.meta.step2_deepening_count += 1;

  // STEP2では meta.step は 3 のみが有効（STEP3への遷移）
  // 1 や 2 などの不正な値が返ってきた場合は無視する
  let llmNextStep = Number(meta?.step) || session.step;
  if (llmNextStep !== session.step && llmNextStep !== 3) {
    console.warn(`[STEP2 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`);
    llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
  }

  let nextStep = llmNextStep;
  if (llmNextStep === session.step || llmNextStep === 3) {
    // サーバー側の暴走停止装置（フェイルセーフ）
    const deepeningCount = Number(meta?.deepening_count) || 0;
    const serverCount = session.meta.step2_deepening_count || 0;

    // ユーザー素材の把握（Doing/Being生成に必要な質を確認）
    const userStep2Texts = session.history
      .filter(h => h.step === 2 && h.role === "user" && typeof h.text === "string")
      .map(h => h.text.trim())
      .filter(Boolean);
    const distinctStrengths = new Set(
      (session.status.can_texts || []).map(ct => normKey(String(ct || "")))
    );

    const hasEnoughStrengths = distinctStrengths.size >= 2;
    const hasEnoughEpisodes = userStep2Texts.length >= 2;
    const hasEnoughMaterial = hasEnoughStrengths && hasEnoughEpisodes;

    const MAX_DEEPENING = 3;
    const deepeningMaxed = Math.max(deepeningCount, serverCount) >= MAX_DEEPENING;

    if (nextStep === 3 && !hasEnoughMaterial) {
      console.log(
        `[STEP2 INFO] Holding transition to enrich material. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      );
      nextStep = session.step;
    }

    if (!hasEnoughMaterial && deepeningMaxed) {
      console.warn(
        `[STEP2 WARN] Max deepening reached without sufficient material. Proceeding to STEP3 forcibly. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      );
      nextStep = 3;
    } else if (hasEnoughMaterial && deepeningMaxed) {
      console.log(
        `[STEP2 INFO] Max deepening reached with sufficient material. Proceeding to STEP3. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}`
      );
      nextStep = 3;
    }

    if (nextStep === 3 && hasEnoughMaterial && !deepeningMaxed) {
      console.log(
        `[STEP2 INFO] Adequate material confirmed before max deepening. Proceeding to STEP3. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      );
    }

    // 念のため、深掘り回数が上限に達した場合は必ず遷移
    if (nextStep !== 3 && deepeningMaxed) {
      nextStep = 3;
    }
  }

  if (nextStep !== session.step) {
    session.status.can_text = paraphraseDisplay;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step2_deepening_count = 0;

    switch (nextStep) {
      case 3: {
        // STEP3の初回質問を取得
        const step3Response = await handleStep3(session, "");
        // STEP2の共感 → 中間メッセージ → STEP3の初回質問を結合して返す
        const combinedResponse = [empathy, "ありがとう！", step3Response.response].filter(Boolean).join("\n\n");
        return {
          response: combinedResponse || step3Response.response,
          status: step3Response.status,
          meta: step3Response.meta,
          drill: step3Response.drill,
        };
      }
      case 4: {
        // STEP4の初回質問を取得
        const step4Response = await handleStep4(session, "");
        const combinedResponse = [empathy, step4Response.response].filter(Boolean).join("\n\n");
        return {
          response: combinedResponse || step4Response.response,
          status: step4Response.status,
          meta: step4Response.meta,
          drill: step4Response.drill,
        };
      }
      default:
        return {
          response: [empathy, ask_next].filter(Boolean).join("\n\n") || paraphraseDisplay || "受け取ったよ。",
          status: session.status,
          meta: { step: session.step },
          drill: session.drill,
        };
    }
  }

  // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
  const message = [empathy, ask_next].filter(Boolean).join("\n\n") || paraphraseDisplay || "ありがとう。もう少し教えて。";
  return {
    response: message,
    status: session.status,
    meta: { step: session.step },
    drill: session.drill,
  };
}


async function handleStep3(session, userText) {
  // userTextがある場合のみturnIndexをインクリメント（STEP遷移時はインクリメントしない）
  if (userText && userText.trim()) {
    session.stage.turnIndex += 1;
  }
  const payload = buildStepPayload(session, userText, 5);
  const llm = await callLLM(3, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(3, session, "あなたの「これから挑戦したいこと」の生成でエラーが発生したよ。少し時間を置いてみてね。", llm.error);
  }
  const parsed = llm.parsed || {};

  // intro フェーズ（初回質問）
  if (parsed?.control?.phase === "intro") {
    // deepening_countをリセット
    if (!session.meta) session.meta = {};
    session.meta.step3_deepening_count = 0;
    return {
      response: parsed.response || "これから挑戦してみたいことや、やってみたい仕事を教えて！まったくやったことがないものでも大丈夫。ちょっと気になってることでもOKだよ✨",
      status: session.status,
      meta: { step: 3 },
      drill: session.drill,
    };
  }

  // generation フェーズ（Will確定、STEP4へ移行）
  if (parsed?.status?.will_text && typeof parsed.status.will_text === "string") {
    session.status.will_text = parsed.status.will_text;
    if (!Array.isArray(session.status.will_texts)) {
      session.status.will_texts = [];
    }
    session.status.will_texts.push(parsed.status.will_text);
    const nextStep = Number(parsed?.meta?.step) || 4;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step3_deepening_count = 0;

    // STEP4の初回質問を取得して結合
    const step4Response = await handleStep4(session, "");
    // Will生成文 → 中間メッセージ → STEP4の初回質問を結合
    const combinedResponse = [parsed.status.will_text, "ありがとう！", step4Response.response].filter(Boolean).join("\n\n");
    return {
      response: combinedResponse || step4Response.response,
      status: session.status,
      meta: { step: session.step },
      drill: step4Response.drill,
    };
  }

  // empathy + deepening フェーズ（STEP2と同じ構造）
  const { empathy, ask_next, meta } = parsed;
  if (typeof empathy === "string") {
    // サーバー側でdeepening_countを管理（フェイルセーフ）
    if (!session.meta) session.meta = {};
    if (typeof session.meta.step3_deepening_count !== "number") {
      session.meta.step3_deepening_count = 0;
    }
    session.meta.step3_deepening_count += 1;

    // STEP3では meta.step は 4 のみが有効（STEP4への遷移）
    // 1, 2, 3 などの不正な値が返ってきた場合は無視する
    let llmNextStep = Number(meta?.step) || session.step;
    if (llmNextStep !== session.step && llmNextStep !== 4) {
      console.warn(`[STEP3 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`);
      llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
    }

    let nextStep = llmNextStep;

    // サーバー側の暴走停止装置（フェイルセーフ）
    // LLMのdeepening_countとサーバー側のカウントの両方をチェック
    const deepeningCount = Number(meta?.deepening_count) || 0;
    const serverCount = session.meta.step3_deepening_count || 0;

    if (llmNextStep === session.step && (deepeningCount >= 3 || serverCount >= 3)) {
      // 3回に達したら強制的にSTEP4へ
      nextStep = 4;
      console.log(`[STEP3 FAILSAFE] Forcing transition to STEP4. LLM count: ${deepeningCount}, Server count: ${serverCount}`);
    }

    if (nextStep !== session.step) {
      // STEP4へ移行
      // フェイルセーフで遷移する場合でも、LLMにwill_textを生成させる
      // session.historyからSTEP3のユーザー発話を取得
      const step3Texts = session.history
        .filter(h => h.step === 3 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean);

      // LLMにgenerationを依頼（強制的にwill_text生成）
      const genPayload = {
        locale: "ja",
        stage: { turn_index: 999 }, // 終了フラグ
        user_text: step3Texts.join("。"), // 全ての発話を結合
        recent_texts: step3Texts,
        status: session.status,
        force_generation: true, // generationフェーズを強制
      };

      const genLLM = await callLLM(3, genPayload, session, { model: "gpt-4o" });
      let generatedWill = "これから挑戦したいことについて伺いました。";

      if (genLLM.ok && genLLM.parsed?.status?.will_text) {
        generatedWill = genLLM.parsed.status.will_text;
      } else if (step3Texts.length > 0) {
        // LLM失敗時は最後の発話を整形
        const lastText = step3Texts[step3Texts.length - 1];
        generatedWill = lastText.length > 50 ? lastText : `${lastText}に挑戦したい`;
      }

      session.status.will_text = generatedWill;
      if (!Array.isArray(session.status.will_texts)) {
        session.status.will_texts = [];
      }
      session.status.will_texts.push(generatedWill);

      session.step = nextStep;
      session.stage.turnIndex = 0;
      // deepening_countをリセット
      session.meta.step3_deepening_count = 0;

      const step4Response = await handleStep4(session, "");
      const combinedResponse = [empathy, "ありがとう！次の質問に移るね", step4Response.response].filter(Boolean).join("\n\n");
      return {
        response: combinedResponse || step4Response.response,
        status: session.status,
        meta: { step: session.step },
        drill: step4Response.drill,
      };
    }

    // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
    const message = [empathy, ask_next].filter(Boolean).join("\n\n") || empathy || "ありがとう。もう少し教えて。";
    return {
      response: message,
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }

  return {
    response: "これから挑戦したいことについて、もう少し具体的に教えてほしい。短くで良いから、やってみたいことの概要を教えて。",
    status: session.status,
    meta: { step: 3 },
    drill: session.drill,
  };
}

/**
 * ユーザー発話から直接ID候補を検索（最優先・最速）
 * 完全一致・部分一致で即座にタグを絞り込む
 */
function findDirectIdMatches(userText, tagsData) {
  if (!userText || !tagsData?.tags || !Array.isArray(tagsData.tags)) {
    return [];
  }

  const text = userText.toLowerCase().trim();
  const matches = [];
  
  for (const tag of tagsData.tags) {
    const name = tag.name.toLowerCase();
    
    // 完全一致（最優先）
    if (text === name) {
      matches.unshift(tag); // 先頭に追加
      continue;
    }
    
    // 部分一致（ユーザー発話にタグ名が含まれる、またはその逆）
    if (text.includes(name) || name.includes(text)) {
      matches.push(tag);
    }
  }
  
  return matches;
}

/**
 * ユーザー発話からタグを絞り込む（高速化）
 * 戦略：
 * 0. 直接マッチング：完全一致・部分一致で即座に絞り込み（NEW）
 * 1. キーワードマッチング：頻出ワード（残業、夜勤等）で即座に絞り込み
 * 2. カテゴリー推定：発話内容からカテゴリーを推定し、該当カテゴリーのタグのみを返す
 * 3. 全タグ：該当なしの場合のみ全タグを返す（フォールバック）
 */
function filterTagsByUserText(userText, tagsData) {
  if (!userText || !tagsData?.tags || !Array.isArray(tagsData.tags)) {
    return tagsData;
  }

  const text = userText.toLowerCase();
  const allTags = tagsData.tags;

  // 【ステップ0】直接マッチング（最優先）
  const directMatches = findDirectIdMatches(userText, tagsData);
  if (directMatches.length > 0 && directMatches.length <= 10) {
    // 候補が10件以下なら即座に返す（LLMの負荷を最小化）
    console.log(`[STEP4 Filter] Direct match: ${directMatches.length} tags (${directMatches.map(t => t.name).join(", ")})`);
    return { tags: directMatches };
  }

  // 【ステップ1】キーワードマッチング（最優先）
  // 頻出ワードで即座にID候補を絞り込む
  const keywordMap = {
    // 勤務時間関連
    "残業": ["勤務時間"],
    "夜勤": ["勤務時間"],
    "日勤": ["勤務時間"],
    "オンコール": ["勤務時間"],
    "時短": ["勤務時間"],
    "夜間": ["勤務時間"],
    "深夜": ["勤務時間"],
    
    // 休日関連
    "休み": ["休日"],
    "休日": ["休日"],
    "週休": ["休日"],
    "連休": ["休日"],
    "有給": ["休日"],
    
    // 給与関連
    "給料": ["給与・賞与"],
    "給与": ["給与・賞与"],
    "年収": ["給与・賞与"],
    "賞与": ["給与・賞与"],
    "ボーナス": ["給与・賞与"],
    "昇給": ["給与・賞与"],
    
    // 福利厚生関連
    "リモート": ["福利厚生"],
    "在宅": ["福利厚生"],
    "テレワーク": ["福利厚生"],
    "託児": ["福利厚生"],
    "保育": ["福利厚生"],
    "育休": ["福利厚生"],
    "産休": ["福利厚生"],
    
    // アクセス関連
    "通勤": ["アクセス"],
    "駅": ["アクセス"],
    "車": ["アクセス"],
    "バス": ["アクセス"],
    
    // 教育・研修関連
    "研修": ["教育体制・研修制度"],
    "勉強": ["教育体制・研修制度"],
    "教育": ["教育体制・研修制度"],
    "セミナー": ["教育体制・研修制度"],
    
    // サービス形態関連
    "病院": ["サービス形態"],
    "クリニック": ["サービス形態"],
    "施設": ["サービス形態"],
    "訪問": ["サービス形態"],
    "デイ": ["サービス形態"],
    "老健": ["サービス形態"],
    "特養": ["サービス形態"],
    
    // 診療科関連
    "内科": ["診療科・分野"],
    "外科": ["診療科・分野"],
    "小児": ["診療科・分野"],
    "整形": ["診療科・分野"],
    "精神": ["診療科・分野"],
    "リハビリ": ["診療科・分野"],
    "透析": ["診療科・分野"],
  };

  // キーワードで該当するカテゴリーを収集
  const matchedCategories = new Set();
  for (const [keyword, categories] of Object.entries(keywordMap)) {
    if (text.includes(keyword)) {
      categories.forEach(cat => matchedCategories.add(cat));
    }
  }

  // キーワードマッチした場合、該当カテゴリーのタグのみを返す
  if (matchedCategories.size > 0) {
    const filtered = allTags.filter(tag => matchedCategories.has(tag.category));
    console.log(`[STEP4 Filter] Keyword match: ${Array.from(matchedCategories).join(", ")} (${filtered.length}/${allTags.length} tags)`);
    return { tags: filtered };
  }

  // 【ステップ2】カテゴリー推定（キーワードマッチなしの場合）
  // 文脈から推定
  const contextMap = {
    "働き方": ["勤務時間", "休日", "福利厚生"],
    "雰囲気": ["サービス形態"],
    "環境": ["サービス形態", "福利厚生"],
    "待遇": ["給与・賞与", "福利厚生"],
    "場所": ["アクセス", "サービス形態"],
    "スキル": ["教育体制・研修制度", "専門資格"],
    "専門": ["診療科・分野", "専門資格"],
  };

  for (const [keyword, categories] of Object.entries(contextMap)) {
    if (text.includes(keyword)) {
      categories.forEach(cat => matchedCategories.add(cat));
    }
  }

  if (matchedCategories.size > 0) {
    const filtered = allTags.filter(tag => matchedCategories.has(tag.category));
    console.log(`[STEP4 Filter] Context match: ${Array.from(matchedCategories).join(", ")} (${filtered.length}/${allTags.length} tags)`);
    return { tags: filtered };
  }

  // 【ステップ3】フォールバック：全タグを返す
  console.log(`[STEP4 Filter] No match. Returning all tags (${allTags.length} tags)`);
  return tagsData;
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
  // サーバー側カウンター初期化（LLM呼び出し前に確実に初期化）
  if (!session.meta) session.meta = {};
  if (typeof session.meta.step4_deepening_count !== "number") {
    session.meta.step4_deepening_count = 0;
  }

  // 【重要】STEP遷移時（userTextが空）は、LLMを呼ばずにintro質問を返す
  if (!userText || !userText.trim()) {
    // intro質問を既に表示済みの場合は空応答を返す（重複防止）
    if (session.meta.step4_intro_shown) {
      console.log("[STEP4] Intro already shown. Returning empty response.");
      return {
        response: "",
        status: session.status,
        meta: { step: 4, phase: "waiting" },
        drill: session.drill,
      };
    }

    // intro質問を表示してフラグを立てる（deepening_countは0のまま）
    session.meta.step4_intro_shown = true;
    console.log("[STEP4] Showing intro question for the first time.");
    return {
      response: "働く上で『ここだけは譲れないな』って思うこと、ある？職場の雰囲気でも働き方でもOKだよ✨",
      status: session.status,
      meta: { step: 4, phase: "intro", deepening_count: 0 },
      drill: session.drill,
    };
  }

  // userTextがある場合のみturnIndexをインクリメント
  session.stage.turnIndex += 1;

  // 【超高速化】直接マッチングでID確定を試みる
  const directMatches = findDirectIdMatches(userText, TAGS_DATA);
  let autoConfirmedIds = [];

  if (directMatches.length > 0 && directMatches.length <= 5) {
    // 直接マッチが5件以下の場合、自動でID確定
    autoConfirmedIds = directMatches.map(tag => tag.id);
    console.log(`[STEP4 FAST] Auto-confirmed IDs: ${autoConfirmedIds.join(", ")} from direct match`);

    // ID確定（LLMスキップ）
    if (!session.status.must_have_ids) session.status.must_have_ids = [];
    if (!session.status.direction_map) session.status.direction_map = {};

    autoConfirmedIds.forEach(id => {
      if (!session.status.must_have_ids.includes(id)) {
        session.status.must_have_ids.push(id);
        session.status.direction_map[String(id)] = "have"; // デフォルトはhave
      }
    });
  }

  // 【高速化】ユーザー発話からタグを絞り込む（全2306行→数十行に削減）
  const filteredTags = filterTagsByUserText(userText, TAGS_DATA);

  // LLMの役割：
  // - ID確定済みの場合：ネガ/ポジ判断 + 共感文生成のみ
  // - ID未確定の場合：従来通りID化も含める
  const step4History = session.history.filter(h => h.step === 4);
  const payload = {
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    user_text: userText,
    recent_texts: step4History.slice(-6).map(item => item.text),
    status: session.status,
    deepening_attempt_total: session.meta.step4_deepening_count,
    tags: filteredTags,
    auto_confirmed_ids: autoConfirmedIds.length > 0 ? autoConfirmedIds : undefined, // ID確定済みフラグ
  };

  const llm = await callLLM(4, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(4, session, "あなたの譲れない条件の整理に失敗しちゃった。もう一度教えてもらえる？", llm.error);
  }
  const parsed = llm.parsed || {};

  // intro フェーズ（安全装置：LLMが予期せずintroを返した場合）
  if (parsed?.control?.phase === "intro") {
    // 既にintro質問を表示済みの場合はスキップ（重複防止）
    if (session.meta.step4_intro_shown) {
      console.warn("[STEP4 WARNING] LLM returned intro phase but intro was already shown. Treating as empathy phase.");
      // カウンターは既にインクリメント済みなので、そのまま継続
      // empathyフェーズとして処理を続行
      parsed.control.phase = "empathy";
      // 以下の処理を続行させる（return しない）
    } else {
      // intro質問を初めて表示する（通常はここには来ないはず）
      console.log("[STEP4] LLM returned intro. Showing intro question.");
      session.meta.step4_intro_shown = true;
      session.meta.step4_deepening_count = 0;
      return {
        response: parsed.response || "働く上で『ここだけは譲れないな』って思うこと、ある？職場の雰囲気でも働き方でもOKだよ✨",
        status: session.status,
        meta: { step: 4, phase: "intro", deepening_count: 0 },
        drill: session.drill,
      };
    }
  }

  // ユーザーが応答した場合、カウンターを増やす
  session.meta.step4_deepening_count += 1;
  console.log(`[STEP4] User responded. Counter: ${session.meta.step4_deepening_count}`);


  // サーバー側の暴走停止装置（フェイルセーフ） - generationより前にチェック
  const serverCount = session.meta.step4_deepening_count || 0;
  // 2回のやり取りで強制的にgenerationフェーズへ（しつこすぎるのを防止）
  if (serverCount >= 2) {
    console.log(`[STEP4 FAILSAFE] Forcing transition to STEP5. Server count: ${serverCount}`);

    // フェイルセーフで遷移する場合でも、LLMにmust_ids/must_textを生成させる
    // session.historyからSTEP4のユーザー発話を取得
    const step4Texts = session.history
      .filter(h => h.step === 4 && h.role === "user")
      .map(h => h.text)
      .filter(Boolean);

    // LLMにgenerationを依頼（強制的にmust_ids生成）
    // 全発話を結合してタグを絞り込む
    const combinedText = step4Texts.join("。");
    const filteredTagsForGen = filterTagsByUserText(combinedText, TAGS_DATA);
    
    const genPayload = {
      locale: "ja",
      stage: { turn_index: 999 }, // 終了フラグ
      user_text: combinedText, // 全ての発話を結合
      recent_texts: step4Texts,
      status: session.status,
      force_generation: true, // generationフェーズを強制
      tags: filteredTagsForGen,  // 絞り込んだタグのみを送る
    };

    const genLLM = await callLLM(4, genPayload, session, { model: "gpt-4o" });

    if (genLLM.ok && genLLM.parsed?.status) {
      // LLM生成成功：statusを適用
      applyMustStatus(session, genLLM.parsed.status, genLLM.parsed.meta || {});
    } else if (step4Texts.length > 0) {
      // LLM失敗時：最後の発話を整形してmust_textに設定
      const lastText = step4Texts[step4Texts.length - 1];
      session.status.must_text = lastText.length > 50 ? lastText : `${lastText}について伺いました。`;
      // must_have_idsは空配列のまま（ID化できなかった）
      if (!Array.isArray(session.status.must_have_ids)) {
        session.status.must_have_ids = [];
      }
    } else {
      // 発話がない場合のフォールバック
      session.status.must_text = "譲れない条件について伺いました。";
      session.status.must_have_ids = [];
    }

    session.step = 5;
    session.stage.turnIndex = 0;
    session.meta.step4_deepening_count = 0;

    const step5Response = await handleStep5(session, "");
    // must_textは表示せず、STEP5の質問のみを返す（LLMの不要な発話を防ぐ）
    return {
      response: step5Response.response,
      status: session.status,
      meta: { step: session.step },
      drill: step5Response.drill,
    };
  }

  // generation フェーズ（Must確定、STEP5へ移行）
  if (parsed?.status && typeof parsed.status === "object") {
    // LLM から帰ってきた譲れない条件をセッションへ適用
    applyMustStatus(session, parsed.status, parsed.meta || {});
    
    // ID化が行われていない場合、強制的にID化を試みる
    const hasMustIds = Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0;
    const hasNgIds = Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0;
    const hasPendingIds = Array.isArray(session.status.pending_ids) && session.status.pending_ids.length > 0;
    
    if (!hasMustIds && !hasNgIds && !hasPendingIds) {
      // ID化が行われていない場合、LLMにgenerationを依頼
      console.log("[STEP4] No IDs found in status. Forcing ID generation.");
      const step4Texts = session.history
        .filter(h => h.step === 4 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean);
      
      // 全発話を結合してタグを絞り込む
      const combinedText = step4Texts.join("。");
      const filteredTagsForGen = filterTagsByUserText(combinedText, TAGS_DATA);
      
      const genPayload = {
        locale: "ja",
        stage: { turn_index: 999 },
        user_text: combinedText,
        recent_texts: step4Texts,
        status: session.status,
        force_generation: true,
        tags: filteredTagsForGen,  // 絞り込んだタグのみを送る
      };
      
      const genLLM = await callLLM(4, genPayload, session, { model: "gpt-4o" });
      
      if (genLLM.ok && genLLM.parsed?.status) {
        // LLM生成成功：statusを適用
        applyMustStatus(session, genLLM.parsed.status, genLLM.parsed.meta || {});
      } else if (step4Texts.length > 0) {
        // LLM失敗時でも最低限のmust_textを設定
        const lastText = step4Texts[step4Texts.length - 1];
        session.status.must_text = lastText.length > 50 ? lastText : `${lastText}について伺いました。`;
        if (!session.status.status_bar) {
          session.status.status_bar = "";
        }
      }
    }
    
    // status_barが空の場合、must_have_idsまたはng_idsから生成
    if (!session.status.status_bar || session.status.status_bar.trim() === "") {
      const statusBarParts = [];
      if (Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0) {
        const directionMap = session.status.direction_map || {};
        session.status.must_have_ids.forEach(id => {
          const direction = directionMap[String(id)] || "have";
          statusBarParts.push(`ID:${id}/${direction}`);
        });
      }
      if (Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0) {
        const directionMap = session.status.direction_map || {};
        session.status.ng_ids.forEach(id => {
          const direction = directionMap[String(id)] || "ng";
          statusBarParts.push(`ID:${id}/${direction}`);
        });
      }
      if (Array.isArray(session.status.pending_ids) && session.status.pending_ids.length > 0) {
        session.status.pending_ids.forEach(id => {
          statusBarParts.push(`ID:${id}/pending`);
        });
      }
      if (statusBarParts.length > 0) {
        session.status.status_bar = statusBarParts.join(",");
      }
    }
    
    // 次のステップは LLM の meta から決定（デフォルトは 5）
    // STEP4では meta.step は 5 または 6 のみが有効
    let nextStep = Number(parsed?.meta?.step) || 5;
    if (nextStep !== 5 && nextStep !== 6) {
      console.warn(`[STEP4 WARNING] Invalid meta.step=${nextStep} from LLM. Defaulting to 5.`);
      nextStep = 5;  // 不正な値の場合はデフォルトの5にする
    }

    // セッションを次STEPにセットして、次STEPの初回質問を取得
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step4_deepening_count = 0;

    switch (nextStep) {
      case 5: {
        // STEP5（Self）の初回質問を取得
        const step5Response = await handleStep5(session, "");
        // LLM生成の共感文（ネガ/ポジ判断済み） → STEP5の質問を結合
        const empathyMessage = parsed.response || "ありがとう！";
        const combinedResponse = [empathyMessage, step5Response.response].filter(Boolean).join("\n\n");
        return {
          response: combinedResponse || step5Response.response,
          status: session.status,
          meta: { step: session.step, deepening_count: 0 },
          drill: step5Response.drill,
        };
      }
      case 6: {
        // STEP6（Doing/Being）を即実行
        const step6Response = await handleStep6(session, "");
        const combinedResponse = [session.status.must_text, step6Response.response].filter(Boolean).join("\n\n");
        return {
          response: combinedResponse || step6Response.response,
          status: session.status,
          meta: { step: session.step, deepening_count: 0 },
          drill: step6Response.drill,
        };
      }
      default:
        // 想定外の nextStep の場合は譲れない条件を保存した旨だけ返す（余計な確認はしない）
        return {
          response: session.status.must_text || "譲れない条件を受け取ったよ。",
          status: session.status,
          meta: { step: session.step, deepening_count: 0 },
          drill: session.drill,
        };
    }
  }

  // 通常の会話フェーズ（empathy, candidate_extraction, direction_check, deepening など）
  if (parsed?.control?.phase) {
    let responseText = parsed.response || "";

    // 【安全装置1】empathyフェーズの場合、共感だけでなく質問も追加
    if (parsed.control.phase === "empathy") {
      // ユーザー発話が短い単語の場合（10文字以下）、方向性を確認する質問を追加
      const userInput = userText || "";
      const isShortWord = userInput.length <= 10;

      let question;
      if (isShortWord && serverCount === 0) {
        // 初回：方向性を確認（あってほしいのか、なしにしてほしいのか）
        if (userInput.includes("残業")) {
          question = "『残業なし』がいい？それとも『多少の残業はOK』くらい？";
        } else if (userInput.includes("リモート") || userInput.includes("在宅")) {
          question = "『フルリモート』がいい？それとも『週に何回かリモート』くらい？";
        } else if (userInput.includes("休み") || userInput.includes("休日")) {
          question = "休日はどのくらい欲しい？『完全週休2日』？それとも『月6日以上あればOK』？";
        } else {
          question = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
        }
      } else {
        // 2回目以降：方向性（have/ng）を確認する質問を優先
        // まず方向性を確認してから、重要度や具体的な場面を確認
        const userInput = userText || "";
        const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
        const combinedText = `${userInput} ${recentTexts}`;
        
        // 方向性がまだ確定していない場合、方向性を確認する質問を優先
        if (serverCount === 1) {
          // 残業の場合
          if (combinedText.includes("残業")) {
            question = "それって『残業なし』がいい？それとも『多少の残業はOK』くらい？";
          } else if (combinedText.includes("リモート") || combinedText.includes("在宅")) {
            question = "それって『フルリモート』がいい？それとも『週に何回かリモート』くらい？";
          } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
            question = "それって『完全週休2日』がいい？それとも『月6日以上あればOK』くらい？";
          } else {
            // デフォルト：方向性を確認
            question = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
          }
        } else {
          // 3回目以降：重要度や具体的な場面を確認
          const questions = [
            "その条件、具体的にどんな場面で必要だと感じる？",
            "それが叶わないと、どんなことが困る？"
          ];
          question = questions[Math.min(serverCount - 2, questions.length - 1)] || "その条件について、もう少し詳しく教えてくれる？";
        }
      }

      responseText = responseText ? `${responseText}\n\n${question}` : question;
    }

    // 【安全装置2】曖昧な質問を検出して具体的な質問に置き換える
    const vaguePatterns = [
      /もう少し詳しく/,
      /もっと具体的に/,
      /詳しく教えて/,
      /もう少し話して/,
      /具体的に聞かせて/
    ];

    const isVague = vaguePatterns.some(pattern => pattern.test(responseText));

    if (isVague || (!responseText && parsed.control.phase !== "empathy")) {
      // ユーザーの発話内容を取得
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const currentText = userText || "";
      const combinedText = `${currentText} ${recentTexts}`;

      // カウンターに応じて具体的な質問を生成（ユーザーの発話内容に基づく）
      if (serverCount === 0) {
        responseText = "例えば働き方で言うと、『リモートワークができる』『フレックスタイム』『残業なし』とか、どれが一番大事？";
      } else if (serverCount === 1) {
        // 方向性を確認する質問
        if (combinedText.includes("残業")) {
          responseText = "それって『残業なし』がいい？それとも『多少の残業はOK』くらい？";
        } else if (combinedText.includes("リモート") || combinedText.includes("在宅")) {
          responseText = "それって『フルリモート』がいい？それとも『週に何回かリモート』くらい？";
        } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
          responseText = "それって『完全週休2日』がいい？それとも『月6日以上あればOK』くらい？";
        } else {
          responseText = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
        }
      } else {
        // 3回目以降：方向性が確定していない場合は方向性を確認、確定している場合は重要度を確認
        // 方向性が確定していない場合は比較質問は出さない
        let comparisonQuestion;
        
        // 方向性を示すキーワードをチェック
        const hasPositiveKeywords = combinedText.includes("欲しい") || combinedText.includes("いい") || combinedText.includes("希望") || combinedText.includes("理想");
        const hasNegativeKeywords = combinedText.includes("避けたい") || combinedText.includes("嫌") || combinedText.includes("なし") || combinedText.includes("したくない");
        
        // 方向性が確定していない場合
        if (!hasPositiveKeywords && !hasNegativeKeywords) {
          // 方向性を確認する質問
          if (combinedText.includes("残業")) {
            comparisonQuestion = "それって『残業なし』がいい？それとも『多少の残業はOK』くらい？";
          } else if (combinedText.includes("リモート") || combinedText.includes("在宅")) {
            comparisonQuestion = "それって『フルリモート』がいい？それとも『週に何回かリモート』くらい？";
          } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
            comparisonQuestion = "それって『完全週休2日』がいい？それとも『月6日以上あればOK』くらい？";
          } else {
            comparisonQuestion = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
          }
        } else {
          // 方向性が確定している場合は重要度を確認
          comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？";
        }
        responseText = comparisonQuestion;
      }
    }

    // LLMの応答が空の場合のフォールバック（origin/mainから追加）
    if (!responseText || responseText.trim() === "") {
      console.warn(`[STEP4 WARNING] Empty response from LLM (phase: ${parsed.control.phase}). Using fallback.`);
      responseText = "ありがとう。その条件について確認させてね";
    }

    return {
      response: responseText,
      status: session.status,
      meta: {
        step: 4,
        phase: parsed.control.phase,
        deepening_count: serverCount,
      },
      drill: session.drill,
    };
  }

  // 最終フォールバック（通常はここに到達しない）
  return {
    response: "働く上で『ここだけは譲れない』って条件、他にもある？例えば働き方、職場の雰囲気、給与、休日とか。",
    status: session.status,
    meta: { step: 4, deepening_count: serverCount },
    drill: session.drill,
  };
}

async function handleStep5(session, userText) {
  // userTextがある場合のみturnIndexをインクリメント（STEP遷移時はインクリメントしない）
  if (userText && userText.trim()) {
    session.stage.turnIndex += 1;
  }
  const payload = buildStepPayload(session, userText, 6);
  // STEP5はGPT-5を使用（自己分析深掘り）
  let llm = await callLLM(5, payload, session, { model: "gpt-5" });
  if (!llm.ok) {
    console.warn(
      `[STEP5 WARNING] GPT-5 call failed (${llm.error || "unknown error"}). Retrying with GPT-4o.`
    );
    llm = await callLLM(5, payload, session, { model: "gpt-4o" });
  }
  if (!llm.ok) {
    console.error(
      `[STEP5 ERROR] GPT-5/GPT-4o both failed. Returning fallback message. Error: ${llm.error || "unknown"}`
    );
    return buildSchemaError(5, session, "ちょっと処理に時間がかかってるみたい。もう一度話してみてね。", llm.error);
  }
  const parsed = llm.parsed || {};

  // intro フェーズ（初回質問）
  if (parsed?.control?.phase === "intro") {
    // deepening_countをリセット
    if (!session.meta) session.meta = {};
    session.meta.step5_deepening_count = 0;
    return {
      response: parsed.response || "あなた自身を一言で言うと、どんな人？周りからよく言われる「あなたらしさ」もあれば教えて😊",
      status: session.status,
      meta: { step: 5 },
      drill: session.drill,
    };
  }

  // generation フェーズ（Self確定、STEP6へ移行）
  if (parsed?.status?.self_text && typeof parsed.status.self_text === "string") {
    session.status.self_text = parsed.status.self_text;
    // STEP5では meta.step は 6 のみが有効
    let nextStep = Number(parsed?.meta?.step) || 6;
    if (nextStep !== 6) {
      console.warn(`[STEP5 WARNING] Invalid meta.step=${nextStep} from LLM. Defaulting to 6.`);
      nextStep = 6;  // 不正な値の場合はデフォルトの6にする
    }
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step5_deepening_count = 0;

    // STEP6は次の通信で呼ばれるように、ここでは生成メッセージだけ返す
    const transitionMessage = "たくさん話してくれてありがとう！\n\n今あなたオリジナルのキャリアシートを作成しているよ。少し待ってね";
    return {
      response: transitionMessage,
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }

  // empathy + deepening フェーズ（STEP2/3と同じ構造）
  const { empathy, ask_next, meta } = parsed;
  if (typeof empathy === "string") {
    // サーバー側でdeepening_countを管理（フェイルセーフ）
    if (!session.meta) session.meta = {};
    if (typeof session.meta.step5_deepening_count !== "number") {
      session.meta.step5_deepening_count = 0;
    }
    session.meta.step5_deepening_count += 1;

    // STEP5では meta.step は 6 のみが有効（STEP6への遷移）
    // 1, 2, 3, 4, 5 などの不正な値が返ってきた場合は無視する
    let llmNextStep = Number(meta?.step) || session.step;
    if (llmNextStep !== session.step && llmNextStep !== 6) {
      console.warn(`[STEP5 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`);
      llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
    }

    let nextStep = llmNextStep;

    // サーバー側の暴走停止装置（フェイルセーフ）
    // LLMのdeepening_countとサーバー側のカウントの両方をチェック
    const deepeningCount = Number(meta?.deepening_count) || 0;
    const serverCount = session.meta.step5_deepening_count || 0;

    if (llmNextStep === session.step && (deepeningCount >= 3 || serverCount >= 3)) {
      // 3回に達したら強制的にSTEP6へ
      // ただし、self_textが生成されていない場合は先に生成する
      if (!session.status.self_text) {
        console.log(`[STEP5 FAILSAFE] Forcing self_text generation before transition to STEP6.`);
        // session.historyからSTEP5のユーザー発話を取得
        const step5Texts = session.history
          .filter(h => h.step === 5 && h.role === "user")
          .map(h => h.text)
          .filter(Boolean);

        // LLMにgenerationを依頼（強制的にself_text生成）
        const genPayload = {
          locale: "ja",
          stage: { turn_index: 999 },
          user_text: step5Texts.join("。"),
          recent_texts: step5Texts,
          status: session.status,
          force_generation: true,
        };

        const genLLM = await callLLM(5, genPayload, session, { model: "gpt-5" });

        if (genLLM.ok && genLLM.parsed?.status?.self_text) {
          session.status.self_text = genLLM.parsed.status.self_text;
        } else if (step5Texts.length > 0) {
          // LLM失敗時：最後の発話を整形してself_textに設定
          const lastText = step5Texts[step5Texts.length - 1];
          session.status.self_text = lastText.length > 50 ? lastText : `${lastText}という自分らしさがあります。`;
        } else {
          session.status.self_text = "あなたらしさについて伺いました。";
        }
      }
      nextStep = 6;
      console.log(`[STEP5 FAILSAFE] Forcing transition to STEP6. LLM count: ${deepeningCount}, Server count: ${serverCount}`);
    }

    if (nextStep !== session.step) {
      // STEP6へ移行
      session.step = nextStep;
      session.stage.turnIndex = 0;
      // deepening_countをリセット
      session.meta.step5_deepening_count = 0;

      const step6Response = await handleStep6(session, "");
      // 共感 → 中間メッセージ → STEP6の初回質問を結合
      const combinedResponse = [empathy, "ありがとう！", step6Response.response].filter(Boolean).join("\n\n");
      return {
        response: combinedResponse || step6Response.response,
        status: session.status,
        meta: step6Response.meta || { step: session.step },
        drill: step6Response.drill,
      };
    }

    // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
    const message = [empathy, ask_next].filter(Boolean).join("\n\n") || empathy || "ありがとう。もう少し教えて。";
    return {
      response: message,
      status: session.status,
      meta: { step: session.step },
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
  // STEP6はGPT-5を試し、失敗時はGPT-4oにフォールバック
  let llm = await callLLM(6, payload, session, { model: "gpt-5" });
  if (!llm.ok) {
    console.warn(
      `[STEP6 WARNING] GPT-5 call failed (${llm.error || "unknown error"}). Retrying with GPT-4o.`
    );
    llm = await callLLM(6, payload, session, { model: "gpt-4o" });
  }
  if (!llm.ok) {
    console.error(
      `[STEP6 ERROR] GPT-5/GPT-4o both failed. Returning fallback message. Error: ${llm.error || "unknown"}`
    );
    return buildSchemaError(6, session, "作成に失敗しちゃった。少し待って再送してみてね。", llm.error);
  }
  const parsed = llm.parsed || {};
  const doing = parsed?.status?.doing_text;
  const being = parsed?.status?.being_text;

  // generation フェーズ（Doing/Being生成完了）
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

    // 各STEPの情報を整形して表示
    const parts = [];

    // STEP1（資格）: IDをタグ名に変換
    if (Array.isArray(session.status.qual_ids) && session.status.qual_ids.length > 0) {
      const qualNames = session.status.qual_ids
        .map(id => QUAL_NAME_BY_ID.get(Number(id)))
        .filter(Boolean)
        .join("、");
      if (qualNames) {
        parts.push("【資格】\n" + qualNames);
      }
    }

    // STEP2（Can）: ユーザーの発話を優先
    const step2UserTexts = session.history
      .filter(h => h.step === 2 && h.role === "user" && h.text)
      .map(h => h.text.trim())
      .filter(Boolean);
    if (step2UserTexts.length > 0) {
      parts.push("【Can（活かせる強み）】\n" + step2UserTexts.join("\n"));
    } else if (Array.isArray(session.status.can_texts) && session.status.can_texts.length > 0) {
      parts.push("【Can（活かせる強み）】\n" + session.status.can_texts.join("\n"));
    } else if (session.status.can_text) {
      parts.push("【Can（活かせる強み）】\n" + session.status.can_text);
    }

    // STEP3（Will）: ユーザーの発話を優先
    const step3UserTexts = session.history
      .filter(h => h.step === 3 && h.role === "user" && h.text)
      .map(h => h.text.trim())
      .filter(Boolean);
    if (step3UserTexts.length > 0) {
      parts.push("【Will（やりたいこと）】\n" + step3UserTexts.join("\n"));
    } else if (Array.isArray(session.status.will_texts) && session.status.will_texts.length > 0) {
      parts.push("【Will（やりたいこと）】\n" + session.status.will_texts.join("\n"));
    } else if (session.status.will_text) {
      parts.push("【Will（やりたいこと）】\n" + session.status.will_text);
    }

    // STEP4（Must）: ユーザーの発話を優先
    const step4UserTexts = session.history
      .filter(h => h.step === 4 && h.role === "user" && h.text)
      .map(h => h.text.trim())
      .filter(Boolean);
    if (step4UserTexts.length > 0) {
      parts.push("【Must（譲れない条件）】\n" + step4UserTexts.join("\n"));
    } else if (Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0) {
      const mustNames = session.status.must_have_ids
        .map(id => QUAL_NAME_BY_ID.get(Number(id)))
        .filter(Boolean)
        .join("、");
      if (mustNames) {
        parts.push("【Must（譲れない条件）】\n" + mustNames);
      }
    } else if (session.status.must_text) {
      parts.push("【Must（譲れない条件）】\n" + session.status.must_text);
    }

    // STEP5（Self）: ユーザーの発話を優先
    const step5UserTexts = session.history
      .filter(h => h.step === 5 && h.role === "user" && h.text)
      .map(h => h.text.trim())
      .filter(Boolean);
    if (step5UserTexts.length > 0) {
      parts.push("【私はこんな人（自己分析）】\n" + step5UserTexts.join("\n"));
    } else if (session.status.self_text) {
      parts.push("【私はこんな人（自己分析）】\n" + session.status.self_text);
    }

    // STEP6（Doing/Being）: ユーザーの発話を優先
    const step6UserTexts = session.history
      .filter(h => h.step === 6 && h.role === "user" && h.text)
      .map(h => h.text.trim())
      .filter(Boolean);
    if (step6UserTexts.length > 0) {
      parts.push("【Doing / Being（あなたの行動・価値観）】\n" + step6UserTexts.join("\n"));
    } else {
      if (session.status.doing_text) {
        parts.push("【Doing（あなたの行動・実践）】\n" + session.status.doing_text);
      }
      if (session.status.being_text) {
        parts.push("【Being（あなたの価値観・関わり方）】\n" + session.status.being_text);
      }
    }

    const summaryData = parts.join("\n\n");

    // 最終メッセージと一覧データを分離
    // フロントエンド側で1.5秒後に一覧を表示する
    const finalMessage = "ここまでたくさんの話を聞かせてくれて、ありがとう！あなただけのオリジナルの「あなたらしさ」を表現してみたよ！\n\nこのあと出力するから中身を確認してね。";

    return {
      response: finalMessage,
      status: session.status,
      meta: {
        step: session.step,
        show_summary_after_delay: 1500, // 1.5秒後に表示
        summary_data: summaryData || "キャリアの説明書を作成しました。",
      },
      drill: session.drill,
    };
  }

  // 会話フェーズ（念のため）
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
    response: "こんにちは！AIキャリアデザイナーのほーぷちゃんだよ✨\n今日はあなたのこれまでキャリアの説明書をあなたの言葉で作っていくね！\nそれじゃあ、まずは持っている資格を教えて欲しいな🌱\n複数ある場合は1つずつ教えてね。\n資格がない場合は「資格なし」でOKだよ◎",
    status: session.status,
    meta: { step: session.step },
    drill: session.drill,
  };
}

async function handler(req, res) {
  // 全レスポンスで共通の CORS ヘッダを出す（恒久対応）
  res.setHeader("Access-Control-Allow-Origin", "*"); // 本番はワイルドカードではなく許可する origin を指定する
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // プリフライト（OPTIONS）に正しく応答
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(204).end();
    return;
  }

  // POST のみ許可
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // body 取得の保険（Edge/Node 両対応）
  const body = (await req.json?.().catch(() => null)) || req.body || {};
  const { message, sessionId } = body;
  const session = getSession(sessionId);
  saveSession(session);

  try {
    if (!message || message.trim() === "") {
      const greeting = initialGreeting(session);
      // ここでも CORS ヘッダは既にセット済み
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
      // 【安全装置】session.statusを上書きする前に、qual_idsを保護
      // STEP1で登録したqual_idsが後続のSTEPで消えないようにする
      const existingQualIds = session.status?.qual_ids;
      const existingLicenses = session.status?.licenses;
      session.status = result.status;

      // result.statusにqual_idsが含まれていない場合、既存の値を復元
      if (existingQualIds && existingQualIds.length > 0 && !session.status.qual_ids) {
        session.status.qual_ids = existingQualIds;
        console.log(`[HANDLER] Restored qual_ids: ${existingQualIds}`);
      }
      if (existingLicenses && existingLicenses.length > 0 && !session.status.licenses) {
        session.status.licenses = existingLicenses;
        console.log(`[HANDLER] Restored licenses: ${existingLicenses}`);
      }
    }
    if (result.meta?.step != null) {
      const beforeStep = session.step;
      const proposedStep = result.meta.step;

      // 【安全装置】result.meta.step が現在のステップより小さい値の場合は拒否
      // ステップは必ず前進するか維持されるべきで、後退してはならない
      if (proposedStep < beforeStep) {
        console.error(`[HANDLER ERROR] Attempted to go backwards: ${beforeStep} -> ${proposedStep}. REJECTING step change.`);
        // ステップ変更を拒否して現在のステップを維持
      } else {
        session.step = proposedStep;
        if (beforeStep !== session.step) {
          console.log(`[HANDLER] Step changed: ${beforeStep} -> ${session.step}`);
        }
      }
    }
    if (result.drill) session.drill = result.drill;
    saveSession(session);

    res.status(200).json(result);
  } catch (err) {
    // 本番で出るスタックや詳細はログへ。ユーザー向けは汎用メッセージ。
    console.error("handler_unexpected_error", err);
    res.status(500).json({
      response: "サーバ内部で例外が発生しました。もう一度試してみてください。",
      status: session.status,
      meta: { step: session.step, error: "exception" },
      drill: session.drill,
      _error: "exception",
    });
  }
}

export default handler;
