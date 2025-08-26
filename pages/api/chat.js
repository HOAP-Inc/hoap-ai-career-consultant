// pages/api/chat.js
// ほーぷちゃん：会話ロジック（Step厳密・深掘り2回・候補提示・ステータス算出）
const { tags: tagList } = require("../../tags.json");

// 「名称 → ID」のマップを両表記で作る
const tagIdByName = new Map();
for (const t of tagList) {
  const name = String(t.name);
  const fullWidth = name.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");
  const halfWidth = name.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");
  tagIdByName.set(name, t.id);
  tagIdByName.set(fullWidth, t.id);
  tagIdByName.set(halfWidth, t.id);
}

// ---- Step ラベル（UI用） ----
const STEP_LABELS = {
  0: "基本情報",
  0.5: "基本情報",
  1: "基本情報",
  2: "転職理由",
  3: "絶対条件",
  4: "希望条件",
  5: "これまで（Can）",
  6: "これから（Will）",
  7: "完了",
};

// ---- 転職理由カテゴリ（深掘りQ & 候補） ----
const transferReasonFlow = {
  "経営・組織に関すること": {
    keywords: ["理念","方針","価値観","経営","運営","マネジメント","方向性","ビジョン","ミッション","考え方","姿勢","経営陣","トップ","風通し","意見","発言","評価制度","評価","昇給","昇格","公平","基準","教育体制","研修","マニュアル","OJT","フォロー","教育","サポート","経営者","医療職","現場理解","売上","数字"],
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
    keywords: ["人間関係","職場の雰囲気","上司","先輩","同僚","チームワーク","いじめ","パワハラ","セクハラ","陰口","派閥","お局","理不尽","相談できない","孤立","コミュニケーション","ロールモデル","尊敬","憧れ","見習いたい","価値観","温度感","やる気","信頼","品格","一貫性","目標","手本","職種","連携","助け合い","壁","分断","古株","権力","圧","支配"],
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
    keywords: ["スキルアップ","成長","挑戦","やりがい","業務内容","専門性","研修","教育","キャリア","昇進","昇格","資格取得","経験","学べる","新しい","幅を広げる","強み","活かす","資格","得意","未経験","分野","患者","利用者","貢献","実感","書類","件数","役立つ","ありがとう","責任","役職","機会","道筋","登用"],
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
    keywords: ["残業","夜勤","休日","有給","働き方","時間","シフト","勤務時間","連勤","休憩","オンコール","呼び出し","副業","兼業","社会保険","保険","健保","厚生年金","診療時間","自己研鑽","勉強","学習","研修時間","直行直帰","事務所","立ち寄り","朝礼","日報","定時","サービス残業","申請制","人員配置","希望日","半休","時間有休","承認","就業規則","許可","健康保険","雇用保険","労災","手続き","始業前","準備","清掃","打刻"],
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
    keywords: ["家庭","育児","子育て","両立","ライフステージ","子ども","家族","介護","保育園","送迎","学校行事","通院","発熱","中抜け","時短","イベント","飲み会","BBQ","社員旅行","早朝清掃","強制","業務外","就業後","休日","オフ","プライベート","仲良く","交流","ごはん","趣味"],
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
    step: 0,
    isNumberConfirmed: false,
    drill: { phase: null, count: 0, category: null, awaitingChoice: false, options: [] },
    status: {
  number: "",
  role: "",
  place: "",
  reason: "",
  reason_tag: "",
  must: [],
  want: [],
  must_ids: [],   // ←これ追加
  want_ids: [],   // ←これ追加
  can: "",
  will: "",
  memo: { reason_raw: "", must_raw: [], want_raw: [] },
},
  };
}

// ---- 入口 ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { message = "", sessionId = "default" } = req.body || {};
  const text = String(message || "").trim();

  const s = sessions[sessionId] ?? (sessions[sessionId] = initSession());

  if (!s.status.must_ids) s.status.must_ids = [];
  if (!s.status.want_ids) s.status.want_ids = [];

  // ID再質問ガード
  const looksId = /^\s*\d{4,8}\s*$/.test(text);
  if (s.isNumberConfirmed && (s.step === 0 || s.step == null)) s.step = 0.5;
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

  // ---- Step0：求職者ID ----
  if (s.step === 0) {
    if (!looksId) {
      return res.json(withMeta({
        response: "こんにちは！\n最初に【求職者ID】を教えてね。※IDは『メール』で届いているやつ（LINEじゃないよ）。",
        step: 0, status: s.status, isNumberConfirmed: false, candidateNumber: "", debug: debugState(s)
      }, 0));
    }
    s.status.number = text.replace(/\s+/g, "");
    s.isNumberConfirmed = true;
    s.step = 0.5;
    return res.json(withMeta({
      response: "OK、求職者ID確認したよ！\nまず【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など",
      step: 0.5, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 0.5));
  }

  // ---- Step0.5：職種（所有資格） ----
  if (s.step === 0.5) {
    s.status.role = text || "";
    if (/(介護|ヘルパー)/.test(text) && !/(初任者|実務者|介護福祉士)/.test(text)) {
      s.step = 0.55;
      return res.json(withMeta({
        response: "介護系なんだね！\n初任者研修や実務者研修、介護福祉士などの資格は持ってる？なければ「ない」でOK！",
        step: 0.55, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 0.5));
    }
    s.step = 1;
    return res.json(withMeta({
      response: "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）○○病院 外来／△△クリニック",
      step: 1, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 1));
  }
  if (s.step === 0.55) {
    s.status.role = `${s.status.role}（資格確認:${text || "未回答"}）`;
    s.step = 1;
    return res.json(withMeta({
      response: "OK！じゃあ次に【今どこで働いてる？】を教えてね。\n（例）○○病院 外来／△△クリニック",
      step: 1, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 1));
  }

  // ---- Step1：現職 ----
  if (s.step === 1) {
    s.status.place = text || "";
    s.step = 2;
    s.drill = { phase: "reason", count: 0, category: null, awaitingChoice: false, options: [] };
    return res.json(withMeta({
      response: "はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
      step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 2));
  }

  // ---- Step2：転職理由（深掘り2回→候補提示） ----
  if (s.step === 2) {
    if (s.drill.phase === "reason" && s.drill.awaitingChoice && s.drill.options?.length) {
      const pick = normalizePick(text);
      const chosen = s.drill.options.find(o => o === pick);
      if (chosen) {
        const empathy = "なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎";
        const repeat = `つまり『${chosen}』ってことだね！`;
        s.status.reason_tag = chosen;
        s.step = 3;
        return res.json(withMeta({
          response: `${empathy}\n${repeat}\n\n${mustIntroText()}`,
          step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
        }, 3));
      }
      return res.json(withMeta({
        response: `ごめん、もう一度教えて！この中だとどれが一番近い？『${s.drill.options.map(x=>`［${x}］`).join("／")}』`,
        step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 2));
    }

    if (s.drill.count === 0) {
      s.status.reason = text || "";
      s.status.memo.reason_raw = text || "";
      const cat = pickReasonCategory(text);
      if (!cat || noOptionCategory(cat)) {
        const empathy = "なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎";
        s.step = 3;
        return res.json(withMeta({
          response: `${empathy}\n\n${mustIntroText()}`,
          step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
        }, 3));
      }
      s.drill.category = cat;
      s.drill.count = 1;
      const q = transferReasonFlow[cat].deep1[0] || "それについて、もう少し詳しく教えて！";
      return res.json(withMeta({
        response: q, step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 2));
    }

    if (s.drill.count === 1) {
      s.drill.count = 2;
      const cat = s.drill.category;
      const q = transferReasonFlow[cat].deep2[0] || "なるほど。他に具体例があれば教えて！";
      return res.json(withMeta({
        response: q, step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 2));
    }

    if (s.drill.count === 2) {
      const cat = s.drill.category;
      const options = (transferReasonFlow[cat].internal_options || []).slice(0, 3);
      if (!options.length) {
        const empathy = "なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎";
        s.step = 3;
        return res.json(withMeta({
          response: `${empathy}\n\n${mustIntroText()}`,
          step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
        }, 3));
      }
      s.drill.awaitingChoice = true;
      s.drill.options = options;
      return res.json(withMeta({
        response: `この中だとどれが一番近い？『${options.map(x=>`［${x}］`).join("／")}』`,
        step: 2, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
      }, 2));
    }
  }

  // ---- Step3：絶対に外せない条件（Must） ----
if (s.step === 3) {
  if (isNone(text)) {
    s.step = 4;
    return res.json(withMeta({
      response: "ありがとう！それじゃあ次は【あったらいいな（希望条件）】を教えてね。",
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  const tags = matchTags(text, mustWantItems);
  if (tags.length) {
    const added = [];
    for (const t of tags.slice(0, 3)) {
      if (!s.status.must.includes(t)) { s.status.must.push(t); added.push(t); }
    }

    // ID ひも付け（Must）
    for (const label of added) {
  const id = tagIdByName.get(label);
  if (id && !s.status.must_ids.includes(id)) s.status.must_ids.push(id);
}

    const line = added.map(t => `そっか、『${t}』が絶対ってことだね！`).join("\n");
    return res.json(withMeta({
      response: `${line}\n他にも絶対条件はある？（なければ「ない」って返してね）`,
      step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 3));
  }

  s.status.memo.must_raw ??= [];
  s.status.memo.must_raw.push(text);
  return res.json(withMeta({
    response: "そっか、わかった！大事な希望だね◎\n他にも絶対条件はある？（なければ「ない」って返してね）",
    step: 3, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 3));
}

// ---- Step4：あったらいいな（Want） ----
if (s.step === 4) {
  if (isNone(text)) {
    s.step = 5;
    return res.json(withMeta({
      response: "質問は残り2つ！\nまずは【いま出来ること・得意なこと（Can）】を教えてね。自由に書いてOKだよ。",
      step: 5, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 5));
  }

  const tags = matchTags(text, mustWantItems);
  if (tags.length) {
    const added = [];
    for (const t of tags.slice(0, 3)) {
      if (!s.status.want.includes(t)) { s.status.want.push(t); added.push(t); }
    }

    // ID ひも付け（Want）
    for (const label of added) {
  const id = tagIdByName.get(label);
  if (id && !s.status.want_ids.includes(id)) s.status.want_ids.push(id);
}

    const line = added.map(t => `了解！『${t}』だと嬉しいってことだね！`).join("\n");
    return res.json(withMeta({
      response: `${line}\n他にもあったらいいなっていうのはある？（なければ「ない」って返してね）`,
      step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 4));
  }

  s.status.memo.want_raw ??= [];
  s.status.memo.want_raw.push(text);
  return res.json(withMeta({
    response: "了解！気持ちは受け取ったよ◎\n他にもあったらいいなっていうのはある？（なければ「ない」って返してね）",
    step: 4, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
  }, 4));
}
  // ---- Step5：Can ----
  if (s.step === 5) {
    s.status.can = text || "";
    s.step = 6;
    return res.json(withMeta({
      response: "これが最後の質問👏\n【これから挑戦したいこと（Will）】を教えてね。自由に書いてOKだよ。",
      step: 6, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 6));
  }

  // ---- Step6：Will ----
  if (s.step === 6) {
    s.status.will = text || "";
    s.step = 7;
    return res.json(withMeta({
      response: "今日はたくさん話してくれてありがとう！\n整理した内容は担当エージェントにしっかり共有するね。面談でさらに具体化していこう！",
      step: 7, status: s.status, isNumberConfirmed: true, candidateNumber: s.status.number, debug: debugState(s)
    }, 7));
  }

  // ここには来ない想定（フォールバック廃止）
  return res.json(withMeta({
    response: "（内部エラー）", step: s.step, status: s.status, isNumberConfirmed: s.isNumberConfirmed, candidateNumber: s.status.number, debug: debugState(s)
  }, s.step));
}

// ---- ヘルパ ----
function withMeta(payload, step) {
  const statusBar = buildStatusBar(payload.status);
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
function buildStatusBar(st) {
  return {
    求職者ID: st.number || "",
    職種: st.role || "",
    現職: st.place || "",
    転職目的: st.reason_tag ? st.reason_tag : (st.reason ? "済" : ""),
    Must: st.must.length ? `${st.must.length}件` : (st.memo?.must_raw?.length ? "済" : ""),
    Want: st.want.length ? `${st.want.length}件` : (st.memo?.want_raw?.length ? "済" : ""),
    Can: st.can ? "済" : "",
    Will: st.will ? "済" : "",
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
function nextAfterId(s) {
  switch (s.step) {
    case 0.5:
      return "IDは確認済だよ！まず【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など";
    case 1:
      return "IDは確認済だよ！次に【今どこで働いてる？】を教えてね。\n（例）○○病院 外来／△△クリニック";
    case 2:
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
