// pages/api/chat.js
// Next.js (pages router) API Route
// Step0はフロント固定。ここでは Step1〜Step5 の会話制御とタグ整合だけ担当。

// ------- 転職理由 分岐フロー（司令塔） -------
const transferReasonFlow = {
  "経営・組織に関すること": {
    keywords: ["理念","方針","価値観","経営","運営","マネジメント","方向性","ビジョン","ミッション","考え方","姿勢","経営陣","トップ","風通し","意見","発言","評価制度","評価","昇給","昇格","公平","基準","教育体制","研修","マニュアル","OJT","フォロー","教育","サポート","経営者","医療職","現場理解","売上","数字"],
    internal_options: [
      "MVV・経営理念に共感できる職場で働きたい",
      "風通しがよく意見が言いやすい職場で働きたい",
      "評価制度が導入されている職場で働きたい",
      "教育体制が整備されている職場で働きたい",
      "経営者が医療職のところで働きたい",
      "経営者が医療職ではないところで働きたい"
    ]
  },
  "働く仲間に関すること": {
    keywords: ["人間関係","職場の雰囲気","上司","先輩","同僚","チームワーク","いじめ","パワハラ","セクハラ","陰口","派閥","お局","理不尽","相談できない","孤立","コミュニケーション","ロールモデル","尊敬","憧れ","見習いたい","価値観","温度感","やる気","信頼","品格","一貫性","目標","手本","職種","連携","助け合い","壁","分断","古株","権力","圧","支配"],
    internal_options: [
      "人間関係のトラブルが少ない職場で働きたい",
      "同じ価値観を持つ仲間と働きたい",
      "尊敬できる上司・経営者と働きたい",
      "ロールモデルとなる上司や先輩がほしい",
      "職種関係なく一体感がある仲間と働きたい",
      "お局がいない職場で働きたい"
    ]
  },
  "仕事内容・キャリアに関すること": {
    keywords: ["スキルアップ","成長","挑戦","やりがい","業務内容","専門性","研修","教育","キャリア","昇進","昇格","資格取得","経験","学べる","新しい","幅を広げる","強み","活かす","資格","得意","未経験","分野","患者","利用者","貢献","実感","書類","件数","役立つ","ありがとう","責任","役職","機会","道筋","登用"],
    internal_options: [
      "今までの経験や自分の強みを活かしたい",
      "未経験の仕事／分野に挑戦したい",
      "スキルアップしたい",
      "患者・利用者への貢献実感を感じられる仕事に携われる",
      "昇進・昇格の機会がある"
    ]
  },
  "労働条件に関すること": {
    keywords: ["残業","夜勤","休日","有給","働き方","時間","シフト","勤務時間","連勤","休憩","オンコール","呼び出し","副業","兼業","社会保険","保険","健保","厚生年金","診療時間","自己研鑽","勉強","学習","研修時間","直行直帰","事務所","立ち寄り","朝礼","日報","定時","サービス残業","申請制","人員配置","希望日","半休","時間有休","承認","就業規則","兼業","許可","健康保険","雇用保険","労災","手続き","始業前","準備","清掃","打刻"],
    internal_options: [
      "直行直帰ができる職場で働きたい",
      "残業のない職場で働きたい",
      "希望通りに有給が取得できる職場で働きたい",
      "副業OKな職場で働きたい",
      "社会保険を完備している職場で働きたい",
      "診療時間内で自己研鑽できる職場で働きたい",
      "前残業のない職場で働きたい"
    ]
  },
  "プライベートに関すること": {
    keywords: ["家庭","育児","子育て","両立","ライフステージ","子ども","家族","介護","保育園","送迎","学校行事","通院","発熱","中抜け","時短","イベント","飲み会","BBQ","社員旅行","早朝清掃","強制","業務外","就業後","休日","オフ","プライベート","仲良く","交流","ごはん","趣味"],
    internal_options: [
      "家庭との両立に理解のある職場で働きたい",
      "勤務時間外でイベントがない職場で働きたい",
      "プライベートでも仲良くしている職場で働きたい"
    ]
  },
  "職場環境・設備": {
    keywords: ["設備","環境","施設","器械","機器","システム","IT","デジタル","古い","新しい","最新","設置","導入","整備"],
    internal_options: []
  },
  "職場の安定性": {
    keywords: ["安定","将来性","経営状況","倒産","リストラ","不安","継続","持続","成長","発展","将来","先行き"],
    internal_options: []
  },
  "給与・待遇": {
    keywords: ["給料","給与","年収","月収","手取り","賞与","ボーナス","昇給","手当","待遇","福利厚生","安い","低い","上がらない","生活できない","お金"],
    internal_options: []
  }
};

// ------- Must/Want プール（公式タグ名そのまま提示） -------
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

// ------- セッション管理（簡易） -------
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step1: { deep: 0, category: null, awaitingTieBreak: null, fixedTag: null },
      step2: { deep: 0, decided: [], askingMore: false },
      step3: { deep: 0, decided: [] },
    });
  }
  return sessions.get(id);
}

// ------- ユーティリティ -------
function normalize(str = "") {
  return str.replace(/\s+/g, "");
}

function matchTransferCategory(text) {
  const n = normalize(text);
  // 優先ルール：プライベート系
  const privateHit = ["家庭","両立","育児","子ども"].some(k => n.includes(k));
  // スコアリング
  let best = null;
  let bestScore = 0;
  const scores = {};
  Object.entries(transferReasonFlow).forEach(([cat, def]) => {
    let s = 0;
    def.keywords.forEach(k => { if (n.includes(k)) s++; });
    scores[cat] = s;
    if (s > bestScore) { bestScore = s; best = cat; }
  });
  // 同点抽出
  const ties = Object.entries(scores)
    .filter(([_, s]) => s === bestScore && s > 0)
    .map(([c]) => c);

  // 優先処理
  if (privateHit) return { best: "プライベートに関すること", score: scores["プライベートに関すること"] || 0, ties: [] };

  return { best, score: bestScore, ties: ties.length > 1 ? ties : [] };
}

function pickUpTo3(arr = []) {
  return arr.slice(0, 3);
}

function findMustWantMatches(text) {
  const n = normalize(text);
  const hits = mustWantItems.filter(tag => n.includes(normalize(tag)));
  // 重複除去
  return Array.from(new Set(hits)).slice(0, 3);
}

// エンパシー定型（Step1で“未マッチ or 内部候補なし”のときは固定文で必ず返す）
const EMPATHY_FIXED = "なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎";

// ------- ハンドラ -------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { message = "", currentStep = 1, sessionId = 'default', context = {} } = req.body;
    const s = getSession(sessionId);
    const userText = String(message || "").trim();

    // ============ Step1: 転職理由 ============
    if (currentStep === 1) {
      // 既にタイブレイク待ち
      if (s.step1.awaitingTieBreak && (userText === "A" || userText === "B")) {
        const chosen = s.step1.awaitingTieBreak[userText === "A" ? 0 : 1];
        s.step1.category = chosen;
        s.step1.awaitingTieBreak = null;
      }

      // まだカテゴリ未確定なら判定
      if (!s.step1.category) {
        const { best, score, ties } = matchTransferCategory(userText);
        if (!best || score === 0) {
          // 完全未マッチ → 固定セリフのみ（仕様厳守）
          s.step1.deep++;
          if (s.step1.deep >= 2) {
            // 未分類で確定→Step2へ
            return res.json({
              response: `${EMPATHY_FIXED}\n\nじゃあ次の質問！\n今回の転職でこれだけは絶対譲れない！というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
              step: 2
            });
          }
          return res.json({ response: EMPATHY_FIXED, step: 1 });
        }

        // 同点 → タイブレイク
        if (ties.length >= 2) {
          const [a, b] = ties.slice(0, 2);
          s.step1.awaitingTieBreak = [a, b];
          return res.json({
            response:
              `${a} と ${b}、どちらも気になってるんだね。\nどちらが今回の転職で一番重要？\nA) ${a}\nB) ${b}`,
            step: 1
          });
        }

        // 単独ベスト
        s.step1.category = best;
      }

      // カテゴリ確定 → 深掘り or 候補提示
      const cat = s.step1.category;
      const options = transferReasonFlow[cat]?.internal_options || [];

      // 内部候補が空カテゴリの扱い（仕様：候補提示は絶対禁止/固定セリフ）
      if (!options.length) {
        s.step1.deep++;
        if (s.step1.deep >= 2) {
          return res.json({
            response: `${EMPATHY_FIXED}\n\nじゃあ次の質問！\n今回の転職でこれだけは絶対譲れない！というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
            step: 2
          });
        }
        return res.json({ response: EMPATHY_FIXED, step: 1 });
      }

      // 内部候補あり：2回深掘り → 3回目で候補提示
      s.step1.deep++;
      if (s.step1.deep < 3) {
        // 短問で深掘り（軽め）
        return res.json({
          response: `OK、「${cat}」が主なきっかけなんだね。もう少しだけ具体を教えて！どんな場面でそう感じた？（一言でOK）`,
          step: 1
        });
      }

      // 3回目：候補提示（2〜3件）
      const picks = pickUpTo3(options);
      return res.json({
        response:
          `じゃあ、候補をいくつか挙げるね。近いのはどれ？（番号で教えて）\n` +
          picks.map((t, i) => `${i + 1}) ［${t}］`).join("\n"),
        step: 1,
        picks
      });
    }

    // Step1で候補提示後の番号回答ハンドリング（サーバー側で拾う）
    if (currentStep === 1.1 || (currentStep === 1 && /^\d+$/.test(userText))) {
      const picks = req.body.picks || []; // クライアント側で保持して渡してもらえると確実
      const idx = parseInt(userText, 10) - 1;
      const chosen = picks[idx];
      if (!chosen) {
        return res.json({ response: "ごめん、番号でもう一回教えて！（1〜3）", step: 1, picks });
      }
      sessions.get(sessionId).step1.fixedTag = chosen;
      return res.json({
        response:
          `OK！［${chosen}］で確定ね。\n\nじゃあ次の質問！\n今回の転職でこれだけは絶対譲れない！というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
        step: 2
      });
    }

    // ============ Step2: 絶対希望（Must） ============
    if (currentStep === 2) {
      const hits = findMustWantMatches(userText);

      // まず命中を処理
      if (hits.length) {
        sessions.get(sessionId).step2.decided.push(...hits);
        const confirmed = hits.map(h => `［${h}］`).join(" / ");
        return res.json({
          response: `そっか、${confirmed} が絶対ってことだね！\n他にも絶対条件はある？（はい／いいえ）`,
          step: 2
        });
      }

      // はい/いいえ での継続判定
      const yes = /^(はい|ある|うん|ok|おけ|まだある)/i.test(userText);
      const no  = /^(いいえ|ない|なし|もうない|大丈夫)/i.test(userText);

      if (yes) {
        return res.json({
          response: "OK、他に『絶対！』があれば教えて！（タグ名でなくてOK、普通に書いて）",
          step: 2
        });
      }
      if (no) {
        // 次へ
        return res.json({
          response:
            "それじゃあ次に、こうだったらいいな、というのを聞いていくね。\nこれも仕事内容でも、制度でも、条件面でもOK◎\n\n例えば・・・\n「マイカー通勤ができると嬉しいな」\n「できれば夜勤がないといいな」\nって感じ！",
          step: 3
        });
      }

      // マッチなし → 軽い深掘り（最大2回）
      s.step2.deep++;
      if (s.step2.deep <= 2) {
        return res.json({
          response: "了解。対象や水準をもう少しだけ教えて！（例：『土日休み』『直行直帰OK』など）",
          step: 2
        });
      }
      // 3回目：未マッチ扱いで次へ
      return res.json({
        response:
          "そっか、わかった！大事な希望だね◎\n\nそれじゃあ次に、こうだったらいいな、というのを聞いていくね。\nこれも仕事内容でも、制度でも、条件面でもOK◎\n\n例えば・・・\n「マイカー通勤ができると嬉しいな」\n「できれば夜勤がないといいな」\nって感じ！",
        step: 3
      });
    }

    // ============ Step3: できれば希望（Want） ============
    if (currentStep === 3) {
      const hits = findMustWantMatches(userText);

      if (hits.length) {
        sessions.get(sessionId).step3.decided.push(...hits);
        const confirmed = hits.map(h => `［${h}］`).join(" / ");
        return res.json({
          response: `了解！${confirmed} だと嬉しいってことだね！\n他にもある？（はい／いいえ）`,
          step: 3
        });
      }

      const yes = /^(はい|ある|うん|ok|おけ|まだある)/i.test(userText);
      const no  = /^(いいえ|ない|なし|もうない|大丈夫)/i.test(userText);

      if (yes) {
        return res.json({
          response: "OK、他にも『あれば嬉しい』があればどうぞ！（普通に書いてOK）",
          step: 3
        });
      }
      if (no) {
        // Step4 へ
        return res.json({
          response: "質問は残り2つ！\nこれまでやってきたこと（得意・経験・強み）を教えて！",
          step: 4
        });
      }

      // マッチなし → 軽い深掘り（最大2回）
      s.step3.deep++;
      if (s.step3.deep <= 2) {
        return res.json({
          response: "了解。頻度や水準のイメージある？（例：『残業月20h以内』『駅近』など）",
          step: 3
        });
      }
      return res.json({
        response: "了解！気持ちは受け取ったよ◎\n\n質問は残り2つ！\nこれまでやってきたこと（得意・経験・強み）を教えて！",
        step: 4
      });
    }

    // ============ Step4: いままで（Can：原文保持） ============
    if (currentStep === 4) {
      return res.json({
        response: "OK！\nこれが最後の質問👏\nこれからやりたいこと（挑戦したい役割・環境・分野）を教えて！",
        step: 5
      });
    }

    // ============ Step5: これから（Will：原文保持） ============
    if (currentStep === 5) {
      return res.json({
        response:
          "今日はたくさん話してくれてありがとう！\n内容は担当エージェントに共有して、面談でさらに具体化していくね。\nこれで一次ヒアリングは完了だよ！",
        step: 6
      });
    }

    // それ以外はそのまま返す
    return res.json({ response: "OK！続けよう。", step: currentStep });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Internal server error', error: e?.message });
  }
}
