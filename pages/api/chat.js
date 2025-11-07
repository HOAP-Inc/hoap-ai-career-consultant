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

  const llmNextStep = Number(meta?.step) || session.step;

  let nextStep = llmNextStep;
  if (llmNextStep === session.step) {
    // サーバー側の暴走停止装置（フェイルセーフ）
    const deepeningCount = Number(meta?.deepening_count) || 0;
    const serverCount = session.meta.step2_deepening_count || 0;

    if (session.meta.can_repeat_count >= 2) {
      nextStep = 3;
    } else if (deepeningCount >= 3 || serverCount >= 3) {
      // LLMのdeepening_countまたはサーバー側カウントが3回に達したら強制終了
      nextStep = 3;
      console.log(`[STEP2 FAILSAFE] Forcing transition to STEP3. LLM count: ${deepeningCount}, Server count: ${serverCount}`);
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

    const llmNextStep = Number(meta?.step) || session.step;
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
      // フェイルセーフで遷移する場合、簡易的にwill_textを生成
      const fallbackWill = userText || "これから挑戦したいことについて伺いました。";
      session.status.will_text = fallbackWill;
      if (!Array.isArray(session.status.will_texts)) {
        session.status.will_texts = [];
      }
      session.status.will_texts.push(fallbackWill);

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
    return {
      response: "働く上で『ここだけは譲れないな』って思うこと、ある？職場の雰囲気でも働き方でもOKだよ✨",
      status: session.status,
      meta: { step: 4, phase: "intro", deepening_count: 0 },
      drill: session.drill,
    };
  }

  // userTextがある場合のみturnIndexをインクリメント
  session.stage.turnIndex += 1;

  // LLMにはサーバー側カウンターを送る（step4_deepening_countをdeepeningCountとして送信）
  const payload = {
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    user_text: userText,
    recent_texts: session.history.slice(-6).map(item => item.text),
    status: session.status,
    deepening_attempt_total: session.meta.step4_deepening_count,  // サーバー側カウンターを送る
  };

  const llm = await callLLM(4, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(4, session, "あなたの譲れない条件の整理に失敗しちゃった。もう一度教えてもらえる？", llm.error);
  }
  const parsed = llm.parsed || {};

  // ユーザーが応答した場合、カウンターを増やす
  session.meta.step4_deepening_count += 1;
  console.log(`[STEP4] User responded. Counter: ${session.meta.step4_deepening_count}`);

  // サーバー側の暴走停止装置（フェイルセーフ） - generationより前にチェック
  const serverCount = session.meta.step4_deepening_count || 0;
  if (serverCount >= 3) {
    console.log(`[STEP4 FAILSAFE] Forcing transition to STEP5. Server count: ${serverCount}`);

    // 簡単なmust_textを生成してSTEP5に遷移
    session.status.must_text = userText || "譲れない条件について伺いました。";
    session.step = 5;
    session.stage.turnIndex = 0;
    session.meta.step4_deepening_count = 0;

    const step5Response = await handleStep5(session, "");
    const combinedResponse = [session.status.must_text, "ありがとう！次の質問に移るね", step5Response.response].filter(Boolean).join("\n\n");
    return {
      response: combinedResponse || step5Response.response,
      status: session.status,
      meta: { step: session.step, deepening_count: serverCount },
      drill: step5Response.drill,
    };
  }

  // generation フェーズ（Must確定、STEP5へ移行）
  if (parsed?.status && typeof parsed.status === "object") {
    // LLM から帰ってきた譲れない条件をセッションへ適用
    applyMustStatus(session, parsed.status, parsed.meta || {});
    // 次のステップは LLM の meta から決定（デフォルトは 5）
    const nextStep = Number(parsed?.meta?.step) || 5;

    // セッションを次STEPにセットして、次STEPの初回質問を取得
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step4_deepening_count = 0;

    switch (nextStep) {
      case 5: {
        // STEP5（Self）の初回質問を取得して結合
        const step5Response = await handleStep5(session, "");
        const combinedResponse = [session.status.must_text, step5Response.response].filter(Boolean).join("\n\n");
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
    return {
      response: parsed.response || "もう少し詳しく聞かせてほしいな。",
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
    response: "あなたの譲れない条件の整理を続けているよ。気になる条件を教えてね。",
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
  const llm = await callLLM(5, payload, session, { model: "gpt-4o" });
  if (!llm.ok) {
    return buildSchemaError(5, session, "Selfの生成で少しつまずいたよ。もう一度話してみてね。", llm.error);
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
    const nextStep = Number(parsed?.meta?.step) || 6;
    session.step = nextStep;
    session.stage.turnIndex = 0;
    // deepening_countをリセット
    if (session.meta) session.meta.step5_deepening_count = 0;

    // STEP6の処理を取得して結合
    const step6Response = await handleStep6(session, "");
    // Self生成文 → 中間メッセージ → STEP6の初回質問を結合
    const combinedResponse = [session.status.self_text, "ありがとう！", step6Response.response].filter(Boolean).join("\n\n");
    return {
      response: combinedResponse || step6Response.response,
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

    const llmNextStep = Number(meta?.step) || session.step;
    let nextStep = llmNextStep;

    // サーバー側の暴走停止装置（フェイルセーフ）
    // LLMのdeepening_countとサーバー側のカウントの両方をチェック
    const deepeningCount = Number(meta?.deepening_count) || 0;
    const serverCount = session.meta.step5_deepening_count || 0;

    if (llmNextStep === session.step && (deepeningCount >= 3 || serverCount >= 3)) {
      // 3回に達したら強制的にSTEP6へ
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

    // Doing と Being を \n\n で結合して返す（フロント側で順次表示）
    const parts = [];
    if (session.status.doing_text) {
      parts.push("【Doing（あなたの行動・実践）】\n" + session.status.doing_text);
    }
    if (session.status.being_text) {
      parts.push("【Being（あなたの価値観・関わり方）】\n" + session.status.being_text);
    }
    const message = parts.join("\n\n");

    return {
      response: message || "Doing/Being を更新したよ。",
      status: session.status,
      meta: { step: session.step },
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

    if (result.status) session.status = result.status;
    if (result.meta?.step != null) session.step = result.meta.step;
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
