f// ほーぷちゃん：会話ロジック（Step厳密・深掘り2回・候補提示・ステータス算出）
function _bigrams(text) {
  const s = String(text || '').toLowerCase();
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function scoreSimilarity(a, b) {
  const A = _bigrams(a || '');
  const B = _bigrams(b || '');
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

let tagList = [];
try {
  const raw = require("../../tags.json");
  // raw が { tags: [...] } でも、[...] 直でも両方受ける
  tagList = Array.isArray(raw?.tags) ? raw.tags : (Array.isArray(raw) ? raw : []);
} catch (e) {
  console.error("tags.json 読み込み失敗:", e);
  tagList = [];
}
let licenses = {};
try {
  licenses = require("../../licenses.json"); // ルート直下に置く（tags.json と同じ階層）
} catch (e) {
  console.error("licenses.json 読み込み失敗:", e);
  licenses = {};
}

// 所有資格の ID マスタ（qualifications.json）を読む
let licenseTagList = [];
try {
  const raw = require("../../qualifications.json"); // ルート直下
  const src =
    Array.isArray(raw) ? raw :
    Array.isArray(raw?.qualifications) ? raw.qualifications :
    Array.isArray(raw?.items) ? raw.items :
    Array.isArray(raw?.tags) ? raw.tags : [];
  // どのキーでも {id, name} に正規化
  licenseTagList = src.map(x => ({
    id:   x?.id ?? x?.tag_id ?? x?.value ?? null,
    name: x?.name ?? x?.label ?? x?.tag_label ?? ""
  })).filter(t => t.id != null && t.name);
} catch (e) {
  console.error("qualifications.json 読み込み失敗:", e);
  licenseTagList = [];
}

// 「所有資格」名称 → ID のマップ
const licenseTagIdByName = new Map();
const licenseTagNameById = new Map();
try {
  for (const t of (Array.isArray(licenseTagList) ? licenseTagList : [])) {
    const name = String(t?.name ?? "");
    if (!name || t?.id == null) continue;
    const fw = name.replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
    const hw = name.replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
    licenseTagIdByName.set(name, t.id);
    licenseTagIdByName.set(fw,   t.id);
    licenseTagIdByName.set(hw,   t.id);
    licenseTagNameById.set(t.id, name);
  }
} catch (e) {
  console.error("licenseTagIdByName 構築失敗:", e);
}

// 所有資格の「別名→候補ラベル複数」マップを構築
const licenseMap = new Map(); // Map<string, string[]>

try {
  for (const [, arr] of Object.entries(licenses || {})) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const label = typeof item === "string" ? item : item?.label;
      if (!label) continue;

      // ある別名に複数ラベルをぶら下げる
      const put = (alias, l) => {
        if (!alias) return;
        const curr = licenseMap.get(alias) || [];
        if (!curr.includes(l)) curr.push(l);
        licenseMap.set(alias, curr);
      };

      // ラベル自体
      put(label, label);

      // 全角/半角ゆらぎ
      const fwLabel = label.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
      const hwLabel = label.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
      put(fwLabel, label);
      put(hwLabel, label);

      // 別名
      const aliases = (typeof item === "object" && Array.isArray(item.aliases)) ? item.aliases : [];
      for (const a of aliases) {
        if (!a) continue;
        put(a, label);
        const fw = a.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
        const hw = a.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
        put(fw, label);
        put(hw, label);
      }
    }
  }
} catch (e) {
  console.error("licenseMap 構築に失敗:", e);
}

// 追加：公式資格ラベル集合（STEP2の整合判定に使う）
const OFFICIAL_LICENSES = new Set();
try {
  // licenses.json から（"文字列" or {label}）を拾う
  for (const [, arr] of Object.entries(licenses || {})) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const label = typeof item === "string" ? item : item?.label;
      if (label) OFFICIAL_LICENSES.add(label);
    }
  }
  // 念のため、licenseMapの値（= 正式ラベル群）も取り込む
  for (const [, labels] of licenseMap.entries()) {
    if (!Array.isArray(labels)) continue;
    for (const l of labels) if (l) OFFICIAL_LICENSES.add(l);
  }
} catch {}

// 「名称 → ID」のマップを両表記で作る
const tagIdByName = new Map();
try {
  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    if (!name) continue;
    const fullWidth = name.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
    const halfWidth = name.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
    tagIdByName.set(name, t.id);
    tagIdByName.set(fullWidth, t.id);
    tagIdByName.set(halfWidth, t.id);
  }
} catch (e) {
  console.error("tagIdByName 構築失敗:", e);
}
// ★追加：ID → 正式名称
const tagNameById = new Map();
try {
  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    if (t?.id == null) continue;
    const name = String(t?.name ?? "");
    if (name) tagNameById.set(t.id, name);
  }
} catch (e) {
  console.error("tagNameById 構築失敗:", e);
}
// ←ここに追記
// === STEP3専用：tags.jsonから「サービス形態」だけを使うためのサブセット ===
const serviceFormTagList = (Array.isArray(tagList) ? tagList : []).filter(
  t => t?.category === "サービス形態"
);

// 「サービス形態」専用：名称→ID / ID→名称
const serviceTagIdByName = new Map();
const serviceTagNameById = new Map();
try {
  for (const t of serviceFormTagList) {
    const name = String(t?.name ?? "");
    if (!name || t?.id == null) continue;
    const fw = name.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
    const hw = name.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
    serviceTagIdByName.set(name, t.id);
    serviceTagIdByName.set(fw, t.id);
    serviceTagIdByName.set(hw, t.id);
    serviceTagNameById.set(t.id, name);
  }
} catch (e) {
  console.error("serviceTag maps 構築失敗:", e);
}

// === サービス形態 専用マッチャ（ラベル候補 / ID候補）===
// 依存: serviceFormTagList, serviceTagIdByName, serviceTagNameById, PLACE_ALIASES
function matchServicePlacesInText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const toFW = s => String(s || '').replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～');
  const toHW = s => String(s || '').replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~');
  const scrub = s =>
    String(s || '').toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g,'');
  const norm  = s => scrub(toHW(toFW(s)));
  const normText = norm(raw);

  const out = new Set();

  // 0) 厳密一致 → 正式ラベル
  const byExact =
        serviceTagIdByName.get(raw)
     || serviceTagIdByName.get(toFW(raw))
     || serviceTagIdByName.get(toHW(raw));
  if (byExact != null) {
    const name = serviceTagNameById.get(byExact);
    if (name) out.add(name);
  }

  // 1) エイリアス命中 → 正式ラベル
  for (const [alias, label] of Object.entries(PLACE_ALIASES || {})) {
    if (!alias || !label) continue;
    if (normText.includes(norm(alias))) {
      const id =
            serviceTagIdByName.get(label)
         || serviceTagIdByName.get(toFW(label))
         || serviceTagIdByName.get(toHW(label));
      if (id != null) {
        const official = serviceTagNameById.get(id);
        if (official) out.add(official);
      }
    }
  }

  // 2) 双方向部分一致
  const normalize = s => (s ? norm(s) : '');
  for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
    const name = String(t?.name ?? '');
    if (!name) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(name);
  }

  // 3) ファジー補完
  if (out.size === 0) {
    const pool = [];
    for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
      const name = String(t?.name ?? '');
      if (!name) continue;
      const s = scoreSimilarity(name, raw);
      if (s > 0) pool.push({ name, s });
    }
    pool.sort((a,b)=> b.s - a.s);
    for (const { name, s } of pool.slice(0, 6)) {
      if (s >= 0.35) out.add(name);
    }
  }

  return Array.from(out);
}

function matchServiceTagIdsInText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const toFW = s => String(s || '').replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～');
  const toHW = s => String(s || '').replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~');
  const scrub = s =>
    String(s || '').toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g,'');
  const norm = s => scrub(toHW(toFW(s)));
  const normText = norm(raw);

  const out = new Set();

  // 0) 厳密一致
  const direct =
        serviceTagIdByName.get(raw)
     || serviceTagIdByName.get(toFW(raw))
     || serviceTagIdByName.get(toHW(raw));
  if (direct != null) out.add(direct);

  // 1) エイリアス → 正式ラベル → ID
  for (const [alias, label] of Object.entries(PLACE_ALIASES || {})) {
    if (!alias || !label) continue;
    if (normText.includes(norm(alias))) {
      const id =
            serviceTagIdByName.get(label)
         || serviceTagIdByName.get(toFW(label))
         || serviceTagIdByName.get(toHW(label));
      if (id != null) out.add(id);
    }
  }

  // 2) 双方向部分一致
  const normalize = s => (s ? norm(s) : '');
  for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
    const name = String(t?.name ?? '');
    const id   = t?.id;
    if (!name || id == null) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(id);
  }

  // 3) ファジー補完
  if (out.size === 0) {
    const scored = [];
    for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
      const name = String(t?.name ?? '');
      const id   = t?.id;
      if (!name || id == null) continue;
      const s = scoreSimilarity(name, raw);
      if (s > 0) scored.push({ id, s });
    }
    scored.sort((a,b)=> b.s - a.s);
    for (const { id, s } of scored.slice(0, 3)) {
      if (s >= 0.35) out.add(id);
    }
  }

  return Array.from(out);
}

const PLACE_ALIASES = {
  // 医療・病院
  "急性期": "急性期病棟",
  "回復期": "回復期病棟",
  "療養": "療養病棟",
  "地域包括": "地域包括ケア病棟",
  "緩和": "緩和ケア病棟（ホスピス）",

  // 介護・福祉
  "特養": "特別養護老人ホーム",
  "地域密着特養": "地域密着型特別養護老人ホーム（定員29名以下）",
  "老健": "介護老人保健施設",
  "介護付有料": "介護付き有料老人ホーム",
  "住宅型": "住宅型有料老人ホーム",
  "サ高住": "サービス付き高齢者向け住宅（サ高住）",
  "小多機": "小規模多機能型居宅介護",
  "看多機": "看護小規模多機能型居宅介護",
  "ショート": "ショートステイ（短期入所生活介護）",
  "デイ": "通所介護（デイサービス）",
  "デイケア": "通所リハビリテーション（デイケア）",

  // 訪問系
  "訪看": "訪問看護ステーション",
  "訪問看": "訪問看護ステーション",
  "訪リハ": "訪問リハビリテーション",
  "訪問栄養": "訪問栄養指導",
  "訪問歯科": "訪問歯科",
  "訪入浴": "訪問入浴",

  // 児童・障害
  "放デイ": "放課後等デイサービス",
  "障デイ": "生活介護（障害者の日中活動）",

  // 歯科
  "歯科外来": "歯科クリニック",

  // クリニック系
  "クリニック": "クリニック",

  // そのほか素朴な省略
  "病棟": "一般病院",
};

// ---- 転職理由の名称→ID マップ（job_change_purposes.json）----
let reasonMaster = [];
try {
  const raw = require("../../job_change_purposes.json");  // tags.json と同じ階層
  if (Array.isArray(raw))              reasonMaster = raw;
  else if (Array.isArray(raw?.items))  reasonMaster = raw.items;
  else if (Array.isArray(raw?.tags))   reasonMaster = raw.tags;
  else                                 reasonMaster = [];
} catch (e) {
  console.error("job_change_purposes.json 読み込み失敗:", e);
  reasonMaster = [];
}

const reasonIdByName = new Map();
const reasonNameById = new Map(); // 逆引きも作っておく
try {
  for (const t of (Array.isArray(reasonMaster) ? reasonMaster : [])) {
    // 旧name互換も見るが、基本は tag_label を使う
    const label = String(t?.tag_label ?? t?.name ?? "");
    const id    = t?.id;
    if (!label || id == null) continue;

    // 全角/半角ゆらぎも両方登録
    const fw = label.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
    const hw = label.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");

    reasonIdByName.set(label, id);
    reasonIdByName.set(fw, id);
    reasonIdByName.set(hw, id);

    reasonNameById.set(id, label);
  }
} catch (e) {
  console.error("reasonIdByName 構築失敗:", e);
}

// ==== STEP4 LLM 用：理由IDカタログ・サニタイズ・判定 ====
const REASON_ID_SET = new Set(
  (Array.isArray(reasonMaster) ? reasonMaster : [])
    .map(t => t?.id)
    .filter(v => v != null)
);

const REASON_ID_LABELS = (Array.isArray(reasonMaster) ? reasonMaster : [])
  .map(t => ({ id: t?.id, label: String(t?.tag_label ?? t?.name ?? "") }))
  .filter(x => x.id != null && x.label);

// モデル出力のJSONを抽出（```json ... ``` でも、生テキスト内 {...} でもOKにする）
function _extractJsonBlock(s = "") {
  const t = String(s || "");
  const code = t.match(/```json\s*([\s\S]*?)```/i)?.[1]
            || t.match(/```[\s\S]*?```/i)?.[0]?.replace(/```/g, "")
            || null;
  const raw = code || t;
  // 最初の { から最後の } までを強引に拾って parse を試みる
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const slice = raw.slice(i, j + 1);
    try { return JSON.parse(slice); } catch {}
  }
  try { return JSON.parse(raw); } catch {}
  return null;
}

// 構造チェック＋正規化
function _sanitizeReasonLLM(obj) {
  const out = { empathy: "", paraphrase: "", suggested_question: "", candidates: [] };
  if (!obj || typeof obj !== "object") return out;

  out.empathy = String(obj.empathy || "");
  out.paraphrase = String(obj.paraphrase || obj.summary || "");
  out.suggested_question = String(obj.ask_next || obj.suggested_question || "");

  const list = Array.isArray(obj.candidates) ? obj.candidates : [];
  const norm = [];
  for (const c of list) {
    const id = Number(c?.id);
    let conf = Number(c?.confidence);
    if (!Number.isFinite(id) || !REASON_ID_SET.has(id)) continue;
    if (!Number.isFinite(conf)) conf = 0;
    if (conf < 0) conf = 0; if (conf > 1) conf = 1;
    norm.push({ id, confidence: conf });
  }
  norm.sort((a,b)=> b.confidence - a.confidence);
  out.candidates = norm.slice(0, 3);
  return out;
}

// LLM呼び出し：共感＋要約（paraphrase）＋候補ID＋次の深掘り（JSONで返す）
// ←この関数を丸ごと置換
async function analyzeReasonWithLLM(userText = "", s) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { empathy: "", paraphrase: "", suggested_question: "", candidates: [] };

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });

  const role    = s?.status?.role || "未入力";
  const place   = s?.status?.place || "未入力";
  const recent  = Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3).join(" / ") : "";
  const lastAsk = s?.drill?.flags?.last_ask || "";

  const system = [
    "あなたは日本語で自然に寄り添うキャリアエージェントAI。",
    "出力は必ずJSONのみ。前置きや説明は書かない。"
  ].join("\\n");

  const catalog = REASON_ID_LABELS.map(x => `${x.id}:${x.label}`).join(", ");

  const user = [
    `直近の発話: ${recent || "なし"}`,
    `直前の問いかけ: ${lastAsk || "なし"}`,
    `今回の発話: ${userText || "（内容なし）"}`,
    `職種: ${role}`,
    `現職: ${place}`,
    "",
    "job_change_purposes の候補一覧（id:label）:",
    catalog,
    "",
    "要件：JSONのみで返す。形式は：",
    `{
      "empathy": "2〜3文／100〜180字。疑問で終わらせない。命令・説教・決めつけNG。常体〜軽い口語。ですます調・敬語は禁止。",
      "paraphrase": "保存用の短い言い換え（30字以内・評価語は避ける）",
      "candidates": [{"id": 数値（上のidのみ）, "confidence": 0〜1}],
      "ask_next": "次の一言（<=80字）。疑問符で終わらせない。直前の問いとかぶらない表現。"
    }`
  ].join("\\n");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  const txt = rsp?.choices?.[0]?.message?.content || "";
  const obj = _extractJsonBlock(txt);
  return _sanitizeReasonLLM(obj);
}

// ==== STEP5/6 LLM 用：Must NG / Must Have を抽出（JSONで返す。IDは扱わない） ====
function _sanitizeMWLLM(obj){
  const out = { must_ng: [], must_have: [], summary: "", ask_next: "" };
  if (!obj || typeof obj !== "object") return out;

  const arr = (x) =>
    Array.isArray(x)
      ? x.filter(v => typeof v === "string" && v.trim()).slice(0, 10)
      : [];

  out.must_ng   = arr(obj.must_ng   ?? obj.ng   ?? obj.mustNG);
  out.must_have = arr(obj.must_have ?? obj.have ?? obj.mustHave);
  out.summary   = String(obj.summary || obj.paraphrase || "");
  out.ask_next  = String(obj.ask_next || obj.suggested_question || "");
  return out;
}

async function analyzeMWWithLLM(userText = "", mode /* 'ng' | 'have' */, s){
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { must_ng: [], must_have: [], summary: "", ask_next: "" };

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });

  const system = [
    "あなたは日本語で自然に寄り添うキャリアエージェントAI。",
    "出力は必ずJSONのみ（前置きや説明は禁止）。"
  ].join("\n");

  const role   = s?.status?.role  || "未入力";
  const place  = s?.status?.place || "未入力";
  const recent = Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3).join(" / ") : "";

  const ask = mode === "ng"
    ? "ユーザーの発話から『絶対NG（Must NG）』に該当するラベルだけを抽出して返す。"
    : "ユーザーの発話から『絶対欲しい（Must Have）』に該当するラベルだけを抽出して返す。";

  const format = `{
    "must_ng": ["文字列ラベル", ...],
    "must_have": ["文字列ラベル", ...],
    "summary": "30字以内の要約（評価語NG）",
    "ask_next": "次の一言（<=80字／疑問符で終わらせない）"
  }`;

  const user = [
    `直近の発話: ${recent || "なし"}`,
    `職種: ${role}`, `現職: ${place}`,
    `今回の発話: ${userText || "（内容なし）"}`,
    "",
    ask,
    "ID・タグ辞書・スコアリングは使わない。ラベルは日本語の自然な語で返す。",
    "出力は上記フォーマットのJSONのみ。", format
  ].join("\n");

  const rsp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
  });

  const txt = rsp?.choices?.[0]?.message?.content || "";
  const obj = _extractJsonBlock(txt);
  return _sanitizeMWLLM(obj);
}


// 候補から「確定/あいまい/不明」を決める
function decideReasonFromCandidates(cands = []) {
  const top = cands?.[0], second = cands?.[1];
  if (!top) return { status: "uncertain" };
  const gap = second ? (top.confidence - second.confidence) : Infinity;
  if (top.confidence >= 0.82 && gap >= 0.12) {
    return { status: "confirm", id: top.id };
  }
  const options = (cands || []).slice(0, 3).map(c => reasonNameById.get(c.id)).filter(Boolean);
  return options.length ? { status: "ambiguous", options } : { status: "uncertain" };
}

// ---- Step ラベル（UI用） ----
const STEP_LABELS = {
  1: "求職者ID",
  2: "職種",
  3: "現職",
  4: "転職理由",
  5: "絶対NG（Must NG）",
  6: "絶対欲しい（Must Have）",
  7: "あったら嬉しい（Want）",
  8: "これまで（Can）",
  9: "これから（Will）",
  10: "完了",
};


// ---- 深掘りの汎用質問（カテゴリ推定が弱い場合の保険） ----
const GENERIC_REASON_Q = {
  deep1: [
    "一番ストレスだったのは、仕事内容・人間関係・労働時間のどれに近い？できれば具体例があれば教えて！",
  ],
  deep2: [
    "それはいつ頃から続いてる？改善の見込みはなさそう？もう少し詳しく教えて！",
  ],
};

// >>> SALARY: helpers (after classifyMotivation)
// --- STEP4用：給与ワード検知ヘルパー ---
function detectSalaryIssue(text=""){
  return /(給料|給与|年収|月収|手取り|ボーナス|賞与|昇給|お金|安い|低い|上がらない)/i.test(String(text||""));
}
function isPeerComparisonSalary(text=""){
  return /(周り|同僚|友達|同年代|先輩|他(社|院|施設)|相場|平均|求人|市場|みんな|世間|一般)/i.test(String(text||""));
}
function isValueMismatchSalary(text=""){
  return /(見合わない|割に合わない|評価|人事考課|等級|査定|フィードバック|昇給|昇格|不公平|公平|基準|成果|反映)/i.test(String(text||""));
}
// <<< SALARY: helpers

// ---- セッション ----
const sessions = Object.create(null);
function initSession() {
  return {
    step: 1,
    isNumberConfirmed: false,
    drill: { phase: null, count: 0, category: null, awaitingChoice: false, options: [], reasonBuf: [], flags: {} },
    status: {
      number: "",
      role: "",
      role_ids: [],        // 職種（資格）の tags.json ID
      place: "",
      place_ids: [],       // 現職（施設/形態など）の tags.json ID
      place_id: null,       // ★互換用（単一ID）。STEP3で常に同期させる
      reason: "",
      reason_tag: "",
      reason_ids: [],

      // ▼ Must を2系統に分離
      must_ng: [],         // 絶対NG（Must NG）…ラベル配列
      must_have: [],       // 絶対欲しい（Must Have）…ラベル配列
      must_ng_ids: [],     // tags.json ID 配列
      must_have_ids: [],   // tags.json ID 配列

      // ▼ Want/Can/Will はテキスト保持
      want_text: "",
      can: "",
      will: "",

      licenses: [],

      // ▼ メモ（未ヒット語句の保持先を分離）
      memo: {
        role_raw: "",
        reason_raw: "",
        must_ng_raw: [],      // STEP5の未ヒット自由記述
        must_have_raw: [],    // STEP6の未ヒット自由記述
      },
    },
  };
}

// --- セッション互換初期化：ここだけが初期化の単一箇所 ---
function normalizeSession(s){
  s.step ??= 1;
  s.isNumberConfirmed ??= false;
  s.drill ??= { phase:null, count:0, category:null, awaitingChoice:false, options:[], reasonBuf:[], flags:{} };

  s.status ??= {};
  s.status.number ??= "";
  s.status.role ??= "";
  s.status.role_ids ??= [];
  s.status.place ??= "";
  s.status.place_ids ??= [];
  s.status.place_id ??= null;

  s.status.reason ??= "";
  s.status.reason_tag ??= "";
  s.status.reason_ids ??= [];

  s.status.must_ng ??= [];
  s.status.must_have ??= [];
  s.status.must_ng_ids ??= [];
  s.status.must_have_ids ??= [];

  s.status.want_text ??= "";
  s.status.can ??= "";
  s.status.will ??= "";
  s.status.licenses ??= [];

  s.status.memo ??= {};
  s.status.memo.role_raw ??= "";
  s.status.memo.reason_raw ??= "";
  s.status.memo.must_ng_raw ??= [];
  s.status.memo.must_have_raw ??= [];
  return s;
}

// --- リクエストからセッションを一度だけ確定 ---
function bootstrapSessionFromReq(req){
  const method   = (req.method || "GET").toUpperCase();
  const safeBody = (typeof req.body === "object" && req.body) ? req.body : {};

  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const querySid  = String(req.query?.sessionId || "").trim();
  const bodySid   = String(safeBody.sessionId || "").trim();
  const sessionId = headerSid || querySid || bodySid || "default";

  if (!sessions[sessionId] && safeBody.snapshot && method === "POST") {
    sessions[sessionId] = safeBody.snapshot;
  }
  const s = sessions[sessionId] ?? (sessions[sessionId] = initSession());
  normalizeSession(s);
  return { s, sessionId, method, safeBody };
}

// ★追加：Step4の選択状態を完全に終了させる
function resetDrill(s) {
  s.drill = {
    phase: null,
    count: 0,
    category: null,
    awaitingChoice: false,
    options: [],
    reasonBuf: s.drill?.reasonBuf || [],
    flags: s.drill?.flags || {},
  };
}

// --- 共通: CORS/JSON をまとめる ---
function setCorsJson(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Id");
  res.setHeader("Allow", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

export default async function handler(req, res) {
  setCorsJson(res);
  const { s, method, safeBody } = bootstrapSessionFromReq(req);

  // 非POSTは統一で 200 + JSON
  if (method !== "POST") {
    const greet = s.isNumberConfirmed
      ? nextAfterId(s)
      : "こんにちは！私はAIキャリアエージェント『ほーぷちゃん』です🤖✨\n担当との面談の前に、あなたの希望条件や想いを整理していくね！\n\n最初に【求職者ID】を教えてね。※メールに届いているIDだよ。";

    return res.status(200).json(withMeta({
      response: greet,
      step: s.step,
      status: s.status,
      isNumberConfirmed: s.isNumberConfirmed,
      candidateNumber: s.status.number || "",
      debug: debugState(s),
    }, s.step));
  }


  // ========== ここから通常の会話処理（POST） ==========

// ここで関数スコープに変数を確保（Step1以降でも使えるように var を使用）
var text = "";
var idDigits = "";
var looksId = false;

try {
  const { message = "" } = safeBody;  // ← req.body じゃなく safeBody を使う
  text = String(message || "").trim();

  // IDフォーマット判定（10〜20桁の数字を許容。ハイフン/空白など混在OK）
  idDigits = String(text || "").replace(/\D/g, ""); // 数字だけ抽出
  looksId = idDigits.length >= 10 && idDigits.length <= 20;

  // 既にID確認済みで、さらにIDっぽい入力が来たら「次へ進む」案内を返す
  if (s.isNumberConfirmed && looksId) {
    return res.json(withMeta({
      response: nextAfterId(s),
      step: s.step,
      status: s.status,
      isNumberConfirmed: true,
      candidateNumber: s.status.number,
      debug: debugState(s),
    }, s.step));
  }
} catch (err) {
  console.error("chat handler error:", err && (err.stack || err.message || err));
  return res.status(500).json({
    error: "handler_crashed",
    message: String(err && (err.message || err)) || "unknown",
  });
}

  // ---- Step1：求職者ID ----
  if (s.step === 1) {
    if (!looksId) {
      return res.json(withMeta({
        response:
          "こんにちは！私はAIキャリアエージェント『ほーぷちゃん』です🤖✨\n" +
          "担当との面談の前に、あなたの希望条件や想いを整理していくね！\n\n" +
          "最初に【求職者ID】を教えてね。※メールに届いているIDだよ。",
        step: 1, status: s.status, isNumberConfirmed: false, candidateNumber: "", debug: debugState(s)
      }, 1));
    }
    s.status.number = idDigits;
    s.isNumberConfirmed = true;
    s.step = 2;
    return res.json(withMeta({
      response: "OK、求職者ID確認したよ！\n次に【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など",
      step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 2));
  }

  // ---- Step2：職種（所有資格） ----
if (s.step === 2) {
  // ユーザーの元発話を保存（ID化失敗時はこの文字列をそのまま表示）
if (!s.drill.awaitingChoice) {
  s.status.memo.role_raw = text || "";
}
  // すでに選択肢を出している場合の応答
  if (s.drill.phase === "license" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    // まずはラベル名そのまま一致
   let chosen = s.drill.options.find(o => o === pick);
    // だめなら別名→正規ラベル解決（例：実務者 → 実務者研修）
   if (!chosen) {
   const resolved = matchLicensesInText(pick); // 別名でもOK
   if (resolved.length) {
   chosen = resolved.find(label => s.drill.options.includes(label)) || null;
  }
}
    if (chosen) {
  s.status.role = chosen;
  s.status.licenses = [chosen];
  s.status.role_ids = []; // ← tags.json由来のID取得フローを廃止
      s.status.role_ids = getIdsForOfficialLicense(chosen);
  s.drill = {
  phase: null,
  count: 0,
  category: null,
  awaitingChoice: false,
  options: [],
  reasonBuf: s.drill.reasonBuf || [],
  flags: s.drill.flags || {},
};
  s.step = 3;
  return res.json(withMeta({
    response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）急性期病棟／訪問看護ステーション",
    step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 3));
}
    // 再提示
    return res.json(withMeta({
      response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 2));
  }

    const found = matchLicensesInText(text); // 候補を全部拾う

  // 完全一致（全角/半角ゆらぎ・空白除去込み）を最優先で自動確定
  const raw = String(text || "").trim();
  const toFW = (s) => s.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => s.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const normalize = (s) => toHW(toFW(String(s || ""))).replace(/[ \t\r\n\u3000]/g, "");
  const exact = found.find(l => normalize(l) === normalize(raw));

  if (exact) {
    s.status.role = exact;
    s.status.licenses = [exact];
    s.status.role_ids = getIdsForOfficialLicense(exact);
    s.step = 3;
    return res.json(withMeta({
      response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）急性期病棟／訪問看護ステーション",
      step: 3, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }

  // 候補が1件だけなら自動確定
  if (found.length === 1) {
    s.status.role = found[0];
    s.status.licenses = [found[0]];
    s.status.role_ids = getIdsForOfficialLicense(found[0]);
    s.step = 3;
    return res.json(withMeta({
      response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）急性期病棟／訪問看護ステーション",
      step: 3, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }

  // 候補ゼロ：公式マスタからのID解決をまず試す（成功したら正式名に正規化）
if (found.length === 0) {
  const ids = getIdsForOfficialLicense(text);
  if (ids.length) {
    s.status.role_ids = ids;
    const official = licenseTagNameById.get(ids[0]) || text || "";
    s.status.role = official;
  } else {
    s.status.role = text || "";
    s.status.role_ids = [];
  }
  s.step = 3;
  return res.json(withMeta({
    response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）急性期病棟／訪問看護ステーション",
    step: 3, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 3));
}

  // 複数候補：選択肢を提示
  const options = found.slice(0, 6);
  s.drill.phase = "license";
  s.drill.awaitingChoice = true;
  s.drill.options = options;
  return res.json(withMeta({
    response: `どれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`,
    step: 2, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 2));
}
  
  // ---- Step3：現職 ----
if (s.step === 3) {
  // すでに選択肢提示中なら、ユーザーの選択を確定
  if (s.drill.phase === "place" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    // まずはそのまま一致
    let chosen = s.drill.options.find(o => o === pick);

    // ゆらぎ対策（全角/半角・空白除去）
    if (!chosen) {
      const toFW = (x) => x.replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
      const toHW = (x) => x.replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
      const normalize = (x) => toHW(toFW(String(x||""))).replace(/[ \t\r\n\u3000]/g,"");
      chosen = s.drill.options.find(o => normalize(o) === normalize(pick)) || null;
    }

    if (chosen) {
      s.status.place = chosen;

            // ラベル→ID（サービス形態限定：厳密一致→限定ファジー）＋ 正式名称へ正規化
      const id =
            serviceTagIdByName.get(chosen)
         || serviceTagIdByName.get(chosen.replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～'))
         || serviceTagIdByName.get(chosen.replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~'));

      if (id != null) {
        s.status.place_ids = [id];
        s.status.place_id  = id; // 追加
        const official = serviceTagNameById.get(id);
        if (official) s.status.place = official;
      } else {
        // サービス形態限定のフォールバック
        const ids = matchServiceTagIdsInText(chosen);
        if (Array.isArray(ids) && ids.length) {
          s.status.place_ids = [ids[0]];
          s.status.place_id  = ids[0]; // 追加
          const official = serviceTagNameById.get(ids[0]);
          if (official) s.status.place = official;
        } else {
          // サービス形態外はIDを付与しない（placeは保持、place_idsは空）
          s.status.place_ids = [];
          s.status.place_id  = null;   // 追加
        }
      }

      // 次ステップへ
      s.drill = {
        phase: "reason",
        count: 0,
        category: null,
        awaitingChoice: false,
        options: [],
        reasonBuf: [],
        flags: s.drill.flags || {},
      };
      s.step = 4;
      return res.json(withMeta({
        response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
        step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    // 再提示
    return res.json(withMeta({
      response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }
// 初回入力：候補抽出
const foundLabels = matchServicePlacesInText(text); // サービス形態限定のラベル配列
const raw = String(text || "").trim();

// 完全一致を最優先で自動確定
const toFW = (x) => x.replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～');
const toHW = (x) => x.replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~');
const normalize = (x) => toHW(toFW(String(x||""))).replace(/[ \t\r\n\u3000]/g,"");
const exact = foundLabels.find(l => normalize(l) === normalize(raw));

// サービス形態のみ：ラベル→ID 解決（厳密一致→サービス形態限定フォールバック）
const finalize = (label) => {
  s.status.place = label;

  const id =
        serviceTagIdByName.get(label)
     || serviceTagIdByName.get(toFW(label))
     || serviceTagIdByName.get(toHW(label));

  if (id != null) {
    s.status.place_ids = [id];
    s.status.place_id  = id; // 追加                    
    const official = serviceTagNameById.get(id);
    if (official) s.status.place = official; // 正式名称で上書き
  } else {
    const ids = matchServiceTagIdsInText(label); // サービス形態限定フォールバック
    if (Array.isArray(ids) && ids.length) {
      s.status.place_ids = [ids[0]];
      s.status.place_id  = ids[0]; // 追加
      const official = serviceTagNameById.get(ids[0]);
      if (official) s.status.place = official;
    } else {
      // サービス形態外はIDを付与しない（placeは保持、place_idsは空）
      s.status.place_ids = [];
      s.status.place_id  = null;   // 追加
    }
  }

  // 次へ（Step4）
  s.drill = {
    phase: "reason",
    count: 0,
    category: null,
    awaitingChoice: false,
    options: [],
    reasonBuf: [],
    flags: s.drill.flags || {},
  };
  s.step = 4;

  return res.json(withMeta({
    response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
};

if (exact) {
  // ① 入力と完全一致があれば即確定
  return finalize(exact);
}
if (foundLabels.length === 1) {
  // ② 候補が1つなら自動確定
  return finalize(foundLabels[0]);
}
if (foundLabels.length >= 2) {
  // ③ 複数候補 → 選択肢提示（最大6）
  const options = foundLabels.slice(0, 6);
  s.drill.phase = "place";
  s.drill.awaitingChoice = true;
  s.drill.options = options;
  return res.json(withMeta({
    response: `どれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`,
    step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 3));
}

// ④ 候補ゼロ：ユーザーの文字列をそのまま保持し、IDは付与しない
s.status.place = raw;
s.status.place_ids = [];   // サービス形態以外はIDを付与しない
s.status.place_id  = null; // 追加

// 次へ（Step4）
s.drill = {
  phase: "reason",
  count: 0,
  category: null,
  awaitingChoice: false,
  options: [],
  reasonBuf: [],
  flags: s.drill.flags || {},
};
s.step = 4;
return res.json(withMeta({
  response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
  step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
}, 4));
  
}

 // ---- Step4：転職理由（LLM主導：共感＋要約＋ID候補＋次の深掘り） ----
if (s.step === 4) {

  // --- 既存：給与トリアージ（最優先） ---
  if (s.drill.phase === "salary-triage" && s.drill.awaitingChoice) {
    s.drill.reasonBuf.push(text || "");

    if (isPeerComparisonSalary(text)) {
      s.status.reason_tag = "";
      s.status.reason_ids = [];
      resetDrill(s);
      s.step = 5;

            const emp = await generateEmpathy(text, s);
      const empSafe = sanitizeEmpathy(emp);
      const msg = "収入アップが主目的ってこと、把握したよ。担当エージェントに共有するね。";
      return res.json(withMeta({
        response: joinEmp(empSafe, `${msg}\n\n${mustIntroText()}`),

        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }

    if (isValueMismatchSalary(text)) {
      s.drill.category = "仕事内容・キャリアに関すること";
      s.drill.awaitingChoice = false;
      s.drill.count = 1;

            const q = "評価や昇給の基準が不透明？成果が給与に反映されてない感じ？";
      const emp = await generateEmpathy(text, s);
      const empSafe = sanitizeEmpathy(emp);
      return res.json(withMeta({
        response: joinEmp(empSafe, q),
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    // 判定つかない → 通常LLMルートへ合流
    s.drill.awaitingChoice = false;
    s.drill.count = 1;
  }

  // --- 既存：オンコール/夜勤のプライベート強制（確認フロー） ---
  if (s.drill.phase === "private-confirm" && s.drill.awaitingChoice) {
    if (isYes(text)) {
      const tag = "家庭との両立に理解のある職場で働きたい";
      s.status.reason_tag = tag;
      const rid = reasonIdByName.get(tag);
      s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
      resetDrill(s);
      s.step = 5;
      return res.json(withMeta({
        response: `『${tag}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }
    // Yes以外 → 固定文で未マッチ扱い
    s.drill.flags.privateDeclined = true;
    resetDrill(s);
    s.status.reason_tag = "";
    s.status.reason_ids = [];
    s.step = 5;

    const emp0 = await generateEmpathy(text, s);
    const emp0Safe = sanitizeEmpathy(emp0);
    const fixed = "無理なく働ける職場を考えていこうね。";
    return res.json(withMeta({
      response: joinEmp(emp0Safe, `${fixed}\n\n${mustIntroText()}`),
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // --- 新規：LLM提示の選択肢に対する回答（最大3つから1つ） ---
  if (s.drill.phase === "reason-llm-choice" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    const chosen = s.drill.options.find(o => o === pick);
    if (chosen) {
      s.status.reason_tag = chosen;
      const rid = reasonIdByName.get(chosen);
      s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
      resetDrill(s);
      s.step = 5;

      const emp = await generateEmpathy(text, s);
      const empSafe = sanitizeEmpathy(emp);
      return res.json(withMeta({
        response: joinEmp(empSafe, `『${chosen}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`),

        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }
    // 再提示
    return res.json(withMeta({
      response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  // --- 入口：1回目の入力（count===0） ---
  if (s.drill.count === 0) {
    // ID未確定テキストを保持（未マッチ時に使う）
    s.status.reason = text || "";
    s.status.memo.reason_raw = text || "";
    s.drill.reasonBuf = [text || ""];

    // 最優先：オンコール/夜勤の強制判定
    const forced0 = shouldForcePrivate(s) ? forcePrivateOncallNight(text) : null;
    if (forced0) {
      s.drill.category = forced0.category;
      s.drill.phase = "private-confirm";
      s.drill.awaitingChoice = true;
      s.drill.count = 0;

      const emp0 = await generateEmpathy(text, s);
      const confirmText = "プライベートや家庭との両立に理解がほしい感じ？";
      return res.json(withMeta({
        response: joinEmp(emp0, confirmText),
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    // 給与トリアージのエントリチェック（既存ロジック）
    if (detectSalaryIssue(text)) {
      s.drill.phase = "salary-triage";
      s.drill.awaitingChoice = true;
      s.drill.count = 0;

      const emp0 = await generateEmpathy(text, s);
      const triage = "どうしてそう思う？周りの相場と比べて？それとも自分の働きに見合ってない感じ？";
      return res.json(withMeta({
        response: joinEmp(emp0, triage),
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

        // --- LLM呼び出し（第1回）：共感＋要約＋次の深掘り ---
    const llm1 = await analyzeReasonWithLLM(text, s);
    const empathyRaw = llm1?.empathy || await generateEmpathy(text, s);
    const empathySafe = sanitizeEmpathy(empathyRaw);

    let nextQ = (llm1?.suggested_question && llm1.suggested_question.trim())
      || "一番ひっかかる点はどこか、もう少しだけ教えてね。";

    // 重複抑止：前ターンと同義なら今回は出さない（共感のみ返す）
    if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
      nextQ = "";
    }

    s.drill.count = 1;
    s.drill.phase = "reason-llm-ask2";
    s.drill.awaitingChoice = false;

    // 内部用メモ（返却しない）
    s.drill.flags.last_llm_candidates = llm1?.candidates || [];
    s.drill.flags.last_llm_summary    = llm1?.paraphrase || "";
    s.drill.flags.last_ask            = nextQ || ""; // 空なら上書き（＝“今回なし”の明示）

    return res.json(withMeta({
      response: nextQ ? joinEmp(empathySafe, nextQ) : empathySafe,
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  // --- 2回目の入力（count===1）：確定/もう1ターン判断 ---
  if (s.drill.count === 1) {
    s.drill.reasonBuf.push(text || "");
    const joined = s.drill.reasonBuf.join(" ");

    // 強制分岐の再チェック
    const forced1 = shouldForcePrivate(s) ? forcePrivateOncallNight(joined) : null;
    if (forced1) {
      const sole = forced1.options?.length === 1 ? forced1.options[0] : null;
      if (sole) {
        s.status.reason_tag = sole;
        const rid = reasonIdByName.get(sole);
        s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
        resetDrill(s);
        s.step = 5;
        return res.json(withMeta({
          response: `『${sole}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
          step: 5, status: s.status, isNumberConfirmed: true,
          candidateNumber: s.status.number, debug: debugState(s)
        }, 5));
      }
    }
}
    // --- LLM呼び出し（第2回）：候補で確定判定 ---
    const llm2 = await analyzeReasonWithLLM(joined, s);
    const empathy2 = llm2?.empathy || await generateEmpathy(text, s);
    const decision = decideReasonFromCandidates(llm2?.candidates || []);

    if (decision.status === "confirm") {
      const id = decision.id;
      const label = reasonNameById.get(id) || "";
      s.status.reason_tag = label;
      s.status.reason_ids = [id];
      resetDrill(s);
      s.step = 5;
      return res.json(withMeta({
        response: joinEmp(empathy2, `『${label}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`),
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }

        if (decision.status === "ambiguous") {
      let nextQ = llm2?.suggested_question || "具体的にどんな場面で一番強く感じたか、教えてね。";
      const empathy2Safe = sanitizeEmpathy(empathy2);

      if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
        nextQ = "";
      }

      s.drill.count = 2;
      s.drill.phase = "reason-llm-ask3";
      s.drill.awaitingChoice = false;
      s.drill.flags.last_llm_candidates = llm2?.candidates || [];
      s.drill.flags.last_llm_summary    = llm2?.paraphrase || "";
      s.drill.flags.last_ask            = nextQ || "";

      return res.json(withMeta({
        response: nextQ ? joinEmp(empathy2Safe, nextQ) : empathy2Safe,
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }
        // 不確定：もう1ターン深掘り
      let nextQ = llm2?.suggested_question || "一番の根っこは何か、言葉にしてみてね。";
      const empathy2Safe = sanitizeEmpathy(empathy2);

      if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
        nextQ = "";
      }

      s.drill.count = 2;
      s.drill.phase = "reason-llm-ask3";
      s.drill.awaitingChoice = false;
      s.drill.flags.last_llm_candidates = llm2?.candidates || [];
      s.drill.flags.last_ask = nextQ || "";

      return res.json(withMeta({
        response: nextQ ? joinEmp(empathy2Safe, nextQ) : empathy2Safe,
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));

    // --- 3回目の入力（count===2）：確定 or 選択肢提示（最大3） ---
  if (s.drill.count === 2) {
    s.drill.reasonBuf.push(text || "");
    const joined = s.drill.reasonBuf.join(" ");

    const forced2 = shouldForcePrivate(s) ? forcePrivateOncallNight(joined) : null;
    if (forced2) {
      const sole = forced2.options?.length === 1 ? forced2.options[0] : null;
      if (sole) {
        s.status.reason_tag = sole;
        const rid = reasonIdByName.get(sole);
        s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
        resetDrill(s);
        s.step = 5;
        return res.json(withMeta({
          response: `『${sole}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
          step: 5, status: s.status, isNumberConfirmed: true,
          candidateNumber: s.status.number, debug: debugState(s)
        }, 5));
      }
    }

    const llm3 = await analyzeReasonWithLLM(joined, s);
    const empathy3 = llm3?.empathy || await generateEmpathy(text, s);
    const decision = decideReasonFromCandidates(llm3?.candidates || []);

        if (decision.status === "confirm") {
      const id = decision.id;
      const label = reasonNameById.get(id) || "";
      s.status.reason_tag = label;
      s.status.reason_ids = [id];
      resetDrill(s);
      s.step = 5;
      const empathy3Safe = sanitizeEmpathy(empathy3);
      return res.json(withMeta({
        response: joinEmp(empathy3Safe, `『${label}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`),
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }

    // まだ曖昧 → 最大3つの選択肢を提示（確定済みなら出さない）
    const options = (decision.status === "ambiguous" ? decision.options : [])
      .filter(Boolean)
      .slice(0, 3);

    if (options.length) {
      s.drill.phase = "reason-llm-choice";
      s.drill.awaitingChoice = true;
      s.drill.options = options;

        const empathy3Safe = sanitizeEmpathy(empathy3);
        return res.json(withMeta({
          response: joinEmp(empathy3Safe, `この中だとどれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`),
          step: 4, status: s.status, isNumberConfirmed: true,
          candidateNumber: s.status.number, debug: debugState(s)
        }, 4));

    // それでも未決 → paraphraseテキストで確定してStep5へ
    // ルール：IDが確定できない場合は、LLMのparaphrase（<=30字）をステータスにテキストのまま保持し、必ずStep5へ進める。
      const p1 = String(llm3?.paraphrase || "").trim();
      const p2 = String(s.drill?.flags?.last_llm_summary || "").trim();
      const p3 = String(joined || "").slice(0, 30);
      const finalParaphrase = (p1 || p2 || p3) || "理由（テキスト）";

      s.status.reason_tag = finalParaphrase; // ステータスバーにはテキストをそのまま表示
      s.status.reason_ids = [];              // IDは未確定なので空
      resetDrill(s);
      s.step = 5;

        const empathy3Safe = sanitizeEmpathy(empathy3);
        return res.json(withMeta({
          response: joinEmp(empathy3Safe, mustIntroText()),
          step: 5, status: s.status, isNumberConfirmed: true,
          candidateNumber: s.status.number, debug: debugState(s)
        }, 5));
  }

  // フォールバック
  const empF = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empF, "もう少しだけ詳しく教えて！"),
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
} // ← if (s.step === 4) の終わり

  // ---- Step5：絶対NG（Must NG） ----
if (s.step === 5) {
  // 1) なし宣言 → 次へ
  if (isNone(text)) {
    s.step = 6;
    return res.json(withMeta({
      response: "次は【これだけは絶対ないと困る！】という条件を教えてね。\n「賞与がないと困る！」\n「絶対土日休みがいい！」\nって感じ。1個じゃなくてもOKだよ！",
      step: 6, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s),
    }, 6));
  }

  // 2) LLM で抽出（タグ辞書・ID解決はしない）
  const mw = await analyzeMWWithLLM(text, "ng", s);
  const emp = await generateEmpathy(text || "", s);

  // 3) 追加（文字列ラベルのみ保持）
  const added = [];
  for (const lb of (mw.must_ng || [])) {
    if (!s.status.must_ng.includes(lb)) {
      s.status.must_ng.push(lb);
      added.push(lb);
    }
  }
  // ※ must_ng_ids は使わない（タグ辞書排除のため更新しない）
  // 　未ヒットはメモに積む
  if (!added.length) {
    s.status.memo.must_ng_raw ??= [];
    s.status.memo.must_ng_raw.push(text);
  }

  const tail = "他にも『これは絶対ダメ！』はある？（なければ「ない」って返してね）";
  const head = added.length ? `OK！『${added.join("』『")}』だね。担当エージェントに共有するね。` : "";
  return res.json(withMeta({
    response: joinEmp(emp, [head, tail].filter(Boolean).join("\n")),
    step: 5, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 5));
}

 // ---- Step6：絶対欲しい（Must Have） ----
if (s.step === 6) {
  // 1) なし宣言 → 次へ
  if (isNone(text)) {
    s.step = 7;
    return res.json(withMeta({
      response: "次は【これがあったら（なかったら）嬉しいな】という条件を教えてね。\n自由に回答してね！",
      step: 7, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 7));
  }

  // 2) LLM で抽出（タグ辞書・ID解決はしない）
  const mw = await analyzeMWWithLLM(text, "have", s);
  const emp = await generateEmpathy(text || "", s);

  // 3) 追加（文字列ラベルのみ保持）
  const added = [];
  for (const lb of (mw.must_have || [])) {
    if (!s.status.must_have.includes(lb)) {
      s.status.must_have.push(lb);
      added.push(lb);
    }
  }
  // ※ must_have_ids は使わない
  if (!added.length) {
    s.status.memo.must_have_raw ??= [];
    s.status.memo.must_have_raw.push(text);
  }

  const tail = "他にも『これは必須でほしい！』はある？（なければ「ない」って返してね）";
  const head = added.length ? `『${added.join("』『")}』も担当エージェントに共有するね！` : "";
  return res.json(withMeta({
    response: joinEmp(emp, [head, tail].filter(Boolean).join("\n")),
    step: 6, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 6));
}

  // ---- Step7：あったら嬉しい（Want / 自由記述）----
if (s.step === 7) {
  s.status.want_text = text || "";
  s.step = 8;
  const emp = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(emp, "次は【これまでやってきたこと／自分が得意なこと】を教えてね。\n「急性期病棟で3年勤務した」\n「採血が得意で周りから褒められる」\nみたいな感じ！"),
    step: 8, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 8));
}

// ---- Step8：Can ----
if (s.step === 8) {
  s.status.can = text || "";
  s.step = 9;
  const empCan = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empCan, "最後！【これから挑戦したいこと】を教えてね。\n「未経験だけど在宅の分野に挑戦したい」\n「プライベートと両立しながら看護師のキャリアを継続したい」\nあなたの想いを自由に書いてね！"),
    step: 9, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 9));
}

// ---- Step9：Will ----
if (s.step === 9) {
  s.status.will = text || "";
  s.step = 10;
  const empWill = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empWill, "今日はたくさん話してくれて助かった！\n整理した内容は担当エージェントに共有するね。"),
    step: 10, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 10));
}

// ---- Step10：完了後の追加発話 ----
if (s.step === 10) {
  const empDone = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empDone, "ここまでで入力はOK！続きは担当エージェントと詰めていこう。"),
    step: 10,
    status: s.status,
    isNumberConfirmed: true,
    candidateNumber: s.status.number,
    debug: debugState(s),
  }, 10));
}


  // 想定外フォールバック
  return res.json(withMeta({
    response: "（内部エラー）",
    step: s.step,
    status: s.status,
    isNumberConfirmed: s.isNumberConfirmed,
    candidateNumber: s.status.number,
    debug: debugState(s)
  }, s.step));
}
 
// ---- 入口 ここまで ----

// ==== 共感生成（自然な会話風） ====
// ←この関数を丸ごと置換
async function generateEmpathy(userText, s){
  const key = process.env.OPENAI_API_KEY;
  const fallback = "今の話、ちゃんと受け取ったよ。";
  const recent = Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3).join(" / ") : "";
  const role = s?.status?.role || "";
  const place = s?.status?.place || "";
  const cat = s?.drill?.category || "";

  if (!key) return fallback;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key });

    const system = [
      "あなたは日本語で自然に寄り添う会話を返すAI。",
      "決まり文句やお祈り文句は禁止。",
      "丁寧すぎず崩しすぎない口調。敬語に寄りすぎない。",
      "命令・説教・断定の押し付けは禁止。",
      "共感文は必ず 2〜3文／100〜180字。疑問符で終わらせない。"
    ].join("\\n");

    const user = [
      `直近の発話: ${recent || "なし"}`,
      `職種: ${role || "未入力"}`,
      `現職: ${place || "未入力"}`,
      `カテゴリ: ${cat || "未確定"}`,
      "",
      `今回の発話: ${userText || "（内容なし）"}`,
      "",
      "避ける言い回し例: ありがとう 大切 寄り添う わかる そうだよね 安心して 頑張ろう 大丈夫 受け止めた 整理しよう"
    ].join("\\n");

    const rsp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      top_p: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 220,
    });

    let txt = rsp?.choices?.[0]?.message?.content?.trim() || "";
    // 後処理（軽整形＋終端調整）
    txt = txt.replace(/\"/g, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    txt = enforcePlainEnding(txt);
    return txt || fallback;
  } catch {
    return fallback;
  }
}

// ==== 類似度＆共感用ヘルパ ====

// 全角↔半角のゆらぎ吸収＆区切り削除
function _toFW(s){ return String(s||"").replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～"); }
function _toHW(s){ return String(s||"").replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~"); }
function _scrub(s){ return String(s||"").replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～!?！？。、，．・]/g,""); }
function _norm(s){ return _scrub(_toHW(_toFW(String(s||"")))); }

function forcePrivateOncallNight(userText = "") {
  const t = String(userText || "");
  if (/(オンコール|ｵﾝｺｰﾙ|夜勤)/i.test(t)) {
    return {
      category: "プライベートに関すること",
      options: ["家庭との両立に理解のある職場で働きたい"],
    };
  }
  return null;
}

function shouldForcePrivate(s){
  // 「プライベート(両立)ではない」と否定されたら、以後は強制をかけない
  return !(s && s.drill && s.drill.flags && s.drill.flags.privateDeclined);
}

function hasOncallNight(text = "") {
  return /(オンコール|ｵﾝｺｰﾙ|夜勤)/i.test(String(text || ""));
}
function isYes(text = "") {
  return /^(はい|うん|そう|ok|了解|そのとおり|そんな感じ|お願いします|それで|求めてる)/i.test(String(text || "").trim());
}

// ---- ヘルパ ----

// 疑問で終わらせないフィルタ（←この関数を丸ごと置換）
function enforcePlainEnding(text = '') {
  let t = String(text).trim();
  if (!t) return t;

  t = t.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // 末尾が ? / ？ のときは句点に置換
  t = t.replace(/[？?]+$/,'。');

  // 終端に句読点等がなければ句点を付与
  if (!/[。！？!？＞）)\]]$/.test(t)) t += '。';
  return t;
}

function joinEmp(a, b) {
  const left  = String(a || "").trimEnd();           // 共感文の末尾を整える
  const right = String(b || "").replace(/^\n+/, ""); // 定型文の先頭改行は削る
  return `${left}\n\n${right}`;                      // 空行1つでつなぐ
}

// === LLM出力サニタイズ（共感文） ===
// ・疑問符で終わらせない（enforcePlainEnding で実施）
// ・丁寧語（です/ます調）が混ざった場合は、軽い常体に寄せる簡易置換
//   ※言い回しは最小限。強い断定や命令形へは変換しない。
function sanitizeEmpathy(text = "") {
  let t = String(text || "").trim();

  // 句読点・疑問符の最終処理
  t = enforcePlainEnding(t);

  // 丁寧語ベースの簡易ゆる和らげ（“です/ます”終止が続く時のみ）
  // - 例: 「〜だと思います。」→「〜だと思う。」
  // - 例: 「〜に感じます。」→「〜に感じる。」
  // - 例: 「〜ですよね。」→「〜だよね。」
  t = t
    .replace(/(?<=だと|と思|と感じ|に感じ|に思)(います)(。|！|！|)$/, "う$2")
    .replace(/(ですよね)(。|！|！|)$/g, "だよね$2")
    .replace(/(でしょう)(。|！|！|)$/g, "だろう$2")
    .replace(/(です)(。|！|！|)$/g, "。")
    .replace(/(ます)(。|！|！|)$/g, "。")
    .replace(/。。+$/g, "。"); // 句点の重複を1つに

  // 再度終端調整（置換で句点が飛ぶケースをカバー）
  t = enforcePlainEnding(t);
  return t;
}

// 「前ターンと同じ or ほぼ同じ促し」を避けるための簡易一致判定
function isSamePrompt(a = "", b = "") {
  const na = String(a || "").replace(/\s+/g, "").trim();
  const nb = String(b || "").replace(/\s+/g, "").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 片方がもう一方を完全包含していれば同義とみなす（過剰誘導の連投防止）
  return na.includes(nb) || nb.includes(na);
}

// ▼▼ buildStatusBar（置換 or 追加） ▼▼
function buildStatusBar(st = {}, currentStep = 0) {
  const maxStep = 10;
  const steps = [];
  for (let i = 1; i <= maxStep; i++) {
    steps.push({
      id: i,
      label: STEP_LABELS[i] || `STEP ${i}`,
      done: i < currentStep,
      active: i === currentStep,
      todo: i > currentStep,
    });
  }

  const progress =
    currentStep <= 1 ? 0 :
    currentStep >= maxStep ? 1 :
    (currentStep - 1) / (maxStep - 1);

  // ←ここで candidateNumber / number を追加（どちらのキーでも拾えるように）
  return {
    current: currentStep,
    progress,
    steps,
    candidateNumber: String(st?.number || ""),
    number: String(st?.number || ""),
  };
}
// ▲▲ ここまで ▲▲


function withMeta(payload, step) {
  const statusBar = buildStatusBar(payload.status, step);
  return {
    ...payload,
    meta: {
      step,
      step_label: STEP_LABELS[step] ?? "",
      statusBar,
      debug: payload.debug,
    },
  };
}


function debugState(s) {
  return {
    drill: { ...s.drill },
    reasonCategory: s.drill.category,
    awaitingChoice: s.drill.awaitingChoice,
    reasonTag: s.status.reason_tag,
    mustCount: (s.status.must_ng || []).length,     // 修正：must_ng配列を使用
    wantCount: (s.status.want_text || "").length,   // 修正：want_textの文字数
  };
} 

// 0.5 を使わない進行に合わせた文言
function nextAfterId(s) {
  switch (s.step) {
    case 2:
      return "IDは確認済だよ！次に【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など";
    case 3:
      return "IDは確認済だよ！次に【今どこで働いてる？】を教えてね。\n（例）○○病院 外来／△△クリニック";
    case 4:
      return "IDは確認済だよ！\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎";
    default:
      return "IDは確認済だよ！";
  }
}

function mustIntroText() {
  // STEP5の導入は Must NG 用に変更
  return "OK！ここから条件の整理に入るね。\n\n" +
         "まずは【絶対NG】の条件を教えてほしい。\n" +
         "仕事内容でも制度でもOKで、これは無理！ってやつ。\n\n" +
         "例えば・・・\n" +
         "「夜勤は絶対できない！」\n" +
         "「オンコールは無理！」\n" +
         "「長時間の残業は嫌だ！」\n\n" +
         "次に『絶対ないと困るもの』を聞くから、今は“NG”だけ教えてね。";
}


function noOptionCategory(cat) {
  return cat === "職場環境・設備" || cat === "職場の安定性" || cat === "給与・待遇";
}

function pickReasonCategory(text) {
  const t = (text || "").toLowerCase();
  let best = null, score = 0;
  for (const [cat, def] of Object.entries(transferReasonFlow)) {
    const hit = (def.keywords || []).reduce((acc, kw) => acc + (t.includes(String(kw).toLowerCase()) ? 1 : 0), 0);
    if (hit > score) { score = hit; best = cat; }
  }
  return best;
}

function matchTags(text, dict) {
  const t = (text || "").toLowerCase();
  const hits = [];
  for (const item of dict) {
    if (t.includes(item.toLowerCase())) hits.push(item);
  }
  return hits;
}

function normalizePick(text) {
  return String(text || "").replace(/[［\[\]］]/g, "").trim();
}

function isNone(text) {
  const t = (text || "").trim();
  return /^(ない|特にない|無し|なし|no)$/i.test(t);
}

// 入力に含まれる資格ラベル候補をすべて返す（同一ラベルは重複排除）
// ★正規化して部分一致するように改善版
function matchLicensesInText(text = "") {
  const toFW = (s) => String(s || "").replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
  const toHW = (s) => String(s || "").replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
  const scrub = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～!?！？。、，．・]/g,"");
  const norm = (s) => scrub(toHW(toFW(s)));

  const normText = norm(text);
  if (!normText) return [];

  const out = new Set();
  for (const [alias, labels] of licenseMap.entries()) {
    if (!alias || !Array.isArray(labels) || !labels.length) continue;
    if (normText.includes(norm(alias))) {
      for (const l of labels) if (l) out.add(l);
    }
  }
  return Array.from(out);
}

// これで既存の matchTagIdsInText を“丸ごと置き換え”
function matchTagIdsInText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) =>
    String(s || "").toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g, "");
  const norm = (s) => scrub(toHW(toFW(s)));

  const normText = norm(raw);
  const out = new Set();

  // 0) 厳密一致（全角/半角ゆらぎも）
  const direct =
      tagIdByName.get(raw)
   || tagIdByName.get(toFW(raw))
   || tagIdByName.get(toHW(raw));
  if (direct != null) out.add(direct);

  // 1) エイリアス → 正式ラベル → ID
  for (const [alias, label] of Object.entries(PLACE_ALIASES || {})) {
    if (!alias || !label) continue;
    if (normText.includes(norm(alias))) {
      const id =
          tagIdByName.get(label)
       || tagIdByName.get(toFW(label))
       || tagIdByName.get(toHW(label));
      if (id != null) out.add(id);
    }
  }

  // 2) 双方向の部分一致（タグ名 ⊂ 入力 / 入力 ⊂ タグ名）
  const normalize = (s) => (s ? norm(s) : "");
  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    const id   = t?.id;
    if (!name || id == null) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(id);
  }

  // 3) まだ空ならファジー（2-gram Jaccard）で上位を補完
  if (out.size === 0) {
    const scored = [];
    for (const t of (Array.isArray(tagList) ? tagList : [])) {
      const name = String(t?.name ?? "");
      const id   = t?.id;
      if (!name || id == null) continue;
      const s = scoreSimilarity(name, raw);
      if (s > 0) scored.push({ id, s });
    }
    scored.sort((a,b)=> b.s - a.s);
    for (const { id, s } of scored.slice(0, 3)) {
      if (s >= 0.35) out.add(id);
    }
  }
  return Array.from(out);
}

// === 所有資格（qualifications.json）用：正式ラベルからID配列を引く ===
// 仕様：まず「ラベルそのもの」の厳密一致のみを最優先（単一IDで返す）。
//       見つからない場合のみ、別名や部分一致にフォールバックして最も近い1件に絞る。
function getIdsForOfficialLicense(label = "") {
  if (!label) return [];

  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) => String(s || "").trim().toLowerCase()
    .replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～!?！？。、，．・]/g, "");
  const normalize = (s) => scrub(toHW(toFW(s)));

  // 1) 「ラベルそのもの」だけで厳密一致（全角/半角ゆらぎは見るが、ここではエイリアスは見ない）
  const exactByLabel =
      licenseTagIdByName.get(label)
   || licenseTagIdByName.get(toFW(label))
   || licenseTagIdByName.get(toHW(label));
  if (exactByLabel != null) return [exactByLabel];

  // 2) ここからフォールバック：ラベル＋その別名を候補語にして、最も近い1件に絞る
  const needleSet = new Set([label, toFW(label), toHW(label)]);
  for (const [alias, labels] of licenseMap.entries()) {
    if (Array.isArray(labels) && labels.includes(label)) {
      needleSet.add(alias);
      needleSet.add(toFW(alias));
      needleSet.add(toHW(alias));
    }
  }

  // 2-1) 候補語での厳密一致が複数出たら、「候補名の正規名称」と元ラベルの近さで1件に絞る
  const exactCandidates = [];
  for (const n of needleSet) {
    const id = licenseTagIdByName.get(n);
    if (id != null) {
      const name = licenseTagNameById.get(id) || "";
      exactCandidates.push({ id, name });
    }
  }
  if (exactCandidates.length) {
    exactCandidates.sort((a, b) =>
      scoreSimilarity(normalize(b.name), normalize(label)) -
      scoreSimilarity(normalize(a.name), normalize(label))
    );
    return [exactCandidates[0].id];
  }

  // 2-2) それでも無ければ、qualifications.json 全体を双方向部分一致で探索し、最も近い1件
  const needles = Array.from(needleSet).map(normalize).filter(Boolean);
  let best = null;
  for (const t of (Array.isArray(licenseTagList) ? licenseTagList : [])) {
    const name = String(t?.name ?? "");
    if (!name || t?.id == null) continue;
    const nt = normalize(name);
    const hit = needles.some(nd => nt.includes(nd) || nd.includes(nt));
    if (!hit) continue;
    const sim = scoreSimilarity(nt, normalize(label));
  if (!best || sim > best.sim) best = { id: t.id, sim };
  }
  return best ? [best.id] : [];
} 
