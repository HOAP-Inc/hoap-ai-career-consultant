// pages/api/chat.js
// ほーぷちゃん：会話ロジック（Step厳密・深掘り2回・候補提示・ステータス算出）
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

// ←この1行を“この関数の直後”に追加（単数名を呼ばれても動くように）
const matchLicenseInText = matchLicensesInText;

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

// 置き換え：isPositiveMotivation
function isPositiveMotivation(text = "") {
  const t = String(text).toLowerCase();

  // 強いネガ語があればポジ扱いしない
  const neg = /(嫌い|無理|合わない|しんどい|辛い|やめたい|辞めたい|不満|怒|ストレス|いじめ|ハラスメント|パワハラ|セクハラ)/;
  if (neg.test(t)) return false;

  // 前向きワード
  const pos = /(挑戦|やりたい|なりたい|目指(す|して)|スキルアップ|学びたい|成長|キャリア|経験を積みたい|責任|役職|昇進|昇格|資格(を取りたい)?|新しいこと|幅を広げたい)/;
  if (pos.test(t)) return true;

  // 明示的に「管理職になりたい」などはポジ
  if (/(管理(者|職)).*(なりたい|目指|挑戦)/.test(t)) return true;

  return false;
}

// === 追加：発話のポジ/ネガ/中立分類 ===
const POS_TERMS = /(挑戦|やりたい|なりたい|目指(す|して)|スキルアップ|学びたい|成長|キャリア|経験を積みたい|責任|役職|昇進|昇格|資格(を取りたい)?|新しいこと|幅を広げたい)/i;
const NEG_TERMS = /(嫌い|嫌だ|無理|合わない|しんどい|辛い|きつい|やめたい|辞めたい|不満|怒|ストレス|いじめ|ハラスメント|パワハラ|セクハラ|理不尽|圧|支配)/i;
const MGMT_POS  = /(管理(者|職)).*(なりたい|目指|挑戦)/i; // 「管理者になりたい」等を確実にポジ扱い

function isNegativeMotivation(text=""){ 
  return NEG_TERMS.test(String(text)); 
}

function classifyMotivation(text=""){
  const t = String(text);
  const pos = (MGMT_POS.test(t) || POS_TERMS.test(t)) ? 1 : 0;
  const neg = NEG_TERMS.test(t) ? 1 : 0;
  if (pos && !neg) return "pos";
  if (!pos && neg) return "neg";
  if (pos && neg)  return "mixed";
  return "neutral";
}

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

// 追加：上司/管理者×ネガの早期カテゴリ確定
function detectBossRelationIssue(text = "") {
  const t = String(text).toLowerCase();
  const boss = /(管理者|管理職|上司|師長|看護師長|部長|課長|マネージャ|ﾏﾈｰｼﾞｬ|リーダー|院長|園長|同僚|先輩|後輩|スタッフ|看護師(さん)?)/;
const neg  = /(嫌い|嫌だ|無理|合わない|苦手|不満|理不尽|ストレス|パワハラ|セクハラ|陰口|圧|支配|きつい|性格がきつい|高圧)/;
  return boss.test(t) && neg.test(t);
}

// ポジティブ用の汎用深掘り
const GENERIC_REASON_Q_POS = {
  deep1: ["目指している姿や挑戦したいことは何？直近でやってみたい具体例があれば教えて！"],
  deep2: ["実現のために今足りていない経験やスキルはある？どのくらいの期間で動きたい？"],
};

// テキスト全体からカテゴリごとのヒット数を採点
function scoreCategories(text) {
  const t = (text || "").toLowerCase();

  // 「上司/管理者」系キーワードは、ネガ語が同時に出ていない限りスコアに入れない
  const BOSS_KEYWORDS = /(管理者|管理職|上司|師長|看護師長|部長|課長|マネージャ|マネージャー|上層部|リーダー|院長|園長)/i;

  const ranking = [];
  let best = null, hits = 0;

  for (const [cat, def] of Object.entries(transferReasonFlow)) {
    const h = (def.keywords || []).reduce((acc, kw) => {
      const k = String(kw).toLowerCase();
      const hit = t.includes(k);

      // boss系はネガ同伴でのみ加点
      const isBossKw = BOSS_KEYWORDS.test(String(kw));
      const allow = !isBossKw || NEG_TERMS.test(t);

      return acc + (hit && allow ? 1 : 0);
    }, 0);

    ranking.push({ cat, hits: h });
    if (h > hits) {
      hits = h;
      best = cat;
    }
  }

  ranking.sort((a, b) => b.hits - a.hits);
  return { best, hits, ranking };
}

// ---- 転職理由カテゴリ（深掘りQ & 候補） ----
const transferReasonFlow = {
  "経営・組織に関すること": {
    keywords: ["理念","方針","価値観","経営","運営","マネジメント","方向性","ビジョン","ミッション","考え方","姿勢","経営陣","トップ","風通し","意見","発言","評価制度","評価","昇給","昇格","公平","基準","教育体制","研修","マニュアル","OJT","フォロー","教育","サポート","経営者","院長","経営者","社長","代表","現場理解","売上","数字"],
    internal_options: [
      "MVV・経営理念に共感できる職場で働きたい",
      "風通しがよく意見が言いやすい職場で働きたい",
      "評価制度が導入されている職場で働きたい",
      "教育体制が整備されている職場で働きたい",
      "経営者が医療職のところで働きたい",
      "経営者が医療職ではないところで働きたい",
    ],
    deep1: ["経営方針で特に合わないと感じる部分は？","組織の体制で困ってることがある？","評価や教育面で不満がある？"],
    deep2: ["それって改善されそうにない感じ？","他のスタッフも同じように感じてる？","具体的にはどんな場面で一番感じる？"],
  },
  "働く仲間に関すること": {
  keywords: [
    "人間関係","職場の雰囲気","上司","先輩","同僚","チームワーク","いじめ","パワハラ","セクハラ","陰口","派閥","お局","臭い","キモい",
    "理不尽","相談できない","孤立","連携","古株","権力","圧","支配","管理者","管理職","師長","看護師長","部長","課長","リーダー",
    "マネージャ","マネージャー","上層部","院長","園長",
    // 医療現場ならでは
    "ドクターとの関係","医師","ドクター","先生",
    "コメディカル","多職種連携が悪い","ロールモデルがいない",
    "カンファ","カンファレンス","申し送り","詰所","師長面談","委員会","勉強会で詰められる","ケース会議",
    // ★追加要望（見下される/きつい）
    "看護師が見下してくる","先生が見下してくる","医者が見下してくる",
    "見下す","マウント","高圧的",
    "ヘルパーがきつい","介護職がきつい","ヘルパー","介護職"
  ],
  internal_options: [
    "人間関係のトラブルが少ない職場で働きたい",
    "同じ価値観を持つ仲間と働きたい",
    "尊敬できる上司・経営者と働きたい",
    "ロールモデルとなる上司や先輩がほしい",
    "職種関係なく一体感がある仲間と働きたい",
    "お局がいない職場で働きたい",
  ],
  deep1: ["具体的にはどんな人間関係で困ってるの？","上司や先輩との関係？それとも同僚との関係？","職場の雰囲気が悪いってこと？"],
  deep2: ["それって毎日続いてる感じ？","相談できる人はいない状況？","チームワークの面でも困ってることある？"],
},
  "仕事内容・キャリアに関すること": {
  keywords: [
    "仕事内容","業務内容","やりがい","やりたい仕事","スキルアップ","成長","挑戦","キャリア","経験","専門性","研修","教育",
    "昇進","昇格","資格取得","学べる","新しい","幅を広げる","強み","活かす","未経験","役割","役職","裁量","登用","機会",
    // 医療・介護の具体タスク
    "看護記録","SOAP","電子カルテ","記録に追われる","アセスメント","インシデント","ラウンド","受け持ち人数","受け持ち患者",
    "採血","点滴","処置","バイタル","申し送りが長い","件数が多い","訪問件数","ケアプラン","ADL","リハビリ計画",
    "外来対応","病棟業務","訪問看護","訪問リハ","訪問栄養","ST","PT","OT",
    // ★追加要望
    "訪問入浴","入浴介助"
  ],
  internal_options: [
    "今までの経験や自分の強みを活かしたい",
    "未経験の仕事／分野に挑戦したい",
    "スキルアップしたい",
    "患者・利用者への貢献実感を感じられる仕事に携われる",
    "昇進・昇格の機会がある",
  ],
  deep1: ["今の仕事内容で物足りなさを感じてる？","キャリアアップの機会がない？","やりがいを感じられない？"],
  deep2: ["どんな仕事だったらやりがいを感じられそう？","スキルアップの機会が欲しい？","もっと責任のある仕事をしたい？"],
},
  "労働条件に関すること": {
  keywords: [
  "残業","休日","有給","働き方","時間","シフト","勤務時間","連勤","休憩",
  "呼び出し","副業","兼業","社会保険","保険","健保","厚生年金","診療時間",
  "自己研鑽","勉強","学習","研修時間","直行直帰","事務所","立ち寄り","朝礼","日報","定時",
  "サービス残業","申請制","人員配置","希望日","半休","時間有休","承認","就業規則","許可",
  "健康保険","雇用保険","労災","手続き","始業前","準備","清掃","打刻",
],
  internal_options: [
    "直行直帰ができる職場で働きたい",
    "残業のない職場で働きたい",
    "希望通りに有給が取得できる職場で働きたい",
    "副業OKな職場で働きたい",
    "社会保険を完備している職場で働きたい",
    "診療時間内で自己研鑽できる職場で働きたい",
    "前残業のない職場で働きたい",
  ],
  deep1: ["具体的にはどの辺りが一番きつい？","時間的なこと？それとも休みの取りづらさ？","勤務条件で特に困ってることは？"],
  deep2: ["それがずっと続いてる状況？","改善の見込みはなさそう？","他にも労働条件で困ってることある？"],
},
  
  "プライベートに関すること": {
    keywords: ["家庭","介護","育児","子育て","両立","ライフステージ","子ども","家族","介護","保育園","送迎","学校行事","通院","発熱","中抜け","時短","イベント","飲み会","BBQ","社員旅行","早朝清掃","強制","業務外","就業後","休日","オフ","プライベート","仲良く","交流","ごはん","趣味","オンコール","夜勤"],
    internal_options: [
      "家庭との両立に理解のある職場で働きたい",
      "勤務時間外でイベントがない職場で働きたい",
      "プライベートでも仲良くしている職場で働きたい",
    ],
    deep1: ["家庭との両立で困ってることがある？","プライベートの時間が取れない？","職場のイベントが負担？"],
    deep2: ["それって改善の余地はなさそう？","他にも両立で困ってることある？","理想的な働き方はどんな感じ？"],
  },
  "職場環境・設備": { keywords: ["設備","環境","施設","機器","IT","デジタル","古い","新しい","最新","導入","整備"], internal_options: [], deep1: [], deep2: [] },
  "職場の安定性": { keywords: ["安定","将来性","経営状況","倒産","リストラ","不安","継続","持続","成長","発展","先行き"], internal_options: [], deep1: [], deep2: [] },
  "給与・待遇":   { keywords: ["給料","給与","年収","月収","手取り","賞与","ボーナス","昇給","手当","待遇","福利厚生","安い","低い","上がらない","生活できない","お金"], internal_options: [], deep1: [], deep2: [] },
};

// ---- Must/Want 辞書（tag_labelのみ） ----
const mustWantItems = [
  "急性期病棟","回復期病棟","慢性期・療養型病院","一般病院","地域包括ケア病棟","療養病棟",
  "緩和ケア病棟（ホスピス）","クリニック","精神科病院","訪問看護ステーション",
  "精神科特化型訪問看護ステーション","機能強化型訪問看護ステーション","訪問リハビリテーション",
  "訪問栄養指導","通所介護（デイサービス）","認知症対応型通所介護（認知症専門デイサービス）",
  "地域密着型通所介護（定員18名以下）","通所リハビリテーション（デイケア）","訪問介護",
  "定期巡回・随時対応型訪問介護看護","訪問入浴","小規模多機能型居宅介護","看護小規模多機能型居宅介護",
  "特別養護老人ホーム","地域密着型特別養護老人ホーム（定員29名以下）","介護老人保健施設",
  "介護付き有料老人ホーム","ショートステイ（短期入所生活介護）","サービス付き高齢者向け住宅（サ高住）",
  "住宅型有料老人ホーム","軽費老人ホーム（ケアハウス）","健康型有料老人ホーム","シニア向け分譲マンション",
  "放課後等デイサービス","生活介護（障害者の日中活動）","就労継続支援A型","就労継続支援B型",
  "短期入所（障害者向けショートステイ）","歯科クリニック","訪問歯科","歯科口腔外科（病院内診療科）",
  "大学病院歯科・歯学部附属病院","歯科技工所","院内ラボ","保育園","幼稚園",
  "企業（産業保健・企業内看護など）","4週8休","育児支援","年間休日120日以上",
  "週1日からOK","週2日からOK","土日祝休み","家庭都合休","月1シフト提出",
  "毎週～隔週シフト提出","有給消化率ほぼ100%","長期休暇","週休2日","週休3日",
  "日勤","夜勤専従","2交替制","3交替制","午前のみ","午後のみ",
  "残業","オンコール","緊急訪問","時差出勤導入","フレックスタイム制度",
  "残業月20時間以内","スキマ時間勤務","時短勤務相","駅近（5分以内）","車通勤",
  "バイク通勤","自転車通勤","駐車場","直行直帰","年収300万以上","年収350万以上",
  "年収400万以上","年収450万以上","年収500万以上","年収550万以上","年収600万以上",
  "年収650万以上","年収700万以上","賞与","退職金","寮・社宅",
  "託児所・保育支援","社会保険完備","交通費支給","扶養控除内考慮","復職支援",
  "住宅手当","副業","日・祝日給与UP","引越し手当","緊急訪問時の手当・代休",
  "スマホ・タブレット貸与","電動アシスト自転車・バイク・車貸与","社割",
  "ハラスメント相談窓口","研修制度","資格取得支援","セミナー参加費補助",
  "マニュアル完備","動画マニュアル","評価制度","メンター制度","独立・開業支援",
  "院長・分院長候補","担当制"
];

// === Must/Want 抽出の制御パラメータ（STEP4流の中核） ===
// しきい値：弱いファジー一致は候補にしない
const MW_SIM_THRESHOLD = 0.40;

// ラベルごとの「実体アンカー」（この語が発話に含まれない限り候補化しない）
// ※必要に応じて追加でOK（オンコール限定ではなく全体適用）
const MW_ANCHORS = {
  "駅近（5分以内）": /(駅近|駅ﾁｶ|駅チカ|駅から近)/i,
  "時短勤務相談": /(時短|短時間勤務)/i,
  "オンコール": /(オンコール|ｵﾝｺｰﾙ|呼び出し|コール番|ベル)/i,
  "緊急訪問": /(緊急訪問|緊急対応|緊急)/i,
  "残業": /(残業|定時|サービス残業|サビ残|前残業)/i,
  "土日祝休み": /(土日祝.*休|週末.*休|土日.*休)/i,
  "有給消化率ほぼ100%": /(有給|有休).*(取|申請|消化)/i,
  "育児支援": /(育児|保育|託児|子育て|子ども)/i,
  "車通勤": /(車通勤|マイカー通勤)/i,
  "バイク通勤": /(バイク通勤|バイク)/i,
  "自転車通勤": /(自転車通勤|チャリ通)/i,
  "年収300万以上": /(300\s*万)/i,
  "年収350万以上": /(350\s*万)/i,
  "年収400万以上": /(400\s*万)/i,
  "年収450万以上": /(450\s*万)/i,
  "年収500万以上": /(500\s*万)/i,
  "年収550万以上": /(550\s*万)/i,
  "年収600万以上": /(600\s*万)/i,
  "年収650万以上": /(650\s*万)/i,
  "年収700万以上": /(700\s*万)/i,
};

// 排他ロック：同じ系列が複数確定しないよう「グループ内は最高スコア1件だけ」残す
// ※必要に応じてグルーピングを増やせます
const MW_LOCK_GROUPS = [
  // オンコール系
  ["オンコール", "緊急訪問"],
  // 残業系
  ["残業", "残業"],
  // 通勤系（例）
  ["車通勤", "バイク通勤", "自転車通勤"],
];

// ==== Must/Want の曖昧さ解消（ボタン出し用） ====
// グループに複数命中したら選択肢を提示
const MW_DISAMBIG_GROUPS = [
  { root: "残業", options: ["残業", "残業月20時間以内"] },
  // 追加したい場合はここに増やす（例：{ root: "夜勤", options: ["夜勤", "日勤"] }）
];

function uniqArr(arr = []) {
  const s = new Set();
  const out = [];
  for (const x of arr) if (!s.has(x)) { s.add(x); out.push(x); }
  return out;
}

function pickMwDisambigOptions(allLabels = []) {
  for (const g of MW_DISAMBIG_GROUPS) {
    const hits = g.options.filter(o => allLabels.includes(o));
    if (hits.length >= 2) return g.options.slice(); // 同一グループから2つ以上出たら分岐
  }
  return [];
}

// アンカー/ゆらぎ用の正規化ヘルパ（既存の _norm_mw と同じ流儀でOK）
function _norm_anchor(s){
  return String(s||"").toLowerCase()
    .replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～")
    .replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~")
    .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g,"");
}

// LOCK適用：同一グループ内でスコア最大の1件だけ残す
function reduceByLocks(scored /* [{label, sc}] */){
  if (!Array.isArray(scored) || !scored.length) return [];
  const out = [];
  const handled = new Set();
  for (const group of MW_LOCK_GROUPS) {
    const present = scored.filter(x => group.includes(x.label));
    if (present.length) {
      present.sort((a,b)=> b.sc - a.sc);
      out.push(present[0]);             // トップだけ残す
      for (const p of present) handled.add(p.label);
    }
  }
  // どのグループにも属さない項目はそのまま
  for (const row of scored) {
    if (!handled.has(row.label)) out.push(row);
  }
  // 重複排除して返す
  const seen = new Set();
  return out.filter(r => !seen.has(r.label) && seen.add(r.label));
}

// === Must/Want 自由入力 → 抽出・ランク・強度判定（STEP4準拠） ===
const MUST_STRONG = /(絶対|必ず|マスト|NG|ダメ|無理|できない|不可|禁止|外せない|いらない|したくない|行けない|受けられない|困る)/i;
const WANT_SOFT  = /(あったら|できれば|希望|できると|望ましい|嬉しい|優先|できたら|あると良い|あれば)/i;

// 例：自由に増やせる。左=別名、右=mustWantItemsの正式ラベル
const MUSTWANT_ALIASES = {
  // "駅チカ": "駅近（5分以内）",
};

const MW_HINTS = [
  { kw: /(駅近|駅チカ|駅から近い)/i, label: "駅近（5分以内）" },
  { kw: /(直行直帰)/i,               label: "直行直帰" },
  { kw: /(時短)/i,                   label: "時短勤務" },

  // ★追加：夜勤NG → 「日勤のみ可」にブリッジ
  { kw: /(夜勤(は)?(無理|できない|不可|なし)|夜勤.*(無|なし|不可))/i, label: "日勤" },

  { kw: /(オンコール.*(無|なし|免除)|呼び出し.*(無|なし))/i, label: "オンコール" },
  { kw: /(残業.*(無|なし|ほぼなし)|定時)/i, label: "残業" },
  { kw: /(土日祝.*休)/i,             label: "土日祝休み" },
  { kw: /(有給|有休).*取(り|れ)やす/i, label: "有給消化率ほぼ100%" },
  { kw: /(育児|保育|託児)/i,         label: "育児支援" },
  { kw: /(車通勤)/i,                 label: "車通勤" },
  { kw: /(バイク通勤)/i,             label: "バイク通勤" },
  { kw: /(自転車通勤)/i,             label: "自転車通勤" },
];


function parseIncomeLabels(text=""){
  const outs = [];
  const m = String(text).match(/([3-9]00|3[50]|4[50]|5[50]|6[50]|700)\s*万/);
  if (m) {
    const n = Number(m[1]);
    const label = `年収${n}万以上`;
    if (mustWantItems.includes(label)) outs.push(label);
  }
  return outs;
}

function _norm_mw(s){
  const toFW = (x)=>String(x||"").replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
  const toHW = (x)=>String(x||"").replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
  return toHW(toFW(String(s||""))).toLowerCase().replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g,"");
}

function collectMustWantCandidates(text = "", k = 6){
  const raw = String(text||"");
  const ntext = _norm_mw(raw);

  // 1) まずは厳密寄り（正規化した相互包含）でスコア
  const prelim = [];
  for (const label of mustWantItems) {
    let sc = 0;

    const nl = _norm_mw(label);
    if (ntext && (ntext.includes(nl) || nl.includes(ntext))) sc += 0.45;

    // 2) 鍵語（アンカー）で明確に上げる（重複発火しないよう label ごとに固有化）
    const anc = MW_ANCHORS[label];
    if (anc && anc.test(raw)) sc += 0.60;

    // 3) 既存ヒント（寛め）には上限を設ける
    for (const h of MW_HINTS) {
      if (h.label === label && h.kw.test(raw)) { sc += 0.30; break; }
    }

    // 4) 類似度は弱め（誤爆の主因なので係数を小さく）
    sc += scoreSimilarity(label, raw) * 0.25;

    if (sc > 0) prelim.push({ label, sc });
  }

  // 5) 収入系の明示
  for (const lb of parseIncomeLabels(raw)) {
    const i = prelim.findIndex(x=>x.label===lb);
    if (i>=0) prelim[i].sc += 0.5; else prelim.push({ label: lb, sc: 0.6 });
  }

  // 6) 最低スコア閾値（これで「オンコールなし」発話で他が通らない）
  let scored = prelim.filter(x => x.sc >= MW_SIM_THRESHOLD);

  // 7) 衝突抑制（同時に立ちやすい近縁ラベルを排他）
  scored = reduceByLocks(scored);

  // 8) 上位k件
  scored.sort((a,b)=> b.sc - a.sc);
  const out = [];
  for (const {label} of scored) {
    if (!out.includes(label)) out.push(label);
    if (out.length >= k) break;
  }
  return out;
}

function decideStrength(text=""){
  const t = String(text||"");
  const must = MUST_STRONG.test(t);
  const want = WANT_SOFT.test(t);
  if (must && !want) return "must";
  if (!must && want) return "want";
  if (must && want)  return "must";
  if (/(できない|無理|なし|不要|やらない|行けない|持てない|対応不可)/i.test(t)) return "must";
  return "want";
}

function extractMustWantFromText(text = "", topK = 6){
  const labels = collectMustWantCandidates(text, topK);
  const strength = decideStrength(text);
  const out = { must: [], want: [] };
  if (!labels.length) return out;
  if (strength === "must") out.must = labels; else out.want = labels;
  return out;
}

// ID解決ヘルパ（tags.json由来のidに寄せる）
function resolveTagId(label=""){
  return tagIdByName.get(label)
      || tagIdByName.get(label.replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～"))
      || tagIdByName.get(label.replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~"))
      || (matchTagIdsInText(label)[0] ?? null);
}


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

export default async function handler(req, res) {
const method = (req.method || "GET").toUpperCase(); // ←現行に合わせる
console.log("[api/chat] HIT", method);
res.setHeader("X-Api-Chat-Sign", "chat.js@diagnostic"); // 応答識別用

  // ==== CORS（常にJSONを返す前提で統一）====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Id");
  res.setHeader("Allow", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // メソッド正規化
  const method = (req.method || "GET").toUpperCase();

  // セッションIDの取り出しは先にやる（全メソッドで同じ応答が返るように）
  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const querySid  = String(req.query?.sessionId || "").trim();
  // 予防：req.bodyが未パース/空でも落ちないように
  const safeBody  = (typeof req.body === "object" && req.body) ? req.body : {};
  const bodySid   = String(safeBody.sessionId || "").trim();
  const sessionId = headerSid || querySid || bodySid || "default";

  if (!sessions[sessionId] && safeBody.snapshot && method === "POST") {
    sessions[sessionId] = safeBody.snapshot;
  }
  const s = sessions[sessionId] ?? (sessions[sessionId] = initSession());

// 旧プロパティが残っていても落ちないように最低限の互換初期化
s.status.must_ng       ||= [];
s.status.must_have     ||= [];
s.status.must_ng_ids   ||= [];
s.status.must_have_ids ||= [];
s.status.want_text     ||= "";
s.status.memo          ||= {};
s.status.memo.must_ng_raw   ||= [];
s.status.memo.must_have_raw ||= [];


  // ここで、POST 以外の全メソッドは **必ず 200 + JSON** を返す
  // （OPTIONS/HEAD/PUT/PATCH/DELETE/GET を統一挙動にする）
  if (method !== "POST") {
    // OPTIONS も HEAD も 200 + JSON（空でOK）に統一し、フロントの response.json() を必ず成功させる
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
  const { message = "" } = req.body || {};
  const text = String(message || "").trim();

  // IDフォーマット判定（10〜20桁の数字を許容。ハイフン/空白など混在OK）
const idDigits = String(text || "").replace(/\D/g, ""); // 数字だけ抽出
const looksId = idDigits.length >= 10 && idDigits.length <= 20;

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

   // ---- Step4：転職理由（深掘り2回→候補提示） ----
if (s.step === 4) {

   // >>> SALARY: triage handler (top of Step4)
  // --- 給与トリアージの回答処理 ---
  if (s.drill.phase === "salary-triage" && s.drill.awaitingChoice) {
    s.drill.reasonBuf.push(text || "");

    if (isPeerComparisonSalary(text)) {
      // 純粋に年収アップ目的 → 未マッチ（金額はMust/Wantで具体化）
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
      // 「働きに見合ってない」→ 評価の文脈（仕事内容・キャリア）に寄せる
      s.drill.category = "仕事内容・キャリアに関すること";
      s.drill.awaitingChoice = false;
      s.drill.count = 1;

      const q = "評価や昇給の基準が不透明？成果が給与に反映されてない感じ？";
      const emp = await generateEmpathy(text, s);
      return res.json(withMeta({
        response: joinEmp(emp, q),
        step: 4, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 4));
    }

    // 判定つかないときは従来ロジックへ（やわらかい深掘りに合流）
    s.drill.awaitingChoice = false;
    s.drill.count = 1;
    const cls = classifyMotivation(s.drill.reasonBuf.join(" "));
    const q = (cls === "pos" || cls === "mixed")
      ? GENERIC_REASON_Q_POS.deep1[0]
      : "一番のひっかかりはどこ？（仕事内容/人間関係/労働時間のどれに近い？）";
    const emp = await generateEmpathy(text, s);
    return res.json(withMeta({
      response: joinEmp(emp, q),
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }
  // <<< SALARY: triage handler

  if (s.drill.phase === "private-confirm" && s.drill.awaitingChoice) {
  if (isYes(text)) {
    const tag = "家庭との両立に理解のある職場で働きたい";
    s.status.reason_tag = tag;
    const rid = reasonIdByName.get(tag);
    s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
    s.drill = { phase: null, count: 0, category: null, awaitingChoice: false,
                options: [], reasonBuf: s.drill.reasonBuf, flags: s.drill.flags };
    s.step = 5;
    return res.json(withMeta({
      response: `『${tag}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // Yes 以外はすべて固定文＋未マッチ
  s.drill.flags.privateDeclined = true;
  s.drill = { phase: null, count: 0, category: null, awaitingChoice: false,
              options: [], reasonBuf: s.drill.reasonBuf, flags: s.drill.flags };
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
  
  // 1) カテゴリ選択待ち（最終手段）
  if (s.drill.phase === "reason-cat" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    const chosenCat = s.drill.options.find(o => o === pick);
    if (chosenCat) {
      s.drill.category = chosenCat;

      // ここまでのユーザー発話をまとめる
      const joinedUser = s.drill.reasonBuf.join(" ");

      // オンコール/夜勤なら強制でプライベート × 候補固定
const forced1 = shouldForcePrivate(s) ? forcePrivateOncallNight(joinedUser) : null;
if (forced1) {
  s.drill.category = forced1.category;

  // 1択なら即確定して Step5 へ
  const sole = forced1.options && forced1.options.length === 1 ? forced1.options[0] : null;
  if (sole) {
    s.status.reason_tag = sole;
    const rid = reasonIdByName.get(sole);
    s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
    s.step = 5;
    resetDrill(s);
    return res.json(withMeta({
      response: `『${sole}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // 通常（複数候補）なら選択肢提示
  s.drill.phase = "reason";
  s.drill.awaitingChoice = true;
  s.drill.options = forced1.options;
  return res.json(withMeta({
    response: `この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

      // 候補が出せない場合：共感を返さずに Must へ
s.step = 5;
return res.json(withMeta({
  response: mustIntroText(),
  step: 5, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
}, 5));
    }
    // 再提示
    return res.json(withMeta({
      response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  // 2) 具体候補の選択（確定）
if (s.drill.phase === "reason" && s.drill.awaitingChoice && s.drill.options?.length) {
  const pick = normalizePick(text);
const chosen = s.drill.options.find(o => o === pick);
if (chosen) {
  const repeat = `『${chosen}』だね！担当エージェントに伝えておくね。`;

  s.status.reason_tag = chosen;

  // 名前からID引く。見つからなければ空配列
  const rid = reasonIdByName.get(chosen);
  s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);

  s.step = 5;
  resetDrill(s);
  return res.json(withMeta({
    response: `${repeat}\n\n${mustIntroText()}`,
    step: 5,
    status: s.status,
    isNumberConfirmed: true,
    candidateNumber: s.status.number,
    debug: debugState(s)
  }, 5));
}

  // 再提示（候補に一致しなかったときだけ）
  return res.json(withMeta({
    response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}
  
  // 3) 1回目の入力を受信 → まずはオンコール/夜勤の早期確認へ
if (s.drill.count === 0) {

  // >>> SALARY: triage entry (top of count===0)
  // --- 給与トリアージを最優先で実行 ---
  if (detectSalaryIssue(text)) {
    s.status.reason = text || "";
    s.status.memo.reason_raw = text || "";
    s.drill.reasonBuf = [text || ""];

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
  // <<< SALARY: triage entry
  
  s.status.reason = text || "";
  s.status.memo.reason_raw = text || "";
  s.drill.reasonBuf = [text || ""];

  const forced0 = shouldForcePrivate(s) ? forcePrivateOncallNight(text) : null;
  if (forced0) {
    // 深掘りには進まず、まずは1回でキャッチアップ → 確認だけする
    s.drill.category = forced0.category;              // "プライベートに関すること"
    s.drill.phase = "private-confirm";                // ← 確認フェーズに入る
    s.drill.awaitingChoice = true;
    s.drill.count = 0;                                // ← 深掘り回数は進めない
    s.drill.flags = s.drill.flags || {};             // ← 念のため初期化

    const emp0 = await generateEmpathy(text, s);
    const confirmText = "プライベートや家庭との両立に理解がほしい感じ？";
    return res.json(withMeta({
      response: joinEmp(emp0, confirmText),
      step: 4, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  // （以下はオンコール/夜勤じゃない通常ルート。元の処理そのまま）
  // 先行判定：管理者/上司 × ネガ → 「働く仲間に関すること」へ寄せる
  if (detectBossRelationIssue(text)) {
    s.drill.category = "働く仲間に関すること";
    s.drill.count = 1;
    const q = pickDeepQuestion("働く仲間に関すること", "deep1", text);
    const emp0 = await generateEmpathy(text, s);
    return res.json(withMeta({
      response: joinEmp(emp0, q),
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  const { best, hits } = scoreCategories(s.drill.reasonBuf.join(" "));
  if (!best || hits === 0 || noOptionCategory(best)) {
    const cls = classifyMotivation(s.status.reason || text || "");
    s.drill.category = (cls === "pos" || cls === "mixed")
      ? "仕事内容・キャリアに関すること"
      : null;
    s.drill.count = 1;

    const q = (cls === "pos" || cls === "mixed")
      ? GENERIC_REASON_Q_POS.deep1[0]
      : GENERIC_REASON_Q.deep1[0];

    const emp0 = await generateEmpathy(s.status.reason || text || "", s);
    return res.json(withMeta({
      response: joinEmp(emp0, q),
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  // 推定できたらカテゴリ深掘りへ
  s.drill.category = best;
  s.drill.count = 1;
  const q = pickDeepQuestion(best, "deep1", s.status.reason || text || "");
  const emp0 = await generateEmpathy(s.status.reason || text || "", s);
  return res.json(withMeta({
    response: joinEmp(emp0, q),
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

  // 4) 2回目の深掘り
  if (s.drill.count === 1) {
    s.drill.reasonBuf.push(text || "");
    const joined = s.drill.reasonBuf.join(" ");

    // 先行補強：1発目で未確定でも、通算文脈で「上司問題」なら寄せる
if (!s.drill.category && detectBossRelationIssue(joined)) {
  s.drill.category = "働く仲間に関すること";
}

    // 未確定なら再推定
    if (!s.drill.category) {
      const { best, hits } = scoreCategories(joined);
      if (best && hits > 0 && !noOptionCategory(best)) {
        s.drill.category = best;
      }
    }

    s.drill.count = 2;
const cat = s.drill.category;
const cls = classifyMotivation(joined);
let q;
if (!cat) {
  // カテゴリ未確定：pos/mixed→前向き、neg/neutral→通常
  q = (cls === "pos" || cls === "mixed")
    ? GENERIC_REASON_Q_POS.deep2[0]
    : GENERIC_REASON_Q.deep2[0];
} else if (cat === "仕事内容・キャリアに関すること" && (cls === "pos" || cls === "mixed")) {
  // キャリア系かつ前向きなら、前向きの聞き方に
  q = "どんな役割で力を発揮したい？身につけたいスキルや専門領域があれば教えて！";
} else {
  // 従来どおりカテゴリ固有の深掘り
  q = pickDeepQuestion(cat, "deep2", joined);
}

  const emp1 = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(emp1, q),
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

  // 5) 深掘り後の確定（カテゴリ不明ならカテゴリ選択へ）
  if (s.drill.count === 2) {
    s.drill.reasonBuf.push(text || "");

    if (!s.drill.category) {
      const { best, hits, ranking } = scoreCategories(s.drill.reasonBuf.join(" "));
      if (best && hits > 0 && !noOptionCategory(best)) {
        s.drill.category = best;
      } else {
        // それでも未確定：代表カテゴリを選んでもらう
        const pool = ranking.length
          ? ranking.slice(0,5).map(r=>r.cat)
          : ["仕事内容・キャリアに関すること","労働条件に関すること","働く仲間に関すること","経営・組織に関すること","プライベートに関すること"];
        s.drill.phase = "reason-cat";
        s.drill.awaitingChoice = true;
        s.drill.options = pool;
        const empC = await generateEmpathy(s.drill.reasonBuf.join(" "), s);
        return res.json(withMeta({
          response: joinEmp(empC, `ちなみに、この中だとどのカテゴリが一番近い？『${pool.map(x=>`［${x}］`).join("／")}』`),
          step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
        }, 4));
      }
    }

    const cat = s.drill.category;
    const allOptions = (transferReasonFlow[cat].internal_options || []);
    const joinedUser = s.drill.reasonBuf.join(" "); // ここまでのユーザー発話
    
    // オンコール/夜勤なら強制でプライベート × 候補固定
const forced2 = shouldForcePrivate(s) ? forcePrivateOncallNight(joinedUser) : null;
if (forced2) {
  s.drill.category = forced2.category;

  // 1択なら即確定して Step5 へ
  const sole = forced2.options && forced2.options.length === 1 ? forced2.options[0] : null;
  if (sole) {
    s.status.reason_tag = sole;
    const rid = reasonIdByName.get(sole);
    s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
    s.step = 5;
    resetDrill(s);
    return res.json(withMeta({
      response: `『${sole}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // 通常（複数候補）なら選択肢提示
  s.drill.phase = "reason";
  s.drill.awaitingChoice = true;
  s.drill.options = forced2.options;
  return res.json(withMeta({
    response: `この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
    step: 4, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

    const options = rankReasonOptions(allOptions, joinedUser, 3);

    if (!options.length) {
  // options.length === 0 のとき：共感なしで Must へ
  s.step = 5;
  return res.json(withMeta({
    response: mustIntroText(),
    step: 5,
    status: s.status,
    isNumberConfirmed: true,
    candidateNumber: s.status.number,
    debug: debugState(s)
  }, 5));
}

    // ★ここから追加：1択なら即確定して Step5 へ
if (options.length === 1) {
  const sole = options[0];
  s.status.reason_tag = sole;
  const rid = reasonIdByName.get(sole);
  s.status.reason_ids = Array.isArray(rid) ? rid : (rid != null ? [rid] : []);
  s.step = 5;
  return res.json(withMeta({
    response: `『${sole}』だね！担当エージェントに伝えておくね。\n\n${mustIntroText()}`,
    step: 5, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 5));
}

    s.drill.phase = "reason";
    s.drill.awaitingChoice = true;
    s.drill.options = options;
    return res.json(withMeta({
      response: `この中だとどれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`,
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }
} 
  
  // ---- Step5：絶対NG（Must NG） ----
if (s.step === 5) {
  // 1) 「選択肢（曖昧解消）」の回答処理
  if (s.drill.phase === "mw-ng" && s.drill.awaitingChoice && s.drill.options?.length) {
    const pick = normalizePick(text);
    const chosen = s.drill.options.find(o => o === pick);
    if (chosen) {
      if (!s.status.must_ng.includes(chosen)) s.status.must_ng.push(chosen);
      const id = resolveTagId(chosen);
      if (id != null && !s.status.must_ng_ids.includes(id)) s.status.must_ng_ids.push(id);

      resetDrill(s);
      const emp = await generateEmpathy(text || "", s);
      const tail = "他にも『これは絶対ダメ！』はある？（なければ「ない」って返してね）";
      return res.json(withMeta({
        response: joinEmp(emp, `OK！『${chosen}』だね。\n${tail}`),
        step: 5, status: s.status, isNumberConfirmed: true,
        candidateNumber: s.status.number, debug: debugState(s)
      }, 5));
    }
    // 再提示
    return res.json(withMeta({
      response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // 2) なし宣言 → 次へ
  if (isNone(text)) {
    s.step = 6;
    return res.json(withMeta({
      response: "次は【これだけは絶対ないと困る！】という条件を教えてね。\n「賞与がないと困る！」\n「絶対土日休みがいい！」\nって感じ。\n1個じゃなくてもOKだよ！",
      step: 6, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s),
    }, 6));
  }

  // 3) 入力を解析して曖昧解消が必要かチェック（例：残業 vs 残業月20時間以内）
  const parsed = extractMustWantFromText(text, 6);
  const baseLabels = parsed.must.length ? parsed.must : parsed.want;

  let rawLabels = [];
  try {
    const rawIds = matchTagIdsInText(text);
    rawLabels = rawIds.map(id => tagNameById.get(id)).filter(Boolean);
  } catch {}

  const candSet = new Set([...(baseLabels || []), ...rawLabels]);

  // ローカルな曖昧グループ（必要に応じて追加）
  const MW_DISAMBIG_GROUPS = [
    ["残業", "残業月20時間以内"],
  ];

  let options = [];
  for (const group of MW_DISAMBIG_GROUPS) {
    const hits = group.filter(lb => candSet.has(lb));
    if (hits.length >= 2) {
      options = hits;
      break;
    }
  }

  if (options.length >= 2) {
    s.drill.phase = "mw-ng";
    s.drill.awaitingChoice = true;
    s.drill.options = options.slice(0, 6);

    const emp = await generateEmpathy(text || "", s);
    return res.json(withMeta({
      response: joinEmp(emp, `どっちに近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`),
      step: 5, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  // 4) 通常処理（抽出 → 追加）
  const picked = parsed;
  const addedMsgs = [];
  const labels = picked.must.length ? picked.must : picked.want;

  if (labels.length) {
    const uniq = [];
    for (const lb of labels) if (!uniq.includes(lb)) uniq.push(lb);

    for (const lb of uniq) {
      if (!s.status.must_ng.includes(lb)) s.status.must_ng.push(lb);
      const id = resolveTagId(lb);
      if (id != null && !s.status.must_ng_ids.includes(id)) s.status.must_ng_ids.push(id);
      addedMsgs.push(`OK！『${lb}』だね。担当エージェントに共有するね。`);
    }
  } else {
    s.status.memo.must_ng_raw ??= [];
    s.status.memo.must_ng_raw.push(text);
  }

  // 原文から ID もマージ
  try {
    const rawIdsNg = matchTagIdsInText(text);
    for (const rid of rawIdsNg) {
      if (rid != null && !s.status.must_ng_ids.includes(rid)) {
        s.status.must_ng_ids.push(rid);
      }
    }
  } catch {}

  const emp = await generateEmpathy(text || "", s);
  const tail = "他にも『これは絶対ダメ！』はある？（なければ「ない」って返してね）";
  return res.json(withMeta({
    response: joinEmp(emp, (addedMsgs.length ? addedMsgs.join("\n")+"\n" : "") + tail),
    step: 5, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 5));
}

 // ---- Step6：絶対欲しい（Must Have） ----
  // --- STEP6: MWあいまい選択中の確定処理 ---
if (s.drill.phase === "mw-have" && s.drill.awaitingChoice && s.drill.options?.length) {
  const pick = normalizePick(text);
  const chosen = s.drill.options.find(o => o === pick);
  if (chosen) {
    if (!s.status.must_have.includes(chosen)) s.status.must_have.push(chosen);
    const id = resolveTagId(chosen);
    if (id != null && !s.status.must_have_ids.includes(id)) s.status.must_have_ids.push(id);

    resetDrill(s);
    const emp = await generateEmpathy(text || "", s);
    const tail = "他にも『これは必須でほしい！』はある？（なければ「ない」って返してね）";
    return res.json(withMeta({
      response: joinEmp(emp, `『${chosen}』も担当エージェントに共有するね！\n${tail}`),
      step: 6, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 6));
  }

  // 再提示
  return res.json(withMeta({
    response: `ごめん、もう一度どれが近いか教えて！『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
    step: 6, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 6));
}
if (s.step === 6) {
  if (isNone(text)) {
    s.step = 7;
    return res.json(withMeta({
      response: "次は【これがあったら（なかったら）嬉しいな】という条件を教えてね。\n「多職種連携しやすい職場がいいな」\n「子育てに理解があるといいな」\nって感じ。\n自由に回答してね！",
      step: 7, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 7));
  
  // --- あいまい（例：残業 vs 残業月20時間以内）を先に判定してボタン提示 ---
{
  const picked = extractMustWantFromText(text, 6);
  const labels = picked.want.length ? picked.want : picked.must;

  let rawLabels = [];
  try {
    const rawIds = matchTagIdsInText(text);
    rawLabels = rawIds.map(id => tagNameById.get(id)).filter(Boolean);
  } catch {}
  const allCandidates = uniqArr([...(labels || []), ...rawLabels]);

  const opts = pickMwDisambigOptions(allCandidates);
  if (opts.length >= 2) {
    s.drill.phase = "mw-have";
    s.drill.awaitingChoice = true;
    s.drill.options = opts;

    const emp = await generateEmpathy(text || "", s);
    return res.json(withMeta({
      response: joinEmp(emp, `どっちに近い？『${opts.map(x=>`［${x}］`).join("／")}』`),
      step: 6, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 6));
  }
}

  const picked = extractMustWantFromText(text, 6);
  const addedMsgs = [];

  const labels = picked.want.length ? picked.want : picked.must;
  if (labels.length) {
    const uniq = [];
    for (const lb of labels) if (!uniq.includes(lb)) uniq.push(lb);

    for (const lb of uniq) {
      if (!s.status.must_have.includes(lb)) s.status.must_have.push(lb);
      const id = resolveTagId(lb);
      if (id != null && !s.status.must_have_ids.includes(id)) s.status.must_have_ids.push(id);
      addedMsgs.push(`『${lb}』も担当エージェントに共有するね！`);
    }
  } else {
    s.status.memo.must_have_raw ??= [];
    s.status.memo.must_have_raw.push(text);
  }

  // ★追加：原文からも tags.json の ID を抽出してマージ（取りこぼし防止）
  try {
    const rawIdsHave = matchTagIdsInText(text);
    for (const rid of rawIdsHave) {
      if (rid != null && !s.status.must_have_ids.includes(rid)) {
        s.status.must_have_ids.push(rid);
      }
    }
  } catch {}

  const emp = await generateEmpathy(text || "", s);
  const tail = "他にも『これは必須でほしい！』はある？（なければ「ない」って返してね）";
  return res.json(withMeta({
    response: joinEmp(emp, (addedMsgs.length ? addedMsgs.join("\n")+"\n" : "") + tail),
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
  "丁寧すぎず、崩しすぎない口調。",
  "敬語は禁止。寄り添うキャリアエージェントという立場の口調。",
  "質問系、疑問系で終わらない。言い切り分で終わる。説教しない。",
  "必ず言い切り分で終わる。",
  "説教しない。",
  "無理に転職や現職へ留まることを勧めない。",
  "返答は必ず100文字以内に収める。前後の流れから自然な文にする。"
].join("\n");

    const user = [
      `直近の発話: ${recent || "なし"}`,
      `職種: ${role || "未入力"}`,
      `現職: ${place || "未入力"}`,
      `カテゴリ: ${cat || "未確定"}`,
      "",
      `今回の発話: ${userText || "（内容なし）"}`,
      "",
      "避ける言い回し例: ありがとう 大切 寄り添う わかる そうだよね 安心して 頑張ろう 大丈夫 受け止めた 整理しよう"
    ].join("\n");

    const rsp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      top_p: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 180,
    });

    let txt = rsp?.choices?.[0]?.message?.content?.trim() || "";
    // 後処理（記号やダブりの軽整形）
    txt = txt.replace(/\"/g, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

    txt = enforcePlainEnding(txt);
    
    return txt || fallback;
  } catch {
    return fallback;
  }
}
// ローカル簡易生成（カテゴリとキーワードで揺らぎ）
function localEmpathy(text = "", cat = ""){
  const t = String(text);
  const has = (w) => t.includes(w);
  const table = {
    "経営・組織に関すること": [
      "その方針ズレ、放置できないね。", "価値観の距離、無視できないね。"
    ],
    "働く仲間に関すること": [
      "関係の消耗、積み重なるときつい。", "安心して話せない職場は疲れるよね。"
    ],
    "仕事内容・キャリアに関すること": [
      "物足りなさ、次の一歩に変えよう。", "挑戦欲が出てる、この流れ大事。"
    ],
    "労働条件に関すること": [
      "その負荷、長期では持たないよね。", "時間の縛り、生活に食い込むよね。"
    ],
    "プライベートに関すること": [
      "両立の壁、見過ごせないポイントだ。", "生活リズム守れる働き方に寄せよう。"
    ]
  };
  const generic = [
    "その違和感、次の判断材料にしよう。", "しんどさの正体、ここで言語化しよう。"
  ];
  let pool = table[cat] || [];
  if (has("残業") || has("夜勤")) pool = pool.concat(["休めない感覚、疲労に直結だよね。"]);
  if (has("評価") || has("教育")) pool = pool.concat(["評価と成長のズレ、響くよね。"]);
  if (!pool.length) pool = generic;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 2-gram Jaccard
function jaccard2gram(a = "", b = ""){
  const grams = (s) => {
    const z = s.replace(/\s/g, "");
    const out = new Set();
    for (let i=0; i<z.length-1; i++) out.add(z.slice(i, i+2));
    return out;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
// ==== 類似度＆共感用ヘルパ ====

// 全角↔半角のゆらぎ吸収＆区切り削除
function _toFW(s){ return String(s||"").replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～"); }
function _toHW(s){ return String(s||"").replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~"); }
function _scrub(s){ return String(s||"").replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～!?！？。、，．・]/g,""); }
function _norm(s){ return _scrub(_toHW(_toFW(String(s||"")))); }

// 2-gram（連続2文字）集合
function _bigrams(s){
  const n = _norm(s);
  const arr = [];
  for (let i=0; i<n.length-1; i++) arr.push(n.slice(i, i+2));
  return new Set(arr);
}

// 類似度：Jaccard（2-gram）
function scoreSimilarity(a, b){
  const A = _bigrams(a||"");
  const B = _bigrams(b||"");
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// ==== deep質問セレクタ ====
// 文脈に合わせて deep1 / deep2 の中からもっとも合いそうな質問を1つ選ぶ
function pickDeepQuestion(cat, stage /* "deep1" | "deep2" */, userText = "") {
  const qs = (transferReasonFlow?.[cat]?.[stage] || []).slice();
  if (!qs.length) {
    return (stage === "deep1")
      ? (GENERIC_REASON_Q.deep1[0] || "もう少し詳しく教えて！")
      : (GENERIC_REASON_Q.deep2[0] || "もう少し詳しく教えて！");
  }

  const t = String(userText).toLowerCase();

  // 簡易ヒューリスティック（痛み / 前向き）
  const painRe = /(きつい|辛い|しんどい|大変|消耗|重い|疲|負担|件数|ノルマ|介助|入浴)/;
  const upRe   = /(昇進|昇格|資格|スキル|学び|挑戦|成長|キャリア)/;

  if (cat === "仕事内容・キャリアに関すること") {
    if (painRe.test(t)) {
      const hit = qs.find(q => q.includes("やりがい"));
      if (hit) return hit;
    }
    if (upRe.test(t)) {
      const hit = qs.find(q => q.includes("キャリアアップ"));
      if (hit) return hit;
    }
  }

  if (cat === "働く仲間に関すること") {
    if (/(見下|高圧|上司|師長|医師|先生|ヘルパー|介護職)/.test(t)) {
      const hit = qs.find(q => /どんな人間関係|上司|同僚|雰囲気/.test(q));
      if (hit) return hit;
    }
  }

  if (cat === "労働条件に関すること") {
    if (/(夜勤|残業|シフト|休|有給|オンコール|呼び出し|移動|自転車)/.test(t)) {
      const hit = qs.find(q => /一番きつい|勤務条件/.test(q));
      if (hit) return hit;
    }
  }

  // ルールで決まらなければ、発話との類似度で選ぶ
  let best = qs[0], bestScore = -1;
  for (const q of qs) {
    const s = scoreSimilarity(q, userText);
    if (s > bestScore) { best = q; bestScore = s; }
  }
  return best || qs[0];
}

// internal_options をユーザ発話との類似度で降順ソートして上位k件を返す
function pickTopKOptions(options = [], userText = "", k = 3){
  const scored = options.map(opt => ({
    opt,
    score: scoreSimilarity(opt, userText)
  }));
  scored.sort((a,b)=> b.score - a.score);
  // スコアが全て0なら、従来どおり先頭k件（念のためのフォールバック）
  const anyHit = scored.some(s => s.score > 0);
  return (anyHit ? scored : options.map(o=>({opt:o,score:0})))
    .slice(0, k)
    .map(s => s.opt);
}

// 追加：候補ランク付け（3件）
function rankReasonOptions(options = [], userText = "", k = 3) {
  const t = String(userText).toLowerCase();
  const boss = /(管理者|管理職|上司|師長|看護師長|部長|課長|マネージャ|ﾏﾈｰｼﾞｬ|リーダー|院長|園長)/;

  return options
    .map(opt => {
      let score = scoreSimilarity(opt, userText);
      // 上司/管理者の文脈なら、人間関係/上司/経営者/ロールモデル系を微ブースト
      if (boss.test(t) && /(人間関係|上司|経営者|ロールモデル|一体感|価値観)/.test(opt)) {
        score += 0.15;
      }
      return { opt, score };
    })
    .sort((a,b)=> b.score - a.score)
    .slice(0, k)
    .map(s => s.opt);
}

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

// 疑問で終わらせないフィルタ
function enforcePlainEnding(text = '') {
  let t = String(text).trim();
  if (!t) return t;

  // 軽い整形だけ（改行の詰めすぎ防止など）
  t = t.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // 語尾は基本そのまま。終端に句読点等がなければ「。」だけ付ける
  if (!/[。！？!？＞）)\]]$/.test(t)) t += '。';

  return t;
}

function joinEmp(a, b) {
  const left  = String(a || "").trimEnd();           // 共感文の末尾を整える
  const right = String(b || "").replace(/^\n+/, ""); // 定型文の先頭改行は削る
  return `${left}\n\n${right}`;                      // 空行1つでつなぐ
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

// 入力に含まれる「現職（施設/形態）」候補ラベルを返す（重複排除）
function matchPlacesInText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const toFW = (s) => String(s || "").replace(/\(/g,"（").replace(/\)/g,"）").replace(/~/g,"～");
  const toHW = (s) => String(s || "").replace(/（/g,"(").replace(/）/g,")").replace(/～/g,"~");
  const scrub = (s) =>
    String(s || "").toLowerCase()
      .replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～!?！？。、，．・]/g, "");
  const norm  = (s) => scrub(toHW(toFW(s)));
  const normText = norm(raw);

  const out = new Set();

  // 0) 厳密一致 → 正式ラベル
  const byExact =
      tagIdByName.get(raw)
   || tagIdByName.get(toFW(raw))
   || tagIdByName.get(toHW(raw));
  if (byExact != null) {
    const name = tagNameById.get(byExact);
    if (name) out.add(name);
  }

  // 1) エイリアス命中 → 正式ラベル
  for (const [alias, label] of Object.entries(PLACE_ALIASES || {})) {
    if (!alias || !label) continue;
    if (normText.includes(norm(alias))) out.add(label);
  }

  // 2) 双方向部分一致
  const normalize = (s) => (s ? norm(s) : "");
  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    if (!name) continue;
    const nTag = normalize(name);
    if (!nTag) continue;
    if (normText.includes(nTag) || nTag.includes(normText)) out.add(name);
  }

  // 3) ファジー補完（必要時）
  if (out.size === 0) {
    const pool = [];
    for (const t of (Array.isArray(tagList) ? tagList : [])) {
      const name = String(t?.name ?? "");
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
// ラベル（正式ラベル）から、別名も含めて tags.json の ID を集める（正規化＋双方向部分一致）
function getIdsForLicenseLabel(label = "") {
  if (!label) return [];

  // 全角/半角ゆらぎと区切り記号を吸収して比較する
  const toFW = (s) => String(s || "").replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => String(s || "").replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const scrub = (s) =>
    String(s || "").trim().replace(/[ \t\r\n\u3000、。・／\/＿\u2013\u2014\-~～]/g, "");
  const normalize = (s) => scrub(toHW(toFW(String(s || ""))));

  // このラベルに紐づく「検索語」セット（ラベル自身＋ゆらぎ＋別名）
  const nameSet = new Set();
  const pushAllForms = (s) => {
    if (!s) return;
    nameSet.add(s);
    nameSet.add(toFW(s));
    nameSet.add(toHW(s));
  };

  // ラベル自身
  pushAllForms(label);

  // licenseMap は「別名 → [ラベル…]」。label を含むすべての別名を追加
  for (const [alias, labels] of licenseMap.entries()) {
    if (Array.isArray(labels) && labels.includes(label)) {
      pushAllForms(alias);
    }
  }

  // まずは tagIdByName での厳密一致（高速パス）
  const exactIds = new Set();
  for (const n of nameSet) {
    const id = tagIdByName.get(n);
    if (id != null) exactIds.add(id);
  }
  if (exactIds.size) return Array.from(exactIds);

  // 厳密一致で取れない場合は、tags.json 全走査で双方向部分一致
  const needles = Array.from(nameSet).map(normalize).filter(Boolean);
  const ids = new Set();

  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    if (!name) continue;

    const normTag = normalize(name);
    if (!normTag) continue;

    for (const nd of needles) {
      if (!nd) continue;
      // 「タグ名が検索語に含まれる」または「検索語がタグ名に含まれる」
      if (normTag.includes(nd) || nd.includes(normTag)) {
        if (t.id != null) ids.add(t.id);
        break;
      }
    }
  }

  return Array.from(ids);
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
 }
