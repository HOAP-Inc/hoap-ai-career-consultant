// pages/api/chat.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 転職理由分類データ（元プロンプト完全準拠）
const transferReasonFlow = {
  "経営・組織に関すること": {
    "keywords": ["理念", "方針", "価値観", "経営", "運営", "マネジメント", "方向性", "ビジョン", "ミッション", "考え方", "姿勢", "経営陣", "トップ", "風通し", "意見", "発言", "評価制度", "評価", "昇給", "昇格", "公平", "基準", "教育体制", "研修", "マニュアル", "OJT", "フォロー", "教育", "サポート", "経営者", "医療職", "現場理解", "売上", "数字"],
    "internal_options": [
      "MVV・経営理念に共感できる職場で働きたい",
      "風通しがよく意見が言いやすい職場で働きたい", 
      "評価制度が導入されている職場で働きたい",
      "教育体制が整備されている職場で働きたい",
      "経営者が医療職のところで働きたい",
      "経営者が医療職ではないところで働きたい"
    ],
    "deepDrill": [
      ["経営方針で特に合わないと感じる部分は？", "組織の体制で困ってることがある？", "評価や教育面で不満がある？"],
      ["それって改善されそうにない感じ？", "他のスタッフも同じように感じてる？", "具体的にはどんな場面で一番感じる？"]
    ]
  },
  "働く仲間に関すること": {
    "keywords": ["人間関係", "職場の雰囲気", "上司", "先輩", "同僚", "チームワーク", "いじめ", "パワハラ", "セクハラ", "陰口", "派閥", "お局", "理不尽", "相談できない", "孤立", "コミュニケーション", "ロールモデル", "尊敬", "憧れ", "見習いたい", "価値観", "温度感", "やる気", "信頼", "品格", "一貫性", "目標", "手本", "職種", "連携", "助け合い", "壁", "分断", "古株", "権力", "圧", "支配"],
    "internal_options": [
      "人間関係のトラブルが少ない職場で働きたい",
      "同じ価値観を持つ仲間と働きたい", 
      "尊敬できる上司・経営者と働きたい",
      "ロールモデルとなる上司や先輩がほしい",
      "職種関係なく一体感がある仲間と働きたい",
      "お局がいない職場で働きたい"
    ],
    "deepDrill": [
      ["具体的にはどんな人間関係で困ってるの？", "上司や先輩との関係？それとも同僚との関係？", "職場の雰囲気が悪いってこと？"],
      ["それって毎日続いてる感じ？", "相談できる人はいない状況？", "チームワークの面でも困ってることある？"]
    ]
  },
  "仕事内容・キャリアに関すること": {
    "keywords": ["スキルアップ", "成長", "挑戦", "やりがい", "業務内容", "専門性", "研修", "教育", "キャリア", "昇進", "昇格", "資格取得", "経験", "学べる", "新しい", "幅を広げる", "経験", "強み", "活かす", "資格", "得意", "未経験", "分野", "患者", "利用者", "貢献", "実感", "書類", "件数", "役立つ", "ありがとう", "責任", "役職", "機会", "道筋", "登用"],
    "internal_options": [
      "今までの経験や自分の強みを活かしたい",
      "未経験の仕事／分野に挑戦したい",
      "スキルアップしたい",
      "患者・利用者への貢献実感を感じられる仕事に携われる",
      "昇進・昇格の機会がある"
    ],
    "deepDrill": [
      ["今の仕事内容で物足りなさを感じてる？", "キャリアアップの機会がない？", "やりがいを感じられない？"],
      ["どんな仕事だったらやりがいを感じられそう？", "スキルアップの機会が欲しい？", "もっと責任のある仕事をしたい？"]
    ]
  },
  "労働条件に関すること": {
    "keywords": ["残業", "夜勤", "休日", "有給", "働き方", "時間", "シフト", "勤務時間", "連勤", "休憩", "オンコール", "呼び出し", "副業", "兼業", "社会保険", "保険", "健保", "厚生年金", "診療時間", "自己研鑽", "勉強", "学習", "研修時間", "直行直帰", "事務所", "立ち寄り", "朝礼", "日報", "定時", "サービス残業", "申請制", "人員配置", "希望日", "半休", "時間有休", "承認", "就業規則", "兼業", "許可", "健康保険", "雇用保険", "労災", "手続き", "始業前", "準備", "清掃", "打刻"],
    "internal_options": [
      "直行直帰ができる職場で働きたい",
      "残業のない職場で働きたい", 
      "希望通りに有給が取得できる職場で働きたい",
      "副業OKな職場で働きたい",
      "社会保険を完備している職場で働きたい",
      "診療時間内で自己研鑽できる職場で働きたい",
      "前残業のない職場で働きたい"
    ],
    "deepDrill": [
      ["具体的にはどの辺りが一番きつい？", "時間的なこと？それとも休みの取りづらさ？", "勤務条件で特に困ってることは？"],
      ["それがずっと続いてる状況？", "改善の見込みはなさそう？", "他にも労働条件で困ってることある？"]
    ]
  },
  "プライベートに関すること": {
    "keywords": ["家庭", "育児", "子育て", "両立", "ライフステージ", "子ども", "家族", "介護", "保育園", "送迎", "学校行事", "通院", "発熱", "中抜け", "時短", "イベント", "飲み会", "BBQ", "社員旅行", "早朝清掃", "強制", "業務外", "就業後", "休日", "オフ", "プライベート", "仲良く", "交流", "ごはん", "趣味"],
    "internal_options": [
      "家庭との両立に理解のある職場で働きたい",
      "勤務時間外でイベントがない職場で働きたい", 
      "プライベートでも仲良くしている職場で働きたい"
    ],
    "deepDrill": [
      ["家庭との両立で困ってることがある？", "プライベートの時間が取れない？", "職場のイベントが負担？"],
      ["それって改善の余地はなさそう？", "他にも両立で困ってることある？", "理想的な働き方はどんな感じ？"]
    ]
  },
  "職場環境・設備": {
    "keywords": ["設備", "環境", "施設", "器械", "機器", "システム", "IT", "デジタル", "古い", "新しい", "最新", "設置", "導入", "整備"],
    "internal_options": [],
    "deepDrill": [
      ["どんな設備や環境で困ってる？", "古い機器で作業効率が悪い？", "IT環境が整っていない？"],
      ["それって業務に支障が出てる？", "改善の要望は出したことある？", "他にも設備面で困ることある？"]
    ]
  },
  "職場の安定性": {
    "keywords": ["安定", "将来性", "経営状況", "倒産", "リストラ", "不安", "継続", "持続", "成長", "発展", "将来", "先行き"],
    "internal_options": [],
    "deepDrill": [
      ["経営状況で不安に感じることがある？", "将来性に疑問を感じてる？", "職場の安定性が心配？"],
      ["それって具体的にはどんなことで感じる？", "他のスタッフも同じように不安がってる？", "改善される見込みはなさそう？"]
    ]
  },
  "給与・待遇": {
    "keywords": ["給料", "給与", "年収", "月収", "手取り", "賞与", "ボーナス", "昇給", "手当", "待遇", "福利厚生", "安い", "低い", "上がらない", "生活できない", "お金"],
    "internal_options": [],
    "deepDrill": [
      ["給与面で特に困ってることは？", "昇給の見込みがない？", "福利厚生が充実してない？"],
      ["それって生活に支障が出るレベル？", "他と比較して低いと感じる？", "改善の交渉はしたことある？"]
    ]
  }
};

// mustwant辞書
const mustWantItems = [
  "急性期病棟", "回復期病棟", "慢性期・療養型病院", "一般病院", "地域包括ケア病棟", "療養病棟", 
  "緩和ケア病棟（ホスピス）", "クリニック", "精神科病院", "訪問看護ステーション", 
  "精神科特化型訪問看護ステーション", "機能強化型訪問看護ステーション", "訪問リハビリテーション", 
  "訪問栄養指導", "通所介護（デイサービス）", "認知症対応型通所介護（認知症専門デイサービス）", 
  "地域密着型通所介護（定員18名以下）", "通所リハビリテーション（デイケア）", "訪問介護", 
  "定期巡回・随時対応型訪問介護看護", "訪問入浴", "小規模多機能型居宅介護", "看護小規模多機能型居宅介護", 
  "特別養護老人ホーム", "地域密着型特別養護老人ホーム（定員29名以下）", "介護老人保健施設", 
  "介護付き有料老人ホーム", "ショートステイ（短期入所生活介護）", "サービス付き高齢者向け住宅（サ高住）", 
  "住宅型有料老人ホーム", "軽費老人ホーム（ケアハウス）", "健康型有料老人ホーム", "シニア向け分譲マンション", 
  "放課後等デイサービス", "生活介護（障害者の日中活動）", "就労継続支援A型", "就労継続支援B型", 
  "短期入所（障害者向けショートステイ）", "歯科クリニック", "訪問歯科", "歯科口腔外科（病院内診療科）", 
  "大学病院歯科・歯学部附属病院", "歯科技工所", "院内ラボ", "保育園", "幼稚園", 
  "企業（産業保健・企業内看護など）", "4週8休以上", "育児支援あり", "年間休日120日以上", 
  "週1日からOK", "週2日からOK", "土日祝休み", "家庭都合休OK", "月1シフト提出", 
  "毎週～隔週シフト提出", "有給消化率ほぼ100%", "長期休暇あり", "週休2日", "週休3日", 
  "日勤のみ可", "夜勤専従あり", "2交替制", "3交替制", "午前のみ勤務", "午後のみ勤務", 
  "残業ほぼなし", "オンコールなし・免除可", "緊急訪問なし", "時差出勤導入", "フレックスタイム制度あり", 
  "残業月20時間以内", "スキマ時間勤務", "時短勤務相談可", "駅近（5分以内）", "車通勤可", 
  "バイク通勤可", "自転車通勤可", "駐車場完備", "直行直帰OK", "年収300万以上", "年収350万以上", 
  "年収400万以上", "年収450万以上", "年収500万以上", "年収550万以上", "年収600万以上", 
  "年収650万以上", "年収700万以上", "賞与あり", "退職金あり", "寮あり・社宅あり", 
  "託児所・保育支援あり", "社会保険完備", "交通費支給", "扶養控除内考慮", "復職支援", 
  "住宅手当", "副業OK", "日・祝日給与UP", "引越し手当", "緊急訪問時の手当・代休あり", 
  "スマホ・タブレット貸与あり", "電動アシスト自転車・バイク・車貸与", "社割あり", 
  "ハラスメント相談窓口あり", "研修制度あり", "資格取得支援あり", "セミナー参加費補助あり", 
  "マニュアル完備", "動画マニュアルあり", "評価制度あり", "メンター制度あり", "独立・開業支援あり", 
  "院長・分院長候補", "担当制"
];

// セッションデータ管理
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      candidateNumber: '',
      qualification: '',
      workplace: '',
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: '',
      deepDrillCount: 0,
      currentCategory: null,
      awaitingSelection: false,
      selectionOptions: []
    });
  }
  return sessions.get(sessionId);
}

// ランダム選択ヘルパー
function getRandomFromArray(array, count = 1) {
  const shuffled = array.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { 
      message, 
      conversationHistory = [], 
      currentStep = 0, 
      candidateNumber = '', 
      isNumberConfirmed = false, 
      sessionId = 'default'
    } = req.body;

    const session = getSession(sessionId);

    // Step0: 求職者番号チェック
    if (currentStep === 0) {
      if (!isNumberConfirmed) {
        const numberMatch = message.match(/\d+/);
        if (numberMatch) {
          const extractedNumber = numberMatch[0];
          session.candidateNumber = extractedNumber;
          return res.json({
            response: `求職者番号：${extractedNumber} ですね！
他の情報もお聞かせください。
②今の職種③今どこで働いてる？`,
            candidateNumber: extractedNumber,
            isNumberConfirmed: true,
            step: 0
          });
        } else {
          return res.json({
            response: `すみません、最初に求職者番号を教えていただけますか？
①求職者番号②今の職種③今どこで働いてる？
の順でお願いします。`,
            step: 0
          });
        }
      } else {
        // 職種・職場を保存してStep1へ
        session.qualification = message;
        return res.json({
          response: `ありがとう！

はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？
しんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎`,
          step: 1
        });
      }
    }

    // Step1: 転職理由（完全版）
    if (currentStep === 1) {
      // 選択肢への回答チェック
      if (session.awaitingSelection) {
        const selectedOption = session.selectionOptions.find(opt => 
          message.toLowerCase().includes(opt.toLowerCase().substring(0, 15))
        );
        if (selectedOption) {
          session.transferReason = selectedOption;
          session.awaitingSelection = false;
          session.selectionOptions = [];
          return res.json({
            response: `なるほど、それは大事だよね！つまり「${selectedOption}」ってことだね！

ありがとう！

じゃあ次の質問！
今回の転職でこれだけは絶対譲れない！というのを教えて！
仕事内容でも、制度でも、条件でもOK◎

例えば・・・
「絶対土日休みじゃないと困る！」
「絶対オンコールはできない！」

後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
            step: 2
          });
        } else {
          return res.json({
            response: "選択肢の中から選んでいただけますか？",
            step: 1
          });
        }
      }

      // キーワードマッチング処理
      const keywordMatches = {};
      Object.keys(transferReasonFlow).forEach(category => {
        const keywords = transferReasonFlow[category].keywords;
        let matchCount = 0;
        keywords.forEach(keyword => {
          if (message.toLowerCase().includes(keyword.toLowerCase())) {
            matchCount++;
          }
        });
        if (matchCount > 0) {
          keywordMatches[category] = matchCount;
        }
      });

      // 最多マッチカテゴリを特定
      const maxMatches = Math.max(...Object.values(keywordMatches), 0);
      const topCategories = Object.keys(keywordMatches).filter(cat => 
        keywordMatches[cat] === maxMatches
      );

      if (topCategories.length === 0) {
        // 未マッチ処理
        return res.json({
          response: `なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎

ありがとう！

じゃあ次の質問！
今回の転職でこれだけは絶対譲れない！というのを教えて！
仕事内容でも、制度でも、条件でもOK◎

例えば・・・
「絶対土日休みじゃないと困る！」
「絶対オンコールはできない！」

後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
          step: 2
        });
      }

      const selectedCategory = topCategories[0];
      const categoryData = transferReasonFlow[selectedCategory];
      const options = categoryData.internal_options;

      // 禁止カテゴリ（候補が空）の処理
      if (options.length === 0) {
        return res.json({
          response: `なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎

ありがとう！

じゃあ次の質問！
今回の転職でこれだけは絶対譲れない！というのを教えて！
仕事内容でも、制度でも、条件でもOK◎

例えば・・・
「絶対土日休みじゃないと困る！」
「絶対オンコールはできない！」

後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
          step: 2
        });
      }

      // 深掘りまたは候補提示
      if (session.deepDrillCount < 2) {
        session.deepDrillCount++;
        session.currentCategory = selectedCategory;
        
        // カテゴリ別深掘り質問を取得
        const deepDrillQuestions = categoryData.deepDrill[session.deepDrillCount - 1];
        const selectedQuestion = getRandomFromArray(deepDrillQuestions, 1)[0];
        
        return res.json({
          response: selectedQuestion,
          step: 1
        });
      } else {
        // 候補提示（2-3件厳守）
        const candidateOptions = options.slice(0, 3);
        const optionsList = candidateOptions.map((opt, index) => 
          `${index + 1}. ${opt}`
        ).join('\n');
        
        session.awaitingSelection = true;
        session.selectionOptions = candidateOptions;
        
        return res.json({
          response: `この中だとどれが一番近い？

${optionsList}

番号でも、内容でも、どちらでもOKです！`,
          step: 1
        });
      }
    }

    // Step2: 絶対希望（mustWant辞書マッチング）
    if (currentStep === 2) {
      if (message.toLowerCase().includes('ない') || message.toLowerCase().includes('なし')) {
        return res.json({
          response: `ありがとう！

それじゃあ次に、こうだったらいいな、というのを聞いていくね。
これも仕事内容でも、制度でも、条件面でも、条件でもOK◎

例えば・・・
「マイカー通勤ができると嬉しいな」
「できれば夜勤がないといいな」
って感じ！`,
          step: 3
        });
      }

      // mustWant辞書マッチング
      const matchedItems = mustWantItems.filter(item => {
        return message.toLowerCase().includes(item.toLowerCase()) || 
               item.toLowerCase().includes(message.toLowerCase());
      });

      if (matchedItems.length === 0) {
        return res.json({
          response: `そっか、わかった！大事な希望だね◎

他にも絶対条件はある？`,
          step: 2
        });
      }

      const topMatches = matchedItems.slice(0, 3);
      if (topMatches.length === 1) {
        session.mustConditions.push(topMatches[0]);
        return res.json({
          response: `そっか、${topMatches[0]}が絶対ってことだね！

他にも絶対条件はある？`,
          step: 2
        });
      } else {
        const optionsList = topMatches.map((opt, index) => 
          `${index + 1}. ${opt}`
        ).join('\n');
        
        return res.json({
          response: `この中だとどれが一番近い？

${optionsList}

番号でも、内容でも、どちらでもOKです！`,
          step: 2
        });
      }
    }

    // Step3: 希望条件（Step2とほぼ同じロジック）
    if (currentStep === 3) {
      if (message.toLowerCase().includes('ない') || message.toLowerCase().includes('なし')) {
        return res.json({
          response: `質問は残り2つ！
あと少しだから、頑張って😆✨️

次に教えて欲しいのは『これまでやってきたこと』
ここは次回担当エージェントがしっかりヒアリングしていくから、ざっくりでOKだよ。
これまでやってきたことで、これからも活かしたいことを教えてね。`,
          step: 4
        });
      }

      // mustWant辞書マッチング
      const matchedItems = mustWantItems.filter(item => {
        return message.toLowerCase().includes(item.toLowerCase()) || 
               item.toLowerCase().includes(message.toLowerCase());
      });

      if (matchedItems.length === 0) {
        return res.json({
          response: `了解！気持ちは受け取ったよ◎

他にもあったらいいなっていうのはある？`,
          step: 3
        });
      }

      const topMatches = matchedItems.slice(0, 3);
      if (topMatches.length === 1) {
        session.wantConditions.push(topMatches[0]);
        return res.json({
          response: `了解！${topMatches[0]}だと嬉しいってことだね！

他にもあったらいいなっていうのはある？`,
          step: 3
        });
      } else {
        const optionsList = topMatches.map((opt, index) => 
          `${index + 1}. ${opt}`
        ).join('\n');
        
        return res.json({
          response: `この中だとどれが一番近い？

${optionsList}

番号でも、内容でも、どちらでもOKです！`,
          step: 3
        });
      }
    }

    // Step4: Can（これまでやってきたこと）
    if (currentStep === 4) {
      session.canDo = message;
      return res.json({
        response: `いいね！

これが最後の質問👏
今回の転職で叶えたい挑戦や、夢はある？`,
        step: 5
      });
    }

    // Step5: Will（挑戦したいこと）
    if (currentStep === 5) {
      session.willDo = message;
      return res.json({
        response: `今日はたくさん話してくれてありがとう！
ここまでの内容を担当エージェントに引き継ぐね。
次回の面談で一緒に詰めていこう！

📋 **収集データ**
求職者番号: ${session.candidateNumber}
転職理由: ${session.transferReason || '未設定'}
絶対条件: ${session.mustConditions.length > 0 ? session.mustConditions.join(', ') : '未設定'}
希望条件: ${session.wantConditions.length > 0 ? session.wantConditions.join(', ') : '未設定'}
活かしたい経験: ${session.canDo}
挑戦したいこと: ${session.willDo}`,
        step: 6,
        sessionData: session
      });
    }

    // Step6: 完了
    if (currentStep >= 6) {
      return res.json({
        response: "ヒアリングは完了しました。ありがとうございました！",
        step: 6,
        sessionData: session
      });
    }

    return res.json({ 
      response: "申し訳ありません。システムエラーが発生しました。", 
      step: currentStep 
    });

  } catch (error) {
    console.error('Error in chat API:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message 
    });
  }
}
