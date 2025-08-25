// pages/api/chat.js
// ほーぷちゃん 会話API（フロントは触らない）
// 仕様：
//  Step0: ID確認（メールに届いたID）→ OK後に Step0:sub=job → Step0:sub=place
//  Step1: 転職理由（深掘り2回→候補提示2〜3件→確定）
//  Step2: 絶対条件（Must）辞書マッチ（複数OK・「ない」で次へ）
//  Step3: あったら良い条件（Want）辞書マッチ（複数OK・「ない」で次へ）
//  Step4: できること（Can）テキスト保存（UI表示は「済」）
//  Step5: やりたいこと（Will）テキスト保存（UI表示は「済」）→ クロージング

// --------------- 転職理由カテゴリ（タグは internal_options のみ使用） ---------------
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
    keywords: ["人間関係","職場の雰囲気","上司","先輩","同僚","チームワーク","いじめ","パワハラ","セクハラ","陰口","派閥","お局","理不尽","相談できない","孤立","コミュニケーション","ロールモデル","尊敬","憧れ","見習いたい","価値観","温度感","やる気","信頼","品格","一貫性","目標","手本","連携","助け合い","壁","分断","古株","権力","圧","支配"],
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
  "職場環境・設備": { keywords: ["設備","環境","施設","器械","機器","システム","IT","デジタル","古い","新しい","最新","設置","導入","整備"], internal_options: [], deep1: [], deep2: [] },
  "職場の安定性": { keywords: ["安定","将来性","経営状況","倒産","リストラ","不安","継続","持続","成長","発展","将来","先行き"], internal_options: [], deep1: [], deep2: [] },
  "給与・待遇": { keywords: ["給料","給与","年収","月収","手取り","賞与","ボーナス","昇給","手当","待遇","福利厚生","安い","低い","上がらない","生活できない","お金"], internal_options: [], deep1: [], deep2: [] },
};

// --------------- Must / Want 辞書（タグ名そのまま使用） ---------------
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

// --------------- セッション管理（簡易・プロセス内） ---------------
const sessions = new Map();
const initSession = (id) => {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 0,
      sub: "id", // id -> job -> place
      status: {
        id: "未入力",
        job: "未入力",     // 職種（所有資格）※タグ化は別仕様で
        place: "未入力",   // 勤務先
        reason: "未入力",  // 転職理由（tag_label確定後に反映）
        must: [],          // タグ配列
        want: [],          // タグ配列
        can: "未入力",     // UIでは「済」表示想定
        will: "未入力",    // UIでは「済」表示想定
      },
      memo: { rawJobText:"", rawPlaceText:"", rawReasonText:"", can:"", will:"" },
      // Step1用
      deepCount: 0,
      currentCategory: null,
      awaitingChoice: false,
      choiceList: [], // ["A","B","C"]実体
    });
  }
  return sessions.get(id);
};

// --------------- ユーティリティ ---------------
const read = (v="") => String(v || "").trim();
const hasNoMore = (t) => /^(ない|なし|もうない|大丈夫|特にない|以上)$/i.test(read(t));

const extractId = (t) => {
  const m = read(t).match(/\d{3,}/);
  return m ? m[0] : null;
};

const splitJobAndPlace = (t) => {
  const s = read(t);
  if (s.includes("／")) {
    const [job, ...rest] = s.split("／");
    return { job: read(job) || "未入力", place: read(rest.join("／")) || "未入力" };
  }
  // スペースで緩く
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { job: parts[0], place: parts.slice(1).join(" ") };
  return { job: s || "未入力", place: "未入力" };
};

// 転職理由：カテゴリ推定（最初に強く当たるもの1つ）
const guessCategory = (t) => {
  const s = read(t);
  let best = null, score = 0;
  for (const [cat, def] of Object.entries(transferReasonFlow)) {
    const hit = (def.keywords || []).reduce((acc, kw) => acc + (s.includes(kw) ? 1 : 0), 0);
    if (hit > score) { score = hit; best = cat; }
  }
  return score > 0 ? best : null;
};

// 候補提示：内部候補から2〜3件（上限3）
const pickOptions = (cat) => {
  const opts = (transferReasonFlow[cat]?.internal_options || []).slice(0, 3);
  return opts.slice(0, Math.max(2, Math.min(3, opts.length))); // 2〜3件
};

// テキストから mustWantItems を含むタグを抽出（重複排除）
const findMustWantTags = (t) => {
  const s = read(t);
  const hits = [];
  for (const tag of mustWantItems) {
    if (s.includes(tag)) hits.push(tag);
  }
  return Array.from(new Set(hits));
};

// 選択肢プロンプトの整形
const formatChoices = (list) => {
  // 『［A］／［B］／［C］』
  return `『［${list.join("］／［")}］』`;
};

// --------------- ハンドラ ---------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const { message = "", sessionId = "default" } = req.body || {};
    const text = read(message);
    const sess = initSession(sessionId);

    // ===== Step0: ID → job → place =====
    if (sess.step === 0) {
      if (sess.sub === "id") {
        const id = extractId(text);
        if (!id) {
          return res.json({
            response: "最初に【求職者ID】を教えてね。※IDは「メール」に届いているものだよ（LINEじゃないよ）",
            step: 0,
            status: sess.status,
          });
        }
        sess.status.id = id;
        sess.sub = "job";
        return res.json({
          response: "OK、求職者ID確認したよ！\nつづいて【今の職種（所有資格）】を教えてね。\n（例）正看護師",
          step: 0,
          status: sess.status,
        });
      }
      if (sess.sub === "job") {
        if (!text) {
          return res.json({
            response: "【今の職種（所有資格）】を教えてね。（例）正看護師",
            step: 0,
            status: sess.status,
          });
        }
        const { job } = splitJobAndPlace(text);
        sess.status.job = job || "未入力";
        sess.memo.rawJobText = text;
        sess.sub = "place";
        return res.json({
          response: "【今どこで働いてる？】を教えてね。（例）〇〇病院 外来／〇〇クリニック",
          step: 0,
          status: sess.status,
        });
      }
      if (sess.sub === "place") {
        const { place } = splitJobAndPlace(text);
        sess.status.place = place || "未入力";
        sess.memo.rawPlaceText = text;
        // Step1へ
        sess.step = 1;
        sess.sub = null;
        return res.json({
          response:
            "はじめに、今回の【転職理由】を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
          step: 1,
          status: sess.status,
        });
      }
    }

    // ===== Step1: 転職理由（深掘り→候補提示→確定） =====
    if (sess.step === 1) {
      // すでに候補提示済みで選択待ち
      if (sess.awaitingChoice && sess.choiceList.length) {
        const picked = sess.choiceList.find((c) => text.includes(c));
        if (picked) {
          // 〔共感→復唱→保存〕
          sess.status.reason = picked; // tag_label そのまま
          sess.memo.rawReasonText && (sess.memo.rawReasonText = sess.memo.rawReasonText); // 内部保持（そのまま）
          // 次へ
          sess.step = 2;
          sess.awaitingChoice = false;
          sess.choiceList = [];
          return res.json({
            response: `なるほど、それは大事だよね！\nつまり『${picked}』ってことだね！保存しておくね。\n\nありがとう！じゃあ次は、【絶対に外せない条件】を教えてね。タグにある言葉で書いても、自由に書いてもOKだよ。`,
            step: 2,
            status: sess.status,
          });
        }
        // 違う返答 → 選び直し要求（再提示）
        return res.json({
          response: `ごめん、選択肢から選んでね。この中だとどれが一番近い？ ${formatChoices(sess.choiceList)}`,
          step: 1,
          status: sess.status,
        });
      }

      // まだ深掘り段階
      if (sess.deepCount < 2) {
        // 最初の入力でカテゴリ推定
        if (sess.deepCount === 0) {
          sess.memo.rawReasonText = text; // 原文保持
          const cat = guessCategory(text);
          sess.currentCategory = cat;
          // カテゴリ別の深掘り1回目 or 汎用
          const q =
            (cat && transferReasonFlow[cat].deep1[0]) ||
            "そのことについて、もう少し詳しく教えてもらっていい？";
          sess.deepCount++;
          return res.json({
            response: q,
            step: 1,
            status: sess.status,
          });
        }
        // 2回目の深掘り
        if (sess.deepCount === 1) {
          const cat = sess.currentCategory || guessCategory(text);
          sess.currentCategory = cat;
          const q =
            (cat && transferReasonFlow[cat].deep2[0]) ||
            "なるほど。具体的にはどんな場面でそう感じた？";
          sess.deepCount++;
          return res.json({
            response: q,
            step: 1,
            status: sess.status,
          });
        }
      }

      // 3回目（=ユーザー発話後）は候補提示
      if (sess.deepCount >= 2) {
        const cat = sess.currentCategory || guessCategory(text);
        // マッチしない場合（未マッチ処理）
        if (!cat || !(transferReasonFlow[cat]?.internal_options?.length)) {
          // 「給与・待遇」「職場環境・設備」「職場の安定性」にも内部候補なし → 共感のみ
          sess.step = 2; // ステップは進める
          return res.json({
            response:
              "なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n\nありがとう！じゃあ次は、【絶対に外せない条件】を教えてね。",
            step: 2,
            status: sess.status,
          });
        }
        // 候補提示（2〜3件固定）
        const options = pickOptions(cat);
        sess.choiceList = options;
        sess.awaitingChoice = true;
        return res.json({
          response: `この中だとどれが一番近い？ ${formatChoices(options)}`,
          step: 1,
          status: sess.status,
        });
      }
    }

    // ===== Step2: Must（辞書マッチ） =====
    if (sess.step === 2) {
      if (hasNoMore(text)) {
        // 次へ
        sess.step = 3;
        return res.json({
          response: "ありがとう！それじゃあ次は、【あったら良い条件】を教えてね。",
          step: 3,
          status: sess.status,
        });
      }
      const hits = findMustWantTags(text);
      if (hits.length === 0) {
        // 未マッチ
        return res.json({
          response: "そっか、わかった！大事な希望だね◎\n他にも絶対条件はある？（なければ「ない」でOK）",
          step: 2,
          status: sess.status,
        });
      }
      // マッチしたタグを1つずつ確定（複数OK）
      const added = [];
      for (const tag of hits) {
        if (!sess.status.must.includes(tag)) {
          sess.status.must.push(tag);
          added.push(tag);
        }
      }
      const msg = added.length
        ? `そっか、${added[0]}が絶対ってことだね！` // 1件目のフォーマット提示（複数でも1件ずつの想定）
        : "追加はなかったみたいだね。";
      return res.json({
        response: `${msg}\n他にも絶対条件はある？（なければ「ない」でOK）`,
        step: 2,
        status: sess.status,
      });
    }

    // ===== Step3: Want（辞書マッチ） =====
    if (sess.step === 3) {
      if (hasNoMore(text)) {
        // 次へ
        sess.step = 4;
        return res.json({
          response: "質問は残り2つ！まずは、【今できること・得意なこと】を自由に教えてね。",
          step: 4,
          status: sess.status,
        });
      }
      const hits = findMustWantTags(text);
      if (hits.length === 0) {
        // 未マッチ
        return res.json({
          response: "了解！気持ちは受け取ったよ◎\n他にもあったら良い条件はある？（なければ「ない」でOK）",
          step: 3,
          status: sess.status,
        });
      }
      const added = [];
      for (const tag of hits) {
        if (!sess.status.want.includes(tag)) {
          sess.status.want.push(tag);
          added.push(tag);
        }
      }
      const msg = added.length
        ? `了解！${added[0]}だと嬉しいってことだね！`
        : "追加はなかったみたいだね。";
      return res.json({
        response: `${msg}\n他にもあったら良い条件はある？（なければ「ない」でOK）`,
        step: 3,
        status: sess.status,
      });
    }

    // ===== Step4: Can（自由記述→保存） =====
    if (sess.step === 4) {
      if (text) {
        sess.memo.can = text;
        sess.status.can = "済"; // UIは「済」を表示
      }
      // 次へ
      sess.step = 5;
      return res.json({
        response: "OK！じゃあ最後に、【これからやりたいこと】を教えてね。自由に書いて大丈夫！",
        step: 5,
        status: sess.status,
      });
    }

    // ===== Step5: Will（自由記述→保存→締め） =====
    if (sess.step === 5) {
      if (text) {
        sess.memo.will = text;
        sess.status.will = "済";
      }
      return res.json({
        response:
          "今日はたくさん話してくれてありがとう！整理はほーぷちゃんが担当エージェントにしっかり共有するね。\nこのあとの日程調整や紹介は、担当から連絡するよ！",
        step: 5,
        status: sess.status,
      });
    }

    // 予期しない状態でも落ちずに返す（現ステップ維持）
    return res.json({
      response: "了解！続き、同じ流れで教えてね。",
      step: sess.step,
      status: sess.status,
    });
  } catch (e) {
    console.error("API error:", e);
    return res.status(500).json({ message: "Internal server error", error: String(e?.message || e) });
  }
}
