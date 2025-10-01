// ほーぷちゃん：会話ロジック（Step厳密・深掘り2回・候補提示・ステータス算出）
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
  tagList = Array.isArray(raw?.tags) ? raw.tags : (Array.isArray(raw) ? raw : []);
} catch (e) {
  console.error("tags.json 読み込み失敗:", e);
  tagList = [];
}
let licenses = {};
try {
  licenses = require("../../licenses.json");
} catch (e) {
  console.error("licenses.json 読み込み失敗:", e);
  licenses = {};
}

let licenseTagList = [];
try {
  const raw = require("../../qualifications.json"); 
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

const licenseMap = new Map(); // Map<string, string[]>

try {
  for (const [, arr] of Object.entries(licenses || {})) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const label = typeof item === "string" ? item : item?.label;
      if (!label) continue;

      const put = (alias, l) => {
        if (!alias) return;
        const curr = licenseMap.get(alias) || [];
        if (!curr.includes(l)) curr.push(l);
        licenseMap.set(alias, curr);
      };

      put(label, label);

      const fwLabel = label.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
      const hwLabel = label.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
      put(fwLabel, label);
      put(hwLabel, label);

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

const OFFICIAL_LICENSES = new Set();
try {
  for (const [, arr] of Object.entries(licenses || {})) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const label = typeof item === "string" ? item : item?.label;
      if (label) OFFICIAL_LICENSES.add(label);
    }
  }
  for (const [, labels] of licenseMap.entries()) {
    if (!Array.isArray(labels)) continue;
    for (const l of labels) if (l) OFFICIAL_LICENSES.add(l);
  }
} catch {}

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

function buildAvailableRevMap(available) {
  const idByLabel = new Map(); 
  const labelById = new Map(); 
  const labelsSet = new Set(); 

  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) => String(s || "")
    .toLowerCase()
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/[、。・／\/＿\-–—~～!?！？。，．・]/g, "");
  const norm  = (s) => scrub(toHW(toFW(s)));

  const entries = available && typeof available === "object"
    ? Object.entries(available)
    : [];

  for (const [idRaw, labelRaw] of entries) {
    const id    = String(idRaw); 
    const label = String(labelRaw || ""); 
    if (!label) continue;

    labelById.set(id, label);

    const variants = new Set([label, toFW(label), toHW(label)]);
    for (const v of variants) {
      if (!idByLabel.has(v)) idByLabel.set(v, id);
      const key = norm(v);
      if (key && !idByLabel.has(key)) idByLabel.set(key, id);
    }

    labelsSet.add(label);
  }

  function resolveIdByLabel(inputLabel = "") {
    const raw = String(inputLabel || "");
    if (!raw) return null;
    const key1 = raw;
    const key2 = norm(raw);
    return idByLabel.get(key1) ?? idByLabel.get(key2) ?? null;
  }

  return { idByLabel, labelById, resolveIdByLabel, norm };
}

const serviceFormTagList = (Array.isArray(tagList) ? tagList : []).filter(
  t => t?.category === "サービス形態"
);

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

const ORAL_SURGERY_ID = 41;
const ALLOWED_ORAL_SURGERY_KEYS = ['口腔外科', '歯科口腔外科'].map(norm);
const oralLabel = serviceTagNameById.get(ORAL_SURGERY_ID);
const isAllowedOralSurgeryInput = () => ALLOWED_ORAL_SURGERY_KEYS.includes(norm(raw));

  const out = new Set();

  const byExact =
        serviceTagIdByName.get(raw)
     || serviceTagIdByName.get(toFW(raw))
     || serviceTagIdByName.get(toHW(raw));
  if (byExact != null) {
    const name = serviceTagNameById.get(byExact);
    if (name) out.add(name);
  }

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

  const normalize = s => (s ? norm(s) : '');
  for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
    const name = String(t?.name ?? '');
    if (!name) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(name);
  }

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

if (oralLabel && !isAllowedOralSurgeryInput()) out.delete(oralLabel);

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
const ORAL_SURGERY_ID = 41;
const ALLOWED_ORAL_SURGERY_KEYS = ['口腔外科', '歯科口腔外科'].map(norm);
const isAllowedOralSurgeryInput = () => ALLOWED_ORAL_SURGERY_KEYS.includes(norm(raw));


  const out = new Set();
  const direct =
        serviceTagIdByName.get(raw)
     || serviceTagIdByName.get(toFW(raw))
     || serviceTagIdByName.get(toHW(raw));
  if (direct != null) out.add(direct);

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

  const normalize = s => (s ? norm(s) : '');
  for (const t of (Array.isArray(serviceFormTagList) ? serviceFormTagList : [])) {
    const name = String(t?.name ?? '');
    const id   = t?.id;
    if (!name || id == null) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(id);
  }

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

  if (!isAllowedOralSurgeryInput()) out.delete(ORAL_SURGERY_ID);

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

let reasonMaster = [];
try {
  const raw = require("../../job_change_purposes.json"); 
  if (Array.isArray(raw))              reasonMaster = raw;
  else if (Array.isArray(raw?.items))  reasonMaster = raw.items;
  else if (Array.isArray(raw?.tags))   reasonMaster = raw.tags;
  else                                 reasonMaster = [];
} catch (e) {
  console.error("job_change_purposes.json 読み込み失敗:", e);
  reasonMaster = [];
}

const reasonIdByName = new Map();
const reasonNameById = new Map();
try {
  for (const t of (Array.isArray(reasonMaster) ? reasonMaster : [])) {
    const label = String(t?.tag_label ?? t?.name ?? "");
    const id    = t?.id;
    if (!label || id == null) continue;

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

const REASON_ID_SET = new Set(
  (Array.isArray(reasonMaster) ? reasonMaster : [])
    .map(t => t?.id)
    .filter(v => v != null)
);

const REASON_ID_LABELS = (Array.isArray(reasonMaster) ? reasonMaster : [])
  .map(t => ({ id: t?.id, label: String(t?.tag_label ?? t?.name ?? "") }))
  .filter(x => x.id != null && x.label);

function pickTop3ReasonOptions(userText = "") {
  const t = String(userText || "").toLowerCase();
  const buckets = [
    // 労働時間・シフト系
    { keys: ["残業", "夜勤", "シフト", "オンコール", "当直", "定時"], picked: [] },
    // 給与・待遇系
    { keys: ["給与", "給料", "年収", "月収", "賞与", "ボーナス", "昇給", "待遇"], picked: [] },
    // 通勤・勤務地・働き方動線
    { keys: ["通勤", "近い", "自宅", "直行直帰", "移動", "訪問"], picked: [] },
    // 仕事内容・キャリア
    { keys: ["業務", "負担", "スキル", "成長", "経験", "キャリア", "専門"], picked: [] },
    // 休暇・休み
    { keys: ["休日", "休み", "有給", "連休", "土日"], picked: [] },
    // 人間関係・組織
    { keys: ["人間関係", "上司", "同僚", "雰囲気", "チーム"], picked: [] },
  ];

  const labelPool = REASON_ID_LABELS.map(x => String(x.label || ""));
  const used = new Set();
  const out = [];

  const includesAny = (label, keys) => keys.some(k => label.includes(k));

  for (const b of buckets) {
    for (const label of labelPool) {
      if (out.length >= 3) break;
      if (used.has(label)) continue;
      if (includesAny(label, b.keys)) {
        out.push(label);
        used.add(label);
      }
    }
    if (out.length >= 3) break;
  }

  if (out.length < 3) {
    for (const label of labelPool) {
      if (out.length >= 3) break;
      if (!used.has(label)) {
        out.push(label);
        used.add(label);
      }
    }
  }
  return out.slice(0, 3);
}

const STRICT_REASON_MODE = true;

function _normKeyJP(s=""){
  return String(s||"")
    .toLowerCase()
    .replace(/[ \t\r\n\u3000]/g,"")
    .replace(/[（）\(\)［\]\[\]／\/・,，。．\.\-–—~～!?！？:：]/g,"")
    .replace(/直行直帰できる?/g,"直行直帰") 
    .replace(/職場で働きたい$/,"")
    .replace(/で働きたい$/,"")
    .replace(/がほしい$/,"")
    .replace(/がある$/,"")
    .replace(/できる$/,"")
    .trim();
}
function countCategoryHits(userText = "") {
  const T = _normKeyJP(userText || "");
  if (!T) return 0;
  const CATS = {
    "労働時間・シフト": [
      /夜勤/, /ｵﾝｺｰﾙ|オンコール|当直/, /残業|定時/, /シフト|連勤/, /直行直帰/, /休憩/
    ],
    "仕事内容・キャリア": [
      /業務量|負担|忙しさ|多忙/, /急性期|重症|救急/, /記録|書類|事務/, /成長|経験|スキル|専門/
    ],
    "給与・待遇": [
      /給料|給与|年収|月収|手取り|賞与|ﾎﾞｰﾅｽ|ボーナス|昇給|待遇/, /安い|低い|上がらない/
    ],
    "通勤・勤務地・動線": [
      /通勤|距離|移動|近い|遠い/, /訪問|直行直帰/
    ],
    "休暇・休み": [
      /休日|休み|有給|有休|連休|土日|祝日/
    ],
    "人間関係・組織": [
      /人間関係|上司|同僚|師長|部長|雰囲気|チーム/
    ],
  };

  let hitCats = 0;
  for (const regs of Object.values(CATS)) {
    const matched = regs.some(re => re.test(T));
    if (matched) hitCats++;
  }
  return hitCats; 
}

function extractEvidenceKeysFromLabel(label=""){
  const raw = String(label||"").trim();
  if (!raw) return [];

  let core = raw
    .replace(/の?職場で働きたい$/,"")
    .replace(/が欲しい$/,"")
    .replace(/がほしい$/,"")
    .replace(/があると良い$/,"")
    .replace(/がある$/,"")
    .replace(/(を)?重視したい$/,"")
    .replace(/を避けたい$/,"")
    .replace(/したい$/,"")
    .trim();

  const keys = new Set();
  if (core) keys.add(core);

  const parts = core.split(/[・／\/、]/g).map(s=>s.trim()).filter(Boolean);
  for (const p of parts) {
    if (p.length >= 2) keys.add(p);
  }

  const stop = new Set(["職場","環境","体制","制度","条件","勤務","働き方","理解","機会","基準","評価","残業時間"]);
  for (const k of Array.from(keys)) {
    const clean = k.replace(/(な|に|を|が|と|も|の)$/,"");
    if (!stop.has(clean)) keys.add(clean);
  }

  const expanded = new Set();
  for (const k of keys) {
    expanded.add(k);
    expanded.add(_normKeyJP(k));
  }

  const txt = core;
  if (/近い|自宅|家/.test(txt)) { expanded.add("近い"); expanded.add("自宅から近い"); expanded.add("家から近い"); }
  if (/残業/.test(txt)) { expanded.add("残業"); }
  if (/有給|有休/.test(txt)) { expanded.add("有給"); expanded.add("有休"); }
  if (/夜勤/.test(txt)) { expanded.add("夜勤"); }
  if (/直行直帰/.test(txt)) { expanded.add("直行直帰"); }

  return Array.from(expanded).filter(k => String(k||"").trim().length >= 2);
}

function gateCandidatesByEvidence(cands = [], userText = ""){
  if (!STRICT_REASON_MODE) return cands || [];
  const T = _normKeyJP(userText || "");
  if (!T) return [];

  const passed = [];
  for (const c of (Array.isArray(cands) ? cands : [])) {
    const label = reasonNameById.get(c.id) || "";
    const keys = extractEvidenceKeysFromLabel(label);
    const ok = keys.some(k => {
      const nk = _normKeyJP(k);
      return (k && userText.includes(k)) || (nk && T.includes(nk));
    });
    if (ok) passed.push(c);
  }
  return passed;
}

function _extractJsonBlock(s = "") {
  const t = String(s || "");
  const code = t.match(/```json\s*([\s\S]*?)```/i)?.[1]
            || t.match(/```[\s\S]*?```/i)?.[0]?.replace(/```/g, "")
            || null;
  const raw = code || t;
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const slice = raw.slice(i, j + 1);
    try { return JSON.parse(slice); } catch {}
  }
  try { return JSON.parse(raw); } catch {}
  return null;
}

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

async function analyzeReasonWithLLM(userText = "", s, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { empathy: "", paraphrase: "", suggested_question: "", candidates: [] };

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });

  const role    = s?.status?.role || "未入力";
  const place   = s?.status?.place || "未入力";
  const recent  = Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3).join(" / ") : "";
  const lastAsk = s?.drill?.flags?.last_ask || "";
  const forceNew = !!opts.forceNewAngle;

  const system = [
  "あなたは日本語で自然に寄り添うキャリアエージェントAI。",
  "出力は必ずJSONのみ。前置きや説明は書かない。",
  "- empathy は質問禁止。句点（。）で終わる平叙文で1〜2文。",
  "- ask_next は直前と同義不可。改善や解決の方法を問う表現（例：どうしたら〜できる、どんな工夫、方法・手段・対策・コツ・やり方）は意図ごと全面禁止。",
  "- 切り口は前回と変えること（仕事内容／人間関係／労働時間／待遇・制度／評価・成長 など）。",
  "- 明示語のない推測・言い換えは禁止。候補は発話に直接現れた語句に対応するものだけを出す（例：『通勤が遠い』だけで『直行直帰』は出さない）。",
  "- 根拠のない人間関係への誘導を禁止。boss_issue 等の根拠語が無い限り、人間関係は選ばない。",
  "- 評価制度を切り口にするのは『評価』『査定』『昇給』『等級』『人事考課』等の根拠語がある場合だけ。",
  "- 『在宅』は原則として訪問系（訪問看護／訪問介護／在宅医療）の文脈として解釈し、『在宅勤務／リモート／テレワーク』等がある場合のみ勤務形態として扱う。",
  "- ask_next は【カテゴリ知識】の angles に沿って、user_text / recent_texts に現れた語の根拠があるカテゴリから1つだけ選ぶ。"
].join("\n");

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
      "empathy": "2〜3文／100字程度。疑問・質問・問いかけで終わらせない。命令・説教・決めつけNG。常体〜口語ベース（です・ます調は使わない）。",
      "paraphrase": "保存用の短い言い換え（30字以内・評価語は避ける）",
      "candidates": [{"id": 数値（上のidのみ）, "confidence": 0〜1}],
      "ask_next": "次の一言（<=80字）。必ず疑問文で、原因・主体・結果の特定に限定。改善・解決の方法を問う表現は禁止。直前と同義不可"
    }`,
    `last_ask: 「${s.drill?.flags?.last_ask || ""}」`,
    `history_summary: 「${s.drill?.flags?.last_llm_summary || ""}」`
  ].join("\n");

  try {
    const rsp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ]
    });

    const txt = rsp?.choices?.[0]?.message?.content || "";
    const obj = _extractJsonBlock(txt);
    return _sanitizeReasonLLM(obj);
  } catch {
    return { empathy: "", paraphrase: "", suggested_question: "", candidates: [] };
  }
}

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

function decideReasonFromCandidates(cands = []) {
  const top = cands?.[0], second = cands?.[1];
  if (!top) return { status: "uncertain" };
  const gap = second ? (top.confidence - second.confidence) : Infinity;
  if (top.confidence >= 0.85 && gap >= 0.10) {
    return { status: "confirm", id: top.id };
  }
  const options = (cands || []).slice(0, 3).map(c => reasonNameById.get(c.id)).filter(Boolean);
  return options.length ? { status: "ambiguous", options } : { status: "uncertain" };
}

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

const GENERIC_REASON_Q = {
  deep1: [
    "一番ストレスだったのは、仕事内容・人間関係・労働時間のどれに近い？できれば具体例があれば教えて！",
  ],
  deep2: [
    "それはいつ頃から続いてる？改善の見込みはなさそう？もう少し詳しく教えて！",
  ],
};

function detectSalaryIssue(text=""){
  return /(給料|給与|年収|月収|手取り|ボーナス|賞与|昇給|お金|安い|低い|上がらない)/i.test(String(text||""));
}
function isPeerComparisonSalary(text=""){
  return /(周り|同僚|友達|同年代|先輩|他(社|院|施設)|相場|平均|求人|市場|みんな|世間|一般)/i.test(String(text||""));
}
function isValueMismatchSalary(text=""){
  return /(見合わない|割に合わない|評価|人事考課|等級|査定|フィードバック|昇給|昇格|不公平|公平|基準|成果|反映)/i.test(String(text||""));
}

const sessions = Object.create(null);
function initSession() {
  return {
    step: 1,
    isNumberConfirmed: false,
    drill: { phase: null, count: 0, category: null, awaitingChoice: false, options: [], reasonBuf: [], flags: {} },
    status: {
      number: "",
      role: "",
      role_ids: [],   
      place: "",
      place_ids: [],     
      place_id: null,   
      reason: "",
      reason_tag: "",
      reason_ids: [],

      must_ng: [],  
      must_have: [],    
      must_ng_ids: [],   
      must_have_ids: [],  

      want_text: "",
      can: "",
      will: "",

      licenses: [],

      memo: {
        role_raw: "",
        reason_raw: "",
        must_ng_raw: [],  
        must_have_raw: [],  
      },
    },
  };
}

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

var text = "";
var idDigits = "";
var looksId = false;

try {
  const { message = "" } = safeBody; 
  text = String(message || "").trim();

  idDigits = String(text || "").replace(/\D/g, ""); 
  looksId = idDigits.length >= 10 && idDigits.length <= 20;

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
if (!s.drill.awaitingChoice) {
  s.status.memo.role_raw = text || "";
}
  if (s.drill.phase === "license" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
   let chosen = s.drill.options.find(o => o === pick);
   if (!chosen) {
   const resolved = matchLicensesInText(pick);
   if (resolved.length) {
   chosen = resolved.find(label => s.drill.options.includes(label)) || null;
  }
}
    if (chosen) {
  s.status.role = chosen;
  s.status.licenses = [chosen];
  s.status.role_ids = [];
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
    return res.json(withMeta({
      response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 2));
  }

  const found = matchLicensesInText(text); 
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
  if (s.drill.phase === "place" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    let chosen = s.drill.options.find(o => o === pick);

    if (!chosen) {
      const toFW = (x) => x.replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
      const toHW = (x) => x.replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
      const normalize = (x) => toHW(toFW(String(x||""))).replace(/[ \t\r\n\u3000]/g,"");
      chosen = s.drill.options.find(o => normalize(o) === normalize(pick)) || null;
    }

    if (chosen) {
      s.status.place = chosen;

      const id =
            serviceTagIdByName.get(chosen)
         || serviceTagIdByName.get(chosen.replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～'))
         || serviceTagIdByName.get(chosen.replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~'));

      if (id != null) {
        s.status.place_ids = [id];
        s.status.place_id  = id; 
        const official = serviceTagNameById.get(id);
        if (official) s.status.place = official;
      } else {
      
        const ids = matchServiceTagIdsInText(chosen);
        if (Array.isArray(ids) && ids.length) {
          s.status.place_ids = [ids[0]];
          s.status.place_id  = ids[0]; 
          const official = serviceTagNameById.get(ids[0]);
          if (official) s.status.place = official;
        } else {

          s.status.place_ids = [];
          s.status.place_id  = null; 
        }
      }

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
        response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ🤖",
        step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    return res.json(withMeta({
      response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }

const foundLabels = matchServicePlacesInText(text);
const raw = String(text || "").trim();

const toFW = (x) => x.replace(/\(/g,'（').replace(/\)/g,'）').replace(/~/g,'～');
const toHW = (x) => x.replace(/（/g,'(').replace(/）/g,')').replace(/～/g,'~');
const normalize = (x) => toHW(toFW(String(x||""))).replace(/[ \t\r\n\u3000]/g,"");
const exact = foundLabels.find(l => normalize(l) === normalize(raw));

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
    if (official) s.status.place = official;
  } else {
    const ids = matchServiceTagIdsInText(label); 
    if (Array.isArray(ids) && ids.length) {
      s.status.place_ids = [ids[0]];
      s.status.place_id  = ids[0]; 
      const official = serviceTagNameById.get(ids[0]);
      if (official) s.status.place = official;
    } else {
      s.status.place_ids = [];
      s.status.place_id  = null;  
  }
 }
 
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
    response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ🤖",
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
};

if (exact) {
  return finalize(exact);
}
if (foundLabels.length === 1) {
  return finalize(foundLabels[0]);
}
if (foundLabels.length >= 2) {
  const options = foundLabels.slice(0, 6);
  s.drill.phase = "place";
  s.drill.awaitingChoice = true;
  s.drill.options = options;
  return res.json(withMeta({
    response: `どれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`,
    step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 3));
}

s.status.place = raw;
s.status.place_ids = []; 
s.status.place_id  = null;

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
  response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ🤖",
  step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
}, 4)); 
}

 // ---- Step4：転職理由（LLM主導：共感＋要約＋ID候補＋次の深掘り） ----
if (s.step === 4) {

if (s.drill.phase === "reason-category-choice" && s.drill.awaitingChoice && Array.isArray(s.drill.options) && s.drill.options.length) {
  const pick = normalizePick(text);
  const chosen = s.drill.options.find(o => o === pick);

  if (chosen) {
    s.drill.category = chosen;
    s.drill.awaitingChoice = false;

    const basis = Array.isArray(s?.drill?.reasonBuf) && s.drill.reasonBuf.length
      ? s.drill.reasonBuf.slice(-3).join(" / ")
      : (s.status.memo?.reason_raw || "");

    const llm1 = await analyzeReasonWithLLM(basis, s);
    const empathy = (llm1?.empathy && llm1.empathy.trim()) || await generateEmpathy(text, s);

    let nextQ = (llm1?.suggested_question && llm1.suggested_question.trim()) || "もう少しだけ詳しく教えて！";

    if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
      const redo = await analyzeReasonWithLLM(basis, s, { forceNewAngle: true });
      const altQ = redo?.suggested_question || "";
      if (altQ && !isSamePrompt(altQ, s.drill?.flags?.last_ask || "")) {
        nextQ = altQ;
      } else {
        const alts = [
          "直近で一番つらかった具体的な場面は？",
          "その中で“絶対に避けたいこと”を一つ挙げると？",
          "改善されると一気に楽になるポイントはどこ？"
        ];
        nextQ = alts[(s.drill?.count ?? 0) % alts.length];
      }
    }

    s.drill.count = 1;
    s.drill.phase = "reason-llm-ask2";
    s.drill.flags.last_llm_candidates = llm1?.candidates || [];
    s.drill.flags.last_llm_summary    = llm1?.paraphrase || "";
    s.drill.flags.last_ask            = nextQ || "";

    return res.json(withMeta({
      response: nextQ ? joinEmp(empathy, nextQ) : empathy,
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  return res.json(withMeta({
    response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

  if (s.drill.phase === "salary-triage" && s.drill.awaitingChoice) {
    s.drill.reasonBuf.push(text || "");

    if (isPeerComparisonSalary(text)) {
      s.status.reason_tag = "";
      s.status.reason_ids = [];
      resetDrill(s);
      s.step = 5;

      const emp = await generateEmpathy(text, s);
      const msg = "収入アップが主目的ってこと、把握したよ。担当エージェントに共有するね。";
      return res.json(withMeta({
        response: joinEmp(emp, `${msg}\n\n${mustIntroText()}`),

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

    s.drill.awaitingChoice = false;
    s.drill.count = 1;
  }

  if (s.drill.phase === "private-confirm" && s.drill.awaitingChoice) {
    if (isYes(text)) {
      const tag = "家庭との両立に理解のある職場で働きたい";
      s.status.reason_tag = tag;
      const rid = reasonIdByName.get(tag);
      s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
      resetDrill(s);
      s.step = 5;
      return res.json(withMeta({
        response: `今回の転職理由は『${tag}』ってところが大きそうだね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }
    s.drill.flags.privateDeclined = true;
    resetDrill(s);
    s.status.reason_tag = "";
    s.status.reason_ids = [];
    s.step = 5;

    const emp0 = await generateEmpathy(text, s);
    const fixed = "無理なく働ける職場を考えていこうね。";
    return res.json(withMeta({
      response: joinEmp(emp0, `${fixed}\n\n${mustIntroText()}`),
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

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
      return res.json(withMeta({
        response: joinEmp(emp, `今回の転職理由は『${chosen}』ってところが大きそうだね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`),
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }
   
    return res.json(withMeta({
      response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  if (s.drill.count === 0) {
    s.status.reason = text || "";
    s.status.memo.reason_raw = text || "";
    s.drill.reasonBuf = [text || ""];

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

const llm1 = await analyzeReasonWithLLM(text, s);
const empathyRaw = (llm1?.empathy && llm1.empathy.trim()) || await generateEmpathy(text, s);
let nextQ = (llm1?.suggested_question && llm1.suggested_question.trim())
  || "一番ひっかかる点はどこか、もう少しだけ教えてね。";

const catHits = countCategoryHits(text);
if (catHits === 0) {
  const options = ["人間関係", "労働条件", "仕事内容・キャリア"];
  s.drill.phase = "reason-category-choice";
  s.drill.awaitingChoice = true;
  s.drill.options = options;
  s.drill.count = 0;

  return res.json(withMeta({
    response: joinEmp(empathyRaw, `どれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`),
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

{
  const joinedBuf = (s.drill?.reasonBuf || [text || ""]).join(" ");
  if (isHumanRelationPrompt(nextQ) && !hasBossIssueHint(joinedBuf)) {
    nextQ = pickAngleFallback(joinedBuf, "人間関係");
  }
}

    if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
 
  const basis = Array.isArray(s?.drill?.reasonBuf) && s.drill.reasonBuf.length
    ? s.drill.reasonBuf.slice(-3).join(" / ")
    : (text || "");
  const redo = await analyzeReasonWithLLM(basis, s, { forceNewAngle: true });
  const altQ = redo?.suggested_question || "";

  if (altQ && !isSamePrompt(altQ, s.drill?.flags?.last_ask || "")) {
    nextQ = altQ;
  } else {
    const alts = [
      "直近で一番つらかった具体的な場面は？",
      "その中で“絶対に避けたいこと”を一つ挙げると？",
      "改善されると一気に楽になるポイントはどこ？"
    ];
    nextQ = alts[(s.drill?.count ?? 0) % alts.length];
  }
}
    s.drill.count = 1;
    s.drill.phase = "reason-llm-ask2";
    s.drill.awaitingChoice = false;

    // 内部用メモ（返却しない）
    s.drill.flags.last_llm_candidates = llm1?.candidates || [];
    s.drill.flags.last_llm_summary    = llm1?.paraphrase || "";
    s.drill.flags.last_ask            = nextQ || "";

    return res.json(withMeta({
      response: nextQ ? joinEmp(empathyRaw, nextQ) : empathyRaw,
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  if (s.drill.count === 1) {
    s.drill.reasonBuf.push(text || "");
    const joined = s.drill.reasonBuf.join(" ");
    const llm2 = await analyzeReasonWithLLM(joined, s);

const filtered2 = gateCandidatesByEvidence(llm2?.candidates || [], joined);
llm2.candidates = filtered2;

const empathy2 = llm2?.empathy || await generateEmpathy(text, s);
const decision = decideReasonFromCandidates(filtered2);

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

{
  const joinedBuf = (s.drill?.reasonBuf || [text || ""]).join(" ");
  if (isHumanRelationPrompt(nextQ) && !hasBossIssueHint(joinedBuf)) {
    nextQ = pickAngleFallback(joinedBuf, "人間関係");
  }
}  
      if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {

  const basis = Array.isArray(s?.drill?.reasonBuf) && s.drill.reasonBuf.length
    ? s.drill.reasonBuf.slice(-3).join(" / ")
    : (text || "");
  const redo = await analyzeReasonWithLLM(basis, s, { forceNewAngle: true });
  const altQ = redo?.suggested_question || "";

  if (altQ && !isSamePrompt(altQ, s.drill?.flags?.last_ask || "")) {
    nextQ = altQ;
  } else {
    const alts = [
      "直近で一番つらかった具体的な場面は？",
      "その中で“絶対に避けたいこと”を一つ挙げると？",
      "改善されると一気に楽になるポイントはどこ？"
    ];
    nextQ = alts[(s.drill?.count ?? 0) % alts.length];
  }
}

      s.drill.count = 2;
      s.drill.phase = "reason-llm-ask3";
      s.drill.awaitingChoice = false;
      s.drill.flags.last_llm_candidates = llm2?.candidates || [];
      s.drill.flags.last_llm_summary    = llm2?.paraphrase || "";
      s.drill.flags.last_ask            = nextQ || "";

      return res.json(withMeta({
        response: nextQ ? joinEmp(empathy2, nextQ) : empathy2,
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }
      
      let nextQ = llm2?.suggested_question || "一番の根っこは何か、言葉にしてみてね。";

{
  const joinedBuf = (s.drill?.reasonBuf || [text || ""]).join(" ");
  if (isHumanRelationPrompt(nextQ) && !hasBossIssueHint(joinedBuf)) {
    nextQ = pickAngleFallback(joinedBuf, "人間関係");
  }
}     
      if (isSamePrompt(nextQ, s.drill?.flags?.last_ask || "")) {
  const basis = Array.isArray(s?.drill?.reasonBuf) && s.drill.reasonBuf.length
    ? s.drill.reasonBuf.slice(-3).join(" / ")
    : (text || "");
  const redo = await analyzeReasonWithLLM(basis, s, { forceNewAngle: true });
  const altQ = redo?.suggested_question || "";

  if (altQ && !isSamePrompt(altQ, s.drill?.flags?.last_ask || "")) {
    nextQ = altQ;
  } else {
    const alts = [
      "直近で一番つらかった具体的な場面は？",
      "その中で“絶対に避けたいこと”を一つ挙げると？",
      "改善されると一気に楽になるポイントはどこ？"
    ];
    nextQ = alts[(s.drill?.count ?? 0) % alts.length];
  }
}
      s.drill.count = 2;
      s.drill.phase = "reason-llm-ask3";
      s.drill.awaitingChoice = false;
      s.drill.flags.last_llm_candidates = llm2?.candidates || [];
      s.drill.flags.last_ask = nextQ || "";

      return res.json(withMeta({
        response: nextQ ? joinEmp(empathy2, nextQ) : empathy2,
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

  if (s.drill.count === 2) {
    s.drill.reasonBuf.push(text || "");
    const joined = s.drill.reasonBuf.join(" ");
    const llm3 = await analyzeReasonWithLLM(joined, s);

const filtered3 = gateCandidatesByEvidence(llm3?.candidates || [], joined);
llm3.candidates = filtered3;

const empathy3 = llm3?.empathy || await generateEmpathy(text, s);
const decision = decideReasonFromCandidates(filtered3);

    if (decision.status === "confirm") {
      const id = decision.id;
      const label = reasonNameById.get(id) || "";
      s.status.reason_tag = label;
      s.status.reason_ids = [id];
      resetDrill(s);
      s.step = 5;
      return res.json(withMeta({
        response: joinEmp(empathy3, `今回の転職理由は『${label}』ってところが大きそうだね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`),
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }

    const options = (decision.status === "ambiguous" ? decision.options : [])
      .filter(Boolean)
      .slice(0, 3);

    if (options.length) {
      s.drill.phase = "reason-llm-choice";
      s.drill.awaitingChoice = true;
      s.drill.options = options;

      return res.json(withMeta({
        response: joinEmp(empathy3, `この中だとどれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`),
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    const p1 = String(llm3?.paraphrase || "").trim();
    const p2 = String(s.drill?.flags?.last_llm_summary || "").trim();
    const p3 = String(joined || "").slice(0, 30);
    const finalParaphrase = (p1 || p2 || p3) || "理由（テキスト）";

    s.status.reason_tag = finalParaphrase;
    s.status.reason_ids = [];
    resetDrill(s);
    s.step = 5;

    return res.json(withMeta({
      response: joinEmp(empathy3, mustIntroText()),
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  } 

  const empF = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empF, "もう少しだけ詳しく教えて！"),
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
} 

  // ---- Step5：絶対NG（Must NG） ----
if (s.step === 5) {
  if (isNone(text)) {
    s.step = 6;
    return res.json(withMeta({
      response: "次は【これだけは絶対ないと困る！】という条件を教えてね。\n「賞与がないと困る！」\n「絶対土日休みがいい！」\nって感じ。1個じゃなくてもOKだよ！",
      step: 6, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s),
    }, 6));
  }

  const { decideStep56, loadAvailablePurposes } = await import("../../lib/decideStep56.js");
  const dec = await decideStep56({
    userText: text,
    mode: "must_ng",
    recentTexts: Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3) : [],
    role: s?.status?.role || "",
    place: s?.status?.place || "",
    turnIndex: (s?.drill?.count ?? 0),
  });

  const emp = await generateEmpathy(text || "", s);
  const available = loadAvailablePurposes();
  const picked = [];
  if (Array.isArray(dec?.candidates)) {
    for (const c of dec.candidates.slice(0, 3)) {
      const idStr = String(c?.id ?? "");
      const label = available[idStr];
      if (label) {
        const idNum = Number(idStr);
        if (!s.status.must_ng_ids.includes(idNum)) s.status.must_ng_ids.push(idNum);
        if (!s.status.must_ng.includes(label))     s.status.must_ng.push(label);
        picked.push(label);
      }
    }
  }

  if (dec?.unmatched_title) {
    s.status.memo.must_ng_raw ??= [];
    s.status.memo.must_ng_raw.push(dec.unmatched_title);
  }

  const tail = "他にも『これは絶対ダメ！』はある？（なければ「ない」と返してね）";
  const head = picked.length ? `OK！『${picked.join("』『")}』だね。担当エージェントに共有するね。` : "";
  return res.json(withMeta({
    response: joinEmp(emp, [head, tail].filter(Boolean).join("\n")),
    step: 5, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 5));
}

 // ---- Step6：絶対欲しい（Must Have） ----
if (s.step === 6) {
  if (isNone(text)) {
    s.step = 7;
    return res.json(withMeta({
      response: "次は【これがあったら（なかったら）嬉しいな】という条件を教えてね。\n自由に回答してね！",
      step: 7, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 7));
  }

  const { decideStep56, loadAvailablePurposes } = await import("../../lib/decideStep56.js");
  const dec = await decideStep56({
    userText: text,
    mode: "must_have",
    recentTexts: Array.isArray(s?.drill?.reasonBuf) ? s.drill.reasonBuf.slice(-3) : [],
    role: s?.status?.role || "",
    place: s?.status?.place || "",
    turnIndex: (s?.drill?.count ?? 0),
  });

  const emp = await generateEmpathy(text || "", s);
  const available = loadAvailablePurposes();
  const picked = [];
  if (Array.isArray(dec?.candidates)) {
    for (const c of dec.candidates.slice(0, 3)) {
      const idStr = String(c?.id ?? "");
      const label = available[idStr];
      if (label) {
        const idNum = Number(idStr);
        if (!s.status.must_have_ids.includes(idNum)) s.status.must_have_ids.push(idNum);
        if (!s.status.must_have.includes(label))     s.status.must_have.push(label);
        picked.push(label);
      }
    }
  }

  if (dec?.unmatched_title) {
    s.status.memo.must_have_raw ??= [];
    s.status.memo.must_have_raw.push(dec.unmatched_title);
  }

  const tail = "他にも『これは必須でほしい！』はある？（なければ「ない」と返してね）";
  const head = picked.length ? `『${picked.join("』『")}』も担当エージェントに共有するね！` : "";
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

  return res.json(withMeta({
    response: "（内部エラー）",
    step: s.step,
    status: s.status,
    isNumberConfirmed: s.isNumberConfirmed,
    candidateNumber: s.status.number,
    debug: debugState(s)
  }, s.step));
}
 

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
      "命令・説教・断定の押し付けは禁止。",
      "文体ルール：『です・ます調』や敬語の終止は禁止（常体寄りの素直な口語）。",
      "共感文は必ず 2〜3文／100字程度。",
      "質問文を作らない。疑問符（？/?) を含めない。句点（。）で終える。"
    ].join("\\n");

    const user = [
      `直近の発話: ${recent || "なし"}`,
      `職種: ${role || "未入力"}`,
      `現職: ${place || "未入力"}`,
      `カテゴリ: ${cat || "未確定"}`,
      "",
      `今回の発話: ${userText || "（内容なし）"}`,
      "",
      "避ける言い回し例: ありがとう ありがとうございます 大切 寄り添う わかる そうだよね 安心して 頑張ろう 大丈夫 受け止めた 整理しよう 〜です 〜ます 〜でしょう 〜ですね 〜ですよね"
    ].join("\\n");

    const rsp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
    });

    let txt = rsp?.choices?.[0]?.message?.content?.trim() || "";
    txt = txt.replace(/\"/g, "")
             .replace(/\s+\n/g, "\n")
             .replace(/\n{3,}/g, "\n\n")
             .trim();

    const sentences = txt
      .split(/(?<=[。．！!？?])\s*/).filter(Boolean)
      .map(s => s.trim());

    const RE_QUESTION_MARK = /[？?]\s*$/;
    const RE_QUESTION_WORD = /(どれ|どの|どっち|どんな|どう|なに|何|なぜ|いつ|どこ|理由|教えて|聞かせて)/;
    const RE_REQUEST       = /(ください|下さい|お願い|お願いします|おしえて|教えて|伝えて|記入して|回答して|返答して|詳しく|具体的に)/;
    const RE_IMPERATIVE    = /(して(?:ほしい|欲しい)|してください|してね|しよう|しましょう|してみよう|しなさい)/;
    const RE_SUGGEST       = /(～?するといい|すると良い|だといい|だと良い|できるといい|できると良い|のほうがいい|の方がいい|が良さそう|がいいと思う|あるといい|あると良い)/;
    const RE_LEADING       = /(一言で|一語で|教えて|挙げて|示して|書いて|答えて|共有して)/;

    const isProbingLike = (s) => {
      const t = String(s || "").trim();
      if (!t) return false;
      return RE_QUESTION_MARK.test(t)
          || RE_QUESTION_WORD.test(t)
          || RE_REQUEST.test(t)
          || RE_IMPERATIVE.test(t)
          || RE_SUGGEST.test(t)
          || RE_LEADING.test(t);
    };

    let kept = sentences.filter(s => !isProbingLike(s));

    if (kept.length === 0 && sentences.length) {
      kept = sentences.map(s => s
        .replace(RE_QUESTION_MARK, "")
        .replace(RE_REQUEST, "")
        .replace(RE_IMPERATIVE, "")
        .replace(RE_SUGGEST, "")
        .replace(RE_LEADING, "")
        .trim()
      ).filter(Boolean);
    }

    let out = kept.map(p => {
      let t = p.replace(/[？?]+$/,"").trim();
      if (!/[。．！!]$/.test(t)) t += "。";
      return t.replace(/．$/, "。");
    }).filter(Boolean).join("").replace(/。。+/g, "。").trim();

    if (out.length > 180) {
      const sents = out.split(/(?<=。|！|!)/).filter(Boolean);
      out = sents.slice(0, 3).join("").trim();
      if (out.length > 180) out = out.slice(0, 178) + "。";
    }

    if (!out) out = fallback;
    return out;
  } catch (e) {  
    return fallback; 
  }
}

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
  return !(s && s.drill && s.drill.flags && s.drill.flags.privateDeclined);
}

function hasOncallNight(text = "") {
  return /(オンコール|ｵﾝｺｰﾙ|夜勤)/i.test(String(text || ""));
}
function isYes(text = "") {
  return /^(はい|うん|そう|ok|了解|そのとおり|そんな感じ|お願いします|それで|求めてる)/i.test(String(text || "").trim());
}

function enforcePlainEnding(text = '') {
  let t = String(text).trim();
  if (!t) return t;

  t = t.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  if (!/[。！？!？＞）)\]]$/.test(t)) t += '。';
  return t;
}

function joinEmp(a, b) {
  const emp = String(a || "").trim();
  const q   = String(b || "").trim();
  return q ? `${emp}\n\n${q}` : emp;
}

function isSamePrompt(a, b){
  const norm = s => String(s || "")
    .toLowerCase()
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/[。、，・…\.]/g, "")
    .replace(/[「」『』（）()［］\[\]\{\}~～]/g, "")
    .replace(/[！？!？?]/g, "");
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  return A === B || A.includes(B) || B.includes(A);
}

function isHumanRelationPrompt(s){
  const t = String(s || "");
  return /(人間関係|職場の雰囲気|上司|先輩|同僚|チームワーク)/.test(t);
}
function hasBossIssueHint(text=""){
  const t = String(text || "");
  return /(上司|管理者|師長|部長|課長|リーダー|陰口|高圧|マウント|パワハラ|理不尽)/.test(t);
}

function pickAngleFallback(buf="", excludeCategory=""){
  const t = String(buf || "");

  if (/(動物|アレルギ|花粉|体質|喘息)/.test(t)) return "環境や業務で避けたい条件って何だろう。";
  if (/(夜勤|夜番|オンコール|ｵﾝｺｰﾙ|コール番|呼び出し)/i.test(t)) return "勤務条件で一番避けたい点って何だろう。";
  if (/(残業|シフト|連勤|休憩|有給|直行直帰|朝礼|日報|定時)/.test(t)) return "それって時間面？制度面？";
  if (/(評価|昇給|昇格|査定|反映|不公平|公平|基準)/.test(t)) return "どこが特に気になるかな。";
  if (/(通勤|距離|移動|直行|直帰|訪問)/.test(t)) return "特に気になっていることを教えて欲しいな。";

  if (excludeCategory === "人間関係") {
    return "直近でそう思った出来事があれば教えて欲しいな。";
  }
  return "一番気になっている条件を教えて！";
}

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
    mustCount: (s.status.must_ng || []).length, 
    wantCount: (s.status.want_text || "").length, 
  };
} 

function nextAfterId(s) {
  switch (s.step) {
    case 2:
      return "IDは確認済だよ！次に【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など";
    case 3:
      return "IDは確認済だよ！次に【今どこで働いてる？】を教えてね。\n（例）○○病院 外来／△△クリニック";
    case 4:
      return "IDは確認済だよ！\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ🤖";
    default:
      return "IDは確認済だよ！";
  }
}

function mustIntroText() {
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
  const direct =
      tagIdByName.get(raw)
   || tagIdByName.get(toFW(raw))
   || tagIdByName.get(toHW(raw));
  if (direct != null) out.add(direct);

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

  const normalize = (s) => (s ? norm(s) : "");
  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    const id   = t?.id;
    if (!name || id == null) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(id);
  }

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

function quickKeywordsToLabels(text = "", mode = "ng") {
  const t = String(text || "").toLowerCase();

  const out = new Set();

  if (/(ﾎﾞｰﾅｽ|ボーナス|bonus)/.test(t)) out.add("賞与");
  if (/(有給|有休)/.test(t)) out.add("有給消化率ほぼ100%");
  if (/残業|定時|ｻﾋﾞ残|サビ残/.test(t)) {
    out.add("残業0");
    if (mode === "have") out.add("残業月20時間以内");
  }

  return Array.from(out);
}

function mapFreeLabelsToTags(freeLabels = []) {
  const results = [];
  const seenIds = new Set();

  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) =>
    String(s || "").toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g, "");
  const norm = (s) => scrub(toHW(toFW(s)));

  for (const raw of (freeLabels || [])) {
    const q = String(raw || "").trim();
    if (!q) continue;
    let id =
          tagIdByName.get(q)
       || tagIdByName.get(toFW(q))
       || tagIdByName.get(toHW(q));

    if (id == null) {
      const nq = norm(q);
      for (const t of (Array.isArray(tagList) ? tagList : [])) {
        const name = String(t?.name ?? "");
        const tid  = t?.id;
        if (!name || tid == null) continue;
        const nt = norm(name);
        if (!nt) continue;
        if (nq.includes(nt) || nt.includes(nq)) { id = tid; break; }
      }
    }

    if (id == null) {
      let best = null, bestScore = 0;
      for (const t of (Array.isArray(tagList) ? tagList : [])) {
        const name = String(t?.name ?? "");
        const tid  = t?.id;
        if (!name || tid == null) continue;
        const s = scoreSimilarity(name, q);
        if (s > bestScore) { bestScore = s; best = { id: tid, name }; }
      }
      if (best && bestScore >= 0.35) id = best.id;
    }

    if (id != null && !seenIds.has(id)) {
      seenIds.add(id);
      results.push({ id, label: tagNameById.get(id) || String(q) });
    }
  }

  return results; // [{id, label}] 正式IDと正式ラベル（tags.json準拠）
}

function getIdsForOfficialLicense(label = "") {
  if (!label) return [];

  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) => String(s || "").trim().toLowerCase()
    .replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～!?！？。、，．・]/g, "");
  const normalize = (s) => scrub(toHW(toFW(s)));
  const exactByLabel =
      licenseTagIdByName.get(label)
   || licenseTagIdByName.get(toFW(label))
   || licenseTagIdByName.get(toHW(label));
  if (exactByLabel != null) return [exactByLabel];

  const needleSet = new Set([label, toFW(label), toHW(label)]);
  for (const [alias, labels] of licenseMap.entries()) {
    if (Array.isArray(labels) && labels.includes(label)) {
      needleSet.add(alias);
      needleSet.add(toFW(alias));
      needleSet.add(toHW(alias));
    }
  }

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
