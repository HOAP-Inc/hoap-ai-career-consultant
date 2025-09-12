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

// ---- 転職理由の名称→ID マップ（job_change_purposes.json）----
let reasonList = [];
try {
  const raw = require('../../job_change_purposes.json');  // tags.json と同じ階層に置いた前提
  if (Array.isArray(raw?.items))       reasonList = raw.items;
  else if (Array.isArray(raw?.tags))   reasonList = raw.tags;
  else if (Array.isArray(raw))         reasonList = raw;
  else                                 reasonList = [];
} catch (e) {
  console.error('job_change_purposes.json 読み込み失敗:', e);
  reasonList = [];
}

const reasonIdByName = new Map();
try {
  for (const t of (Array.isArray(reasonList) ? reasonList : [])) {
    const name = String(t?.name ?? '');
    const id   = t?.id;
    if (!name || id == null) continue;
    const fw = name.replace(/\(/g, '（').replace(/\)/g, '）').replace(/~/g, '～');
    const hw = name.replace(/（/g, '(').replace(/）/g, ')').replace(/～/g, '~');
    reasonIdByName.set(name, id);
    reasonIdByName.set(fw, id);
    reasonIdByName.set(hw, id);
  }
} catch (e) {
  console.error('reasonIdByName 構築失敗:', e);
}

// ---- Step ラベル（UI用） ----
const STEP_LABELS = {
   1: "求職者ID",
    2: "職種",
    3: "現職",
    4: "転職理由",
    5: "絶対条件（Must）",
    6: "希望条件（Want）",
    7: "これまで（Can）",
    8: "これから（Will）",
    9: "完了",
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
  "企業（産業保健・企業内看護など）","4週8休以上","育児支援あり","年間休日120日以上",
  "週1日からOK","週2日からOK","土日祝休み","家庭都合休OK","月1シフト提出",
  "毎週～隔週シフト提出","有給消化率ほぼ100%","長期休暇あり","週休2日","週休3日",
  "日勤のみ可","夜勤専従あり","2交替制","3交替制","午前のみ勤務","午後のみ勤務",
  "残業ほぼなし","オンコールなし・免除可","緊急訪問なし","時差出勤導入","フレックスタイム制度あり",
  "残業月20時間以内","スキマ時間勤務","時短勤務相談可","駅近（5分以内）","車通勤可",
  "バイク通勤可","自転車通勤可","駐車場完備","直行直帰OK","年収300万以上","年収350万以上",
  "年収400万以上","年収450万以上","年収500万以上","年収550万以上","年収600万以上",
  "年収650万以上","年収700万以上","賞与あり","退職金あり","寮あり・社宅あり",
  "託児所・保育支援あり","社会保険完備","交通費支給","扶養控除内考慮","復職支援",
  "住宅手当","副業OK","日・祝日給与UP","引越し手当","緊急訪問時の手当・代休あり",
  "スマホ・タブレット貸与あり","電動アシスト自転車・バイク・車貸与","社割あり",
  "ハラスメント相談窓口あり","研修制度あり","資格取得支援あり","セミナー参加費補助あり",
  "マニュアル完備","動画マニュアルあり","評価制度あり","メンター制度あり","独立・開業支援あり",
  "院長・分院長候補","担当制"
];

// ---- セッション ----
const sessions = Object.create(null);
function initSession() {
  return {
    step: 1,
    isNumberConfirmed: false,
    drill: { phase: null, count: 0, category: null, awaitingChoice: false, options: [], reasonBuf: [],flags: {} },
    status: {
      number: "",
      role: "",
      role_ids: [],     // ← 追加：職種（資格）の tags.json ID
      place: "",
      place_ids: [],    // ← 追加：現職（施設/形態など）の tags.json ID
      reason: "",
      reason_tag: "",
      reason_ids: [],
      must: [],
      want: [],
      must_ids: [],
      want_ids: [],
      can: "",
      will: "",
      licenses: [],
      memo: { reason_raw: "", must_raw: [], want_raw: [] },
    },
  };
}
export default async function handler(req, res) {
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
  if (!s.status.must_ids) s.status.must_ids = [];
  if (!s.status.want_ids) s.status.want_ids = [];

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
    s.status.role_ids = [];
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
    s.status.role_ids = [];
    s.step = 3;
    return res.json(withMeta({
      response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）急性期病棟／訪問看護ステーション",
      step: 3, status: s.status, isNumberConfirmed: true,
      candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }

  // 候補ゼロ：入力そのまま（IDは空でクリア）
  if (found.length === 0) {
    s.status.role = text || "";
    s.status.licenses = [];
    s.status.role_ids = [];
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
  s.status.place = text || "";
  // 入力に含まれるタグ名を拾って tags.json のIDに変換
  s.status.place_ids = matchTagIdsInText(text);  // ← 追加

  s.step = 4;
  s.drill = {
  phase: "reason",
  count: 0,
  category: null,
  awaitingChoice: false,
  options: [],
  reasonBuf: [],
  flags: s.drill.flags || {},
};
  return res.json(withMeta({
    response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}

   // ---- Step4：転職理由（深掘り2回→候補提示） ----
if (s.step === 4) {

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
  const fixed = "オンコールがない職場を考えていこうね。";

  return res.json(withMeta({
    response: joinEmp(emp0, `${fixed}\n\n${mustIntroText()}`),
    step: 5, status: s.status, isNumberConfirmed: true,
    candidateNumber: s.status.number, debug: debugState(s)
  }, 5));
}
    // 別意見（自由文）：理由バッファに追記して深掘り1回目へ
    s.drill.reasonBuf.push(text || "");
    s.drill.flags.privateDeclined = true;
    s.drill.count = 1;
    s.drill.phase = "reason";
    s.drill.awaitingChoice = false;

    const emp0 = await generateEmpathy(text, s);
    const { best, hits } = scoreCategories(s.drill.reasonBuf.join(" "));
    if (best && hits > 0 && !noOptionCategory(best)) s.drill.category = best;

    const cls = classifyMotivation(s.drill.reasonBuf.join(" "));
    const q = !s.drill.category
      ? ((cls === "pos" || cls === "mixed") ? GENERIC_REASON_Q_POS.deep1[0] : GENERIC_REASON_Q.deep1[0])
      : pickDeepQuestion(s.drill.category, "deep1", s.drill.reasonBuf.join(" "));

    return res.json(withMeta({
      response: joinEmp(emp0, q),
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  
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
  
  // ---- Step5：絶対に外せない条件（Must） ----
  if (s.step === 5) {
  if (isNone(text)) {
    s.step = 6;
    return res.json(withMeta({
      response: "ありがとう！それじゃあ次は【あったらいいな（希望条件）】を教えてね。",
      step: 6,
      status: s.status,
      isNumberConfirmed: true,
      candidateNumber: s.status.number,
      debug: debugState(s),
    }, 6));
  }
    
    const tags = matchTags(text, mustWantItems);
    if (tags.length) {
      const added = [];
      for (const t of tags.slice(0, 3)) {
        if (!s.status.must.includes(t)) { s.status.must.push(t); added.push(t); }
      }
      for (const label of added) {
        const id = tagIdByName.get(label);
        if (id && !s.status.must_ids.includes(id)) s.status.must_ids.push(id);
      }
      const line = added.map(t => `『${t}』だね！これも記憶したよ！`).join("\n");
const empM1 = await generateEmpathy(text || "", s);
return res.json(withMeta({
  response: joinEmp(empM1, `${line}\n他にも絶対条件はある？（なければ「ない」って返してね）`),
  step: 5,
  status: s.status,
  isNumberConfirmed: true,
  candidateNumber: s.status.number,
  debug: debugState(s),
}, 5));
}
    s.status.memo.must_raw ??= [];
s.status.memo.must_raw.push(text);
const empM2 = await generateEmpathy(text || "", s);
return res.json(withMeta({
  response: joinEmp(empM2, "他にも絶対条件はある？（なければ「ない」って返してね）"),
  step: 5,
  status: s.status,
  isNumberConfirmed: true,
  candidateNumber: s.status.number,
  debug: debugState(s),
}, 5));
  }

  // ---- Step6：あったらいいな（Want） ----
if (s.step === 6) {
  if (isNone(text)) {
    s.step = 7;
    return res.json(withMeta({
      response: "質問は残り2つ！\nまずは【いま出来ること・得意なこと（Can）】を教えてね。自由に書いてOKだよ。",
      step: 7, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 7));
  }

  const tags = matchTags(text, mustWantItems);
  if (tags.length) {
    const added = [];
    for (const t of tags.slice(0, 3)) {
      if (!s.status.want.includes(t)) { s.status.want.push(t); added.push(t); }
    }
    for (const label of added) {
      const id = tagIdByName.get(label);
      if (id && !s.status.want_ids.includes(id)) s.status.want_ids.push(id);
    }
    const line = added.map(t => `『${t}』だと嬉しいってことだね！`).join("\n");
    const empW1 = await generateEmpathy(text || "", s);
    return res.json(withMeta({
      response: joinEmp(empW1, `${line}\n他にもあったらいいなっていうのはある？（なければ「ない」って返してね）`),
      step: 6, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 6));
  }

  s.status.memo.want_raw ??= [];
  s.status.memo.want_raw.push(text);
  const empW2 = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empW2, "他にもあったらいいなっていうのはある？（なければ「ない」って返してね）"),
    step: 6, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 6));
}


  // ---- Step7：Can ----
if (s.step === 7) {
  s.status.can = text || "";
  s.step = 8;
  const empCan = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empCan, "これが最後の質問👏\n【これから挑戦したいこと（Will）】を教えてね。自由に書いてOKだよ。"),
    step: 8,
    status: s.status,
    isNumberConfirmed: true,
    candidateNumber: s.status.number,
    debug: debugState(s)
  }, 8));
}

// ---- Step8：Will ----
if (s.step === 8) {
  s.status.will = text || "";
  s.step = 9;
  const empWill = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empWill, "今日はたくさん話してくれてありがとう！\n整理した内容は担当エージェントにしっかり共有するね。面談でさらに具体化していこう！"),
    step: 9, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 9));
}

// ---- Step9：完了後の追加発話 ----
if (s.step === 9) {
  const empDone = await generateEmpathy(text || "", s);
  return res.json(withMeta({
    response: joinEmp(empDone, "長い時間付き合ってくれてありがとう！続きは担当エージェントと話そうね！"),
    step: 9,
    status: s.status,
    isNumberConfirmed: true,
    candidateNumber: s.status.number,
    debug: debugState(s),
  }, 9));
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
    mustCount: s.status.must.length,
    wantCount: s.status.want.length,
  };
}
function buildStatusBar(st, currentStep = 0) {
  const fmtIds = (arr = []) => (arr || []).map(id => `ID:${id}`).join(",");

  // ====== 整合チェック（簡潔版）======
  const lic = Array.isArray(st.licenses) ? st.licenses[0] : "";
  const roleLabel = lic || st.role || "";
  const roleIsConsistent = roleLabel ? OFFICIAL_LICENSES.has(roleLabel) : false;

  const placeIsConsistent  = Array.isArray(st.place_ids)  && st.place_ids.length  > 0;
  const reasonIsConsistent = Array.isArray(st.reason_ids) && st.reason_ids.length > 0;
  const mustIsConsistent   = Array.isArray(st.must_ids)   && st.must_ids.length   > 0;
  const wantIsConsistent   = Array.isArray(st.want_ids)   && st.want_ids.length   > 0;

  // 受付中フラグ（この間は「済」を出さない）
  const inMustPhase = currentStep === 5;
  const inWantPhase = currentStep === 6;

  return {
    求職者ID: st.number || "",

    職種:
      roleLabel
        ? (roleIsConsistent ? roleLabel : "済")
        : "",

    現職:
      st.place
        ? (placeIsConsistent ? `${st.place}（${fmtIds(st.place_ids)}）` : "済")
        : "",

    転職目的:
      reasonIsConsistent
        ? (st.reason_ids?.length
            ? `${st.reason_tag}（${fmtIds(st.reason_ids)}）`
            : (st.reason_tag || ""))
        : (st.reason_tag ? st.reason_tag : ""),

    // ←ここがポイント：Step5の最中は「済」を出さない
    Must:
      (() => {
        if (Array.isArray(st.must) && st.must.length > 0) {
          // 入力済みなら、IDの有無に関わらずラベルをそのまま表示（受付中はこれが自然）
          return mustIsConsistent
            ? (st.must_ids?.length ? `${st.must.join("／")}（${fmtIds(st.must_ids)}）` : st.must.join("／"))
            : st.must.join("／");
        }
        // テキストだけ（辞書非ヒット）を memo に溜めているケース
        const hasRaw = Array.isArray(st.memo?.must_raw) && st.memo.must_raw.length > 0;
        if (hasRaw) {
          // 受付中なら空欄（未完了）。受付終了後（Stepを越えたら）だけ「済」を出す
          return inMustPhase ? "" : (mustIsConsistent ? st.must.join("／") : "済");
        }
        return "";
      })(),

    // Want も同様に受付中は「済」を出さない
    Want:
      (() => {
        if (Array.isArray(st.want) && st.want.length > 0) {
          return wantIsConsistent
            ? (st.want_ids?.length ? `${st.want.join("／")}（${fmtIds(st.want_ids)}）` : st.want.join("／"))
            : st.want.join("／");
        }
        const hasRaw = Array.isArray(st.memo?.want_raw) && st.memo.want_raw.length > 0;
        if (hasRaw) {
          return inWantPhase ? "" : (wantIsConsistent ? st.want.join("／") : "済");
        }
        return "";
      })(),

    Can: st.can ? "済" : "",
    Will: st.will ? "済" : "",
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
  return "ありがとう！それじゃあ【絶対に外せない条件】を教えてね。\n\n" +
         "仕事内容でも、制度でも、条件でもOK◎\n\n" +
         "例えば・・・\n" +
         "「絶対土日休みじゃないと困る！」\n" +
         "「絶対オンコールはできない！」\n\n" +
         "後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。";
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
// 入力文に含まれる tags.json 名称を検出して ID 配列で返す
function matchTagIdsInText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];

  // ① まずは厳密一致（tagIdByName は全角/半角ゆらぎを両方登録済み）
  const direct = tagIdByName.get(raw);
  if (direct != null) return [direct];

  // ② 全角↔半角ゆらぎを揃えて再度厳密一致
  const toFW = (s) => s.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const toHW = (s) => s.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  const fw = toFW(raw);
  const hw = toHW(raw);
  const byFW = tagIdByName.get(fw);
  if (byFW != null) return [byFW];
  const byHW = tagIdByName.get(hw);
  if (byHW != null) return [byHW];

  // ③ サブストリング一致（文章中に含まれるパターン）
  const normalize = (s) => {
    const z = String(s || "");
    const h = toHW(toFW(z));
    // 区切り記号等を除去して比較の取りこぼしを減らす
    return h.replace(/[ \t\r\n\u3000、。・／\/＿\-–—~～]/g, "");
  };
  const normText = normalize(raw);
  const set = new Set();

  for (const t of (Array.isArray(tagList) ? tagList : [])) {
    const name = String(t?.name ?? "");
    if (!name) continue;
    const n = normalize(name);
    if (n && normText.includes(n)) {
      if (t.id != null) set.add(t.id);
    }
  }
  return Array.from(set);
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
