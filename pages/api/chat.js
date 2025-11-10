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

// 各STEPの初回質問（プロンプトファイルから抽出）
const STEP_INTRO_QUESTIONS = {
  2: "教えてくれてありがとう！\n\n次は、仕事中に自然にやってることを教えて！患者さん（利用者さん）と接するとき、無意識にやってることでもOKだよ✨",
  3: "ありがとう！\n\n次は、今の職場ではできないけど、やってみたいことを教えて！『これができたらいいな』って思うことでOKだよ✨",
  4: "働く上で『ここだけは譲れないな』って思うこと、ある？職場の雰囲気でも働き方でもOKだよ✨",
  5: "ありがとう！\n\n最後に、仕事以外の話を聞かせて！友達や家族に『あなたってこういう人だよね』って言われることって、ある？😊",
};

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
const TAG_NAME_BY_ID = new Map();

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

if (Array.isArray(TAGS_DATA?.tags)) {
  for (const tag of TAGS_DATA.tags) {
    const id = Number(tag?.id);
    const name = typeof tag?.name === "string" ? tag.name.trim() : "";
    if (Number.isInteger(id) && name) {
      TAG_NAME_BY_ID.set(id, name);
    }
  }
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
      response: STEP_INTRO_QUESTIONS[2],
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
        response: STEP_INTRO_QUESTIONS[2],
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

  // generation フェーズ（Can確定、STEP3へ移行）
  if (parsed?.status?.can_text && typeof parsed.status.can_text === "string") {
    // LLM生成のcan_textを保存
    console.log("[STEP2 GENERATION] can_text generated:", parsed.status.can_text);
    session.status.can_text = parsed.status.can_text;
    if (!Array.isArray(session.status.can_texts)) {
      session.status.can_texts = [];
    }
    session.status.can_texts.push(parsed.status.can_text);
    console.log("[STEP2 GENERATION] can_texts after push:", session.status.can_texts);
    const nextStep = Number(parsed?.meta?.step) || 3;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step2_deepening_count = 0;

    // STEP3の初回質問を使用
    resetDrill(session);
    return {
      response: STEP_INTRO_QUESTIONS[3],
      status: session.status,
      meta: { step: session.step },
      drill: session.drill,
    };
  }
  
  console.log("[STEP2 DEBUG] No generation phase detected. parsed.status:", parsed?.status);

  const { empathy, ask_next, meta } = parsed;

  // 基本検査
  if (typeof empathy !== "string" || (ask_next != null && typeof ask_next !== "string")) {
    return buildSchemaError(2, session, "あなたの「やってきたこと、これからも活かしていきたいこと」の処理でエラーが起きたみたい。もう一度話してみて！");
  }

  // session.meta 初期化（安全）
  if (!session.meta) session.meta = {};
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0;
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
    // STEP3へ移行
    // フェイルセーフで遷移する場合でも、LLMにcan_textを生成させる
    // session.historyからSTEP2のユーザー発話を取得
    const step2Texts = session.history
      .filter(h => h.step === 2 && h.role === "user")
      .map(h => h.text)
      .filter(Boolean);

    // LLMにgenerationを依頼（強制的にcan_text生成）
    const genPayload = {
      locale: "ja",
      stage: { turn_index: 999 }, // 終了フラグ
      user_text: step2Texts.join("。"), // 全ての発話を結合
      recent_texts: step2Texts,
      status: session.status,
      force_generation: true, // generationフェーズを強制
    };

    const genLLM = await callLLM(2, genPayload, session, { model: "gpt-4o" });
    let generatedCan = "今までやってきたことについて伺いました。";

    console.log("[STEP2 FAILSAFE] genLLM.ok:", genLLM.ok);
    console.log("[STEP2 FAILSAFE] genLLM.parsed?.status?.can_text:", genLLM.parsed?.status?.can_text);
    
    if (genLLM.ok && genLLM.parsed?.status?.can_text) {
      generatedCan = genLLM.parsed.status.can_text;
      console.log("[STEP2 FAILSAFE] Using LLM generated can_text:", generatedCan);
    } else if (step2Texts.length > 0) {
      // LLM失敗時は最後の発話を整形
      const lastText = step2Texts[step2Texts.length - 1];
      generatedCan = lastText.length > 50 ? lastText : `${lastText}を活かしている`;
      console.log("[STEP2 FAILSAFE] Using fallback can_text:", generatedCan);
    }

    session.status.can_text = generatedCan;
    if (!Array.isArray(session.status.can_texts)) {
      session.status.can_texts = [];
    }
    session.status.can_texts.push(generatedCan);
    console.log("[STEP2 FAILSAFE] Final can_texts:", session.status.can_texts);

    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    session.meta.step2_deepening_count = 0;

    const step3Response = await handleStep3(session, "");
    const combinedResponse = [empathy, "ありがとう！", step3Response.response].filter(Boolean).join("\n\n");
    return {
      response: combinedResponse || step3Response.response,
      status: session.status,
      meta: { step: session.step },
      drill: step3Response.drill,
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
    // LLM生成のwill_textは内部用にのみ保存（ユーザーには表示しない）
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
    // LLM生成文は表示せず、ブリッジメッセージ → STEP4の初回質問のみ
    const combinedResponse = ["ありがとう！次の質問に移るね", step4Response.response].filter(Boolean).join("\n\n");
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

      // STEP4の初回質問を使用
      resetDrill(session);
      const combinedResponse = [empathy, STEP_INTRO_QUESTIONS[4]].filter(Boolean).join("\n\n");
      return {
        response: combinedResponse,
        status: session.status,
        meta: { step: session.step },
        drill: session.drill,
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
  
  // 「給料アップ」「年収アップ」等の特殊パターンを優先処理
  const salaryUpPattern = /(給料|給与|年収|収入).*?(アップ|上げ|増やし|増額)/;
  if (salaryUpPattern.test(text)) {
    // 「昇給」タグを最優先で返す
    const salaryUpTag = tagsData.tags.find(t => t.name === "昇給");
    if (salaryUpTag) {
      matches.push(salaryUpTag);
    }
    // 給与関連タグも追加
    const salaryTags = tagsData.tags.filter(t => 
      t.category === "給与・賞与" && t.name !== "昇給"
    );
    matches.push(...salaryTags);
    return matches;
  }
  
  for (const tag of tagsData.tags) {
    const name = tag.name.toLowerCase();
    
    // 完全一致（最優先）
    if (text === name) {
      matches.unshift(tag); // 先頭に追加
      continue;
    }
    
    // 部分一致（ユーザー発話にタグ名が含まれる、またはその逆）
    // 「慢性期」「訪問看護」等の短縮形も検出
    if (text.includes(name) || name.includes(text)) {
      matches.push(tag);
      continue;
    }
    
    // 短縮形の特殊処理
    // 「慢性期」→「慢性期・療養型病院」
    if (name.includes("・") || name.includes("（")) {
      const simplifiedName = name.split(/[・（]/)[0]; // 最初の部分のみ取得
      if (text.includes(simplifiedName) || simplifiedName.includes(text)) {
        matches.push(tag);
      }
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
    "アップ": ["給与・賞与"],
    "収入": ["給与・賞与"],
    
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

function sanitizeStep4Empathy(userText, responseText) {
  if (!responseText) return responseText;
  const original = String(responseText);
  const user = String(userText || "");
  const normalizedUser = user.normalize("NFKC");
  const neutralKeywords = ["夜勤", "残業", "深夜", "夜間", "交代", "シフト"];
  const positiveIndicators = ["好き", "やりたい", "希望", "したい", "惹かれて", "わくわく", "ワクワク", "楽しみ", "挑戦したい", "興味がある"];

  const mentionsNeutral = neutralKeywords.some((kw) => normalizedUser.includes(kw));
  if (!mentionsNeutral) return original;

  const hasPositiveCue = positiveIndicators.some((kw) => normalizedUser.includes(kw));
  if (hasPositiveCue) return original;

  let sanitized = original;
  const patterns = [
    /[^。！？!?]*惹かれる[^。！？!?]*[。！？!?]/g,
    /[^。！？!?]*魅力[^。！？!?]*[。！？!?]/g,
  ];

  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, "");
  }

  sanitized = sanitized.trim();
  return sanitized || "教えてくれてありがとう。";
}

function formatMustSummary(session) {
  if (!session?.status) return "";
  const {
    must_have_ids: mustIds = [],
    ng_ids: ngIds = [],
    pending_ids: pendingIds = [],
    must_text: mustText = "",
  } = session.status;

  const toName = (id) => {
    const num = Number(id);
    if (Number.isNaN(num)) return `ID:${id}`;
    return TAG_NAME_BY_ID.get(num) || `ID:${num}`;
  };

  const lines = [];

  for (const id of mustIds) {
    lines.push(`◎ あってほしい：${toName(id)}`);
  }
  for (const id of ngIds) {
    lines.push(`✕ 避けたい：${toName(id)}`);
  }
  for (const id of pendingIds) {
    lines.push(`△ あれば嬉しい：${toName(id)}`);
  }

  const summary = lines.join("\n").trim();
  return summary || String(mustText || "");
}

function normalizeSelfText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/。{2,}/g, "。")
    .trim();
}

function formatSelfTextFallback(texts) {
  const sentences = (texts || [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.replace(/[。！!？?\s]+$/u, ""));

  if (!sentences.length) {
    return "あなたらしさについて伺いました。";
  }

  const unique = Array.from(new Set(sentences));
  return unique
    .map((s) => (/[。！!？?]$/.test(s) ? s : `${s}。`))
    .join("")
    .trim();
}

function smoothAnalysisText(text) {
  if (!text) return "";
  return String(text)
    .replace(/この人は/g, "")
    .replace(/のだ。/g, "。")
    .replace(/なのだ。/g, "。")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
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
    }
    
    // ID化できなかった場合でも、ユーザー発話をそのまま保存（内部用語は使わない）
    if (step4Texts.length > 0) {
      // must_textが空の場合のみ、ユーザー発話をそのまま保存
      if (!session.status.must_text || session.status.must_text.trim() === "") {
        session.status.must_text = step4Texts.join("、");
      }
      // must_have_idsが空でもOK（ID化できなかった場合）
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
    const bridgeMessage = ["ありがとう！", "では最後の質問だよ！", step5Response.response]
      .filter(Boolean)
      .join("\n\n");
    // must_textは表示せず、STEP5の質問のみを返す（LLMの不要な発話を防ぐ）
    return {
      response: bridgeMessage,
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
      // ID化が行われていない場合、ユーザー発話をそのまま保存（内部用語は使わない）
      console.log("[STEP4] No IDs found in status. Saving user text as-is.");
      const step4Texts = session.history
        .filter(h => h.step === 4 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean);
      
      if (step4Texts.length > 0) {
        // ユーザー発話をそのまま保存
        session.status.must_text = step4Texts.join("、");
        session.status.must_have_ids = [];
        session.status.ng_ids = [];
        session.status.pending_ids = [];
        session.status.status_bar = "";
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
        // STEP5（Self）の初回質問を使用
        resetDrill(session);

        // ID化が成功した場合、確認メッセージを追加
        const hasMustIds = Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0;
        const hasNgIds = Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0;

        let confirmMessage = "";
        if (hasMustIds || hasNgIds) {
          // ID化成功：確認メッセージ
          const idNames = [];
          if (hasMustIds) {
            session.status.must_have_ids.forEach(id => {
              const name = TAG_NAME_BY_ID.get(Number(id));
              if (name) idNames.push(name);
            });
          }
          if (hasNgIds) {
            session.status.ng_ids.forEach(id => {
              const name = TAG_NAME_BY_ID.get(Number(id));
              if (name) idNames.push(name);
            });
          }
          if (idNames.length > 0) {
            confirmMessage = `「${idNames.join("、")}」について確認できたよ！`;
          }
        }

        const empathyMessage = sanitizeStep4Empathy(userText, parsed.response || "");
        // 共感 → 確認 → STEP5の質問を結合
        const combinedResponse = [
          empathyMessage,
          confirmMessage,
          STEP_INTRO_QUESTIONS[5],
        ]
          .filter(Boolean)
          .join("\n\n");
        return {
          response: combinedResponse,
          status: session.status,
          meta: { step: session.step, deepening_count: 0 },
          drill: session.drill,
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
      // 自動ID確定後は必ず「have/ng」を聞く質問を追加
      const userInput = userText || "";
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const combinedText = `${userInput} ${recentTexts}`;

      // ネガティブキーワードがある場合は質問をスキップ（既に方向性が明確）
      const hasNegativeKeywords = /嫌|避けたい|したくない|なし|いらない|不要|NG/.test(combinedText);
      const hasPositiveKeywords = /欲しい|いい|希望|理想|好き|したい|あってほしい/.test(combinedText);

      let question;
      
      // ネガティブキーワードがある場合は方向性確認をスキップし、次の条件を聞く
      if (hasNegativeKeywords && !hasPositiveKeywords) {
        // 「嫌だ」「避けたい」等が明確な場合は方向性確認不要、次の条件を聞く
        question = "他に『ここだけは譲れない』って思う条件はある？";
      } else if (autoConfirmedIds.length > 0) {
        // 自動ID確定後は必ず「have/ng」を聞く質問を優先
        if (combinedText.includes("残業")) {
          question = "それって『残業なし』がいい？それとも『多少の残業はOK』くらい？";
        } else if (combinedText.includes("給料") || combinedText.includes("給与") || combinedText.includes("年収") || combinedText.includes("収入") || combinedText.includes("昇給")) {
          question = "それって『高めの給与』がいい？それとも『平均的でも安定』がいい？";
        } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
          question = "休日はどのくらい欲しい？『完全週休2日』？それとも『月6日以上あればOK』？";
        } else if (combinedText.includes("オンコール") || combinedText.includes("呼び出し")) {
          question = "それって『絶対なし』がいい？それとも『たまにならOK』くらい？";
        } else {
          question = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
        }
      } else {
        // 通常の質問生成ロジック
        const isShortWord = userInput.length <= 10;

        if (isShortWord && serverCount === 0) {
          // 初回：方向性を確認（あってほしいのか、なしにしてほしいのか）
          if (userInput.includes("残業")) {
            question = "『残業なし』がいい？それとも『多少の残業はOK』くらい？";
          } else if (userInput.includes("休み") || userInput.includes("休日")) {
            question = "休日はどのくらい欲しい？『完全週休2日』？それとも『月6日以上あればOK』？";
          } else {
            question = "それって『絶対あってほしい』こと？それとも『絶対なしにしてほしい』こと？";
          }
        } else {
          // 2回目以降：方向性（have/ng）を確認する質問を優先
          if (serverCount === 1) {
            // 残業の場合
            if (combinedText.includes("残業")) {
              question = "それって『残業なし』がいい？それとも『多少の残業はOK』くらい？";
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
      }

      // 質問がある場合のみ追加
      if (question) {
        responseText = responseText ? `${responseText}\n\n${question}` : question;
      }
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
        } else if (combinedText.includes("給料") || combinedText.includes("給与") || combinedText.includes("年収") || combinedText.includes("収入") || combinedText.includes("昇給")) {
          responseText = "それって『高めの給与』がいい？それとも『平均的でも安定』がいい？";
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

    if (parsed.control.phase === "empathy") {
      responseText = sanitizeStep4Empathy(userText, responseText);
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
  
  // ペイロード最適化：発話履歴ではなく生成済みテキストを送る
  const payload = {
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    user_text: userText,
    // 生成済みの整形テキストのみ送る（発話履歴は送らない）
    context: {
      can_text: session.status.can_text || "",
      will_text: session.status.will_text || "",
      must_summary: formatMustSummary(session),
    },
    status: {
      self_text: session.status.self_text || "",
    },
  };
  
  // STEP5はまずGPT-4oで試す（タイムアウト回避）
  let llm = await callLLM(5, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    console.warn(
      `[STEP5 WARNING] GPT-4o call failed (${llm.error || "unknown error"}). Retrying with GPT-4o-mini.`
    );
    llm = await callLLM(5, payload, session, { model: "gpt-4o-mini" });
  }
  if (!llm.ok) {
    console.error(
      `[STEP5 ERROR] GPT-4o/GPT-4o-mini both failed. Returning fallback message. Error: ${llm.error || "unknown"}`
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
      response:
        parsed.response ||
        "最後に、仕事抜きであなた自身のことを教えて！友達や家族に『あなたってこういう人だよね』って言われることってある？😊",
      status: session.status,
      meta: { step: 5 },
      drill: session.drill,
    };
  }

  // generation フェーズ（Self確定、STEP6へ移行）
  if (parsed?.status?.self_text && typeof parsed.status.self_text === "string") {
    console.log("[STEP5 GENERATION] self_text generated:", parsed.status.self_text);
    session.status.self_text = normalizeSelfText(parsed.status.self_text);
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
  
  console.log("[STEP5 DEBUG] No generation phase detected. parsed.status:", parsed?.status);

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

        // フェイルセーフでもGPT-4oを使用（タイムアウト回避）
        const genLLM = await callLLM(5, genPayload, session, { model: "gpt-4o" });

        console.log("[STEP5 FAILSAFE] genLLM.ok:", genLLM.ok);
        console.log("[STEP5 FAILSAFE] genLLM.parsed?.status?.self_text:", genLLM.parsed?.status?.self_text);
        
        if (genLLM.ok && genLLM.parsed?.status?.self_text) {
          session.status.self_text = genLLM.parsed.status.self_text;
          console.log("[STEP5 FAILSAFE] Using LLM generated self_text:", session.status.self_text);
        } else if (step5Texts.length > 0) {
          // LLM失敗時：ユーザー発話を整形して保存
          session.status.self_text = formatSelfTextFallback(step5Texts);
          console.log("[STEP5 FAILSAFE] Using fallback self_text:", session.status.self_text);
        } else {
          session.status.self_text = "あなたらしさについて伺いました。";
          console.log("[STEP5 FAILSAFE] Using default self_text");
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

async function handleStep6(session, _userText) {
  // STEP6ではLLMを使ってDoing（行動・実践）とBeing（価値観・関わり方）を生成
  console.log("[STEP6] ===== START =====");
  console.log("[STEP6] can_text:", session.status.can_text);
  console.log("[STEP6] will_text:", session.status.will_text);
  console.log("[STEP6] must_text:", session.status.must_text);
  console.log("[STEP6] self_text:", session.status.self_text);
  console.log("[STEP6] Generating Doing and Being using LLM.");
  
  // STEP6は最終ステップなので、stepは6のまま
  session.step = 6;
  session.stage.turnIndex = 0;

  // LLMにCan/Will/Must/Selfの情報を渡してDoing/Beingを生成
  const payload = {
    locale: "ja",
    can_text: session.status.can_text || "",
    can_texts: session.status.can_texts || [],
    will_text: session.status.will_text || "",
    will_texts: session.status.will_texts || [],
    must_text: session.status.must_text || "",
    self_text: session.status.self_text || "",
    status: {
      can_text: session.status.can_text,
      will_text: session.status.will_text,
      must_text: session.status.must_text,
      self_text: session.status.self_text,
    },
  };

  // GPT-4oを使用してDoing/Beingを生成
  const llmResult = await callLLM(6, payload, session, { model: "gpt-4o" });

  if (llmResult.ok && llmResult.parsed?.status?.doing_text && llmResult.parsed?.status?.being_text) {
    // LLM生成成功
    session.status.doing_text = smoothAnalysisText(llmResult.parsed.status.doing_text);
    session.status.being_text = smoothAnalysisText(llmResult.parsed.status.being_text);
    console.log("[STEP6] LLM generated Doing:", session.status.doing_text);
    console.log("[STEP6] LLM generated Being:", session.status.being_text);
  } else {
    // LLM失敗時のフォールバック
    console.warn("[STEP6 WARNING] LLM generation failed. Using fallback.");
    session.status.doing_text = smoothAnalysisText(session.status.can_text || "行動・実践について伺いました。");
    session.status.being_text = smoothAnalysisText(session.status.self_text || "価値観・関わり方について伺いました。");
  }

  const analysisParts = [];

  // STEP1（資格）: IDをタグ名に変換
  if (Array.isArray(session.status.qual_ids) && session.status.qual_ids.length > 0) {
    const qualNames = session.status.qual_ids
      .map((id) => QUAL_NAME_BY_ID.get(Number(id)))
      .filter(Boolean)
      .join("、");
    if (qualNames) {
      analysisParts.push("【資格】\n" + qualNames);
    }
  }

  // STEP2（Can）: Can（今できること）
  if (Array.isArray(session.status.can_texts) && session.status.can_texts.length > 0) {
    analysisParts.push("【Can（今できること）】\n" + session.status.can_texts.join("\n"));
  } else if (session.status.can_text) {
    analysisParts.push("【Can（今できること）】\n" + session.status.can_text);
  }

  // STEP3（Will）: Will（やりたいこと）
  if (Array.isArray(session.status.will_texts) && session.status.will_texts.length > 0) {
    analysisParts.push("【Will（やりたいこと）】\n" + session.status.will_texts.join("\n"));
  } else if (session.status.will_text) {
    analysisParts.push("【Will（やりたいこと）】\n" + session.status.will_text);
  }

  // STEP4（Must）: Must（譲れない条件）
  const mustSummary = formatMustSummary(session);
  if (mustSummary) {
    analysisParts.push("【Must（譲れない条件）】\n" + mustSummary);
  } else if (session.status.must_text) {
    analysisParts.push("【Must（譲れない条件）】\n" + session.status.must_text);
  }

  // STEP5（Self）: 私はこんな人（自己分析）
  if (session.status.self_text) {
    analysisParts.push("【私はこんな人（自己分析）】\n" + session.status.self_text);
  }

  // STEP6（AIの分析）
  const aiAnalysisSections = [];
  if (session.status.doing_text) {
    aiAnalysisSections.push("＜Doing（行動・実践）＞\n" + session.status.doing_text);
  }
  if (session.status.being_text) {
    aiAnalysisSections.push("＜Being（価値観・関わり方）＞\n" + session.status.being_text);
  }
  const aiAnalysis = aiAnalysisSections.join("\n\n").trim();
  if (aiAnalysis) {
    session.status.ai_analysis = aiAnalysis;
    analysisParts.push("【AIの分析】\n" + aiAnalysis);
  } else {
    session.status.ai_analysis = "";
  }

  const summaryData = analysisParts.filter(Boolean).join("\n\n");

  // 最終メッセージと一覧データを分離
  // フロントエンド側で5秒後に一覧を表示する（吹き出しを読む時間を確保）
  const finalMessage = "ここまでたくさん話してくれてありがとう！このあと、あなた自身の言葉とAIの分析をまとめたシートを届けるね。ゆっくり確認してみて！";

  return {
    response: finalMessage,
    status: session.status,
    meta: {
      step: session.step,
      show_summary_after_delay: 5000, // 5秒後に表示（吹き出しを読む時間を確保）
      summary_data: summaryData || "キャリアの説明書を作成しました。",
    },
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
    console.log(`[HANDLER] Received message: "${message}", session.step: ${session.step}`);
    
    // STEP6では空メッセージでも処理を続行（自動開始のため）
    if ((!message || message.trim() === "") && session.step !== 6) {
      console.log("[HANDLER] Empty message and not STEP6, returning greeting");
      const greeting = initialGreeting(session);
      // ここでも CORS ヘッダは既にセット済み
      res.status(200).json(greeting);
      return;
    }

    // 空メッセージでない場合のみhistoryに追加
    if (message && message.trim() !== "") {
      session.history.push({ role: "user", text: message, step: session.step });
    }

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
      case 6:
        result = await handleStep6(session, message);
        break;
      default:
        // 想定外のステップの場合はエラー
        console.error(`[HANDLER ERROR] Invalid step: ${session.step}`);
        result = {
          response: "エラーが発生しました。最初からやり直してください。",
          status: session.status,
          meta: { step: 1 },
          drill: session.drill,
        };
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
