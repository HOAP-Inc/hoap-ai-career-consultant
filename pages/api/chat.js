// pages/api/chat.js
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- セッション（超簡易：メモリ保持のみ / 本番は外部ストアに） ---
const sessions = new Map();
const getSession = (sid) => {
  if (!sessions.has(sid)) {
    sessions.set(sid, {
      // Step0
      candidateNumber: '',
      qualificationText: '', // ユーザー原文
      workplaceText: '',     // ユーザー原文
      // Step1
      transferReasonRaw: '',
      // 流れ制御
      step: 0,
      askedQualification: false,
      askedWorkplace: false,
    });
  }
  return sessions.get(sid);
};

// 所有資格タグ（最小セット：まずは“介護系の判定フロー”に必要なもの）
const QUAL_TAGS = [
  '正看護師', '准看護師',
  '理学療法士', '作業療法士', '言語聴覚士',
  '管理栄養士', '栄養士',
  '介護福祉士', '実務者研修', '初任者研修', '無資格'
];

// 介護ワードを言われたときのフォロー質問
const CARE_WORDS = ['介護', 'ヘルパー', '介護職', '訪問介護', '施設介護'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const {
    message = '',
    sessionId = 'default',
  } = req.body;

  const text = String(message || '').trim();
  const s = getSession(sessionId);

  // -------- Step0：求職者ID → 職種（所有資格）→ 現職 --------
  if (s.step === 0) {
    // まだID未確定
    if (!s.candidateNumber) {
      const m = text.match(/\d{3,}/);
      if (!m) {
        return res.json({
          response:
`こんにちは！
担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。

最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。
IDが確認できたら、そのあとで
・今の職種（所有資格）
・今どこで働いてる？
も続けて聞いていくよ。気楽にどうぞ！`,
          step: 0,
        });
      }
      // ID確定
      s.candidateNumber = m[0];
      return res.json({
        response:
`OK、求職者ID：${s.candidateNumber} で確認したよ！
まず【今の職種（所有資格）】を教えてね。
（例）正看護師／介護福祉士／初任者研修 など`,
        step: 0,
      });
    }

    // 職種（所有資格）まだ
    if (!s.askedQualification) {
      s.qualificationText = text;

      // 介護系ざっくり→ 資格の有無を深掘り
      const hasCareWord = CARE_WORDS.some(w => s.qualificationText.includes(w));
      const matchedTag = QUAL_TAGS.find(tag => s.qualificationText.includes(tag));

      if (matchedTag) {
        s.askedQualification = true;
        return res.json({
          response: `受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック／訪問看護／老健 など`,
          step: 0,
        });
      }

      if (hasCareWord) {
        return res.json({
          response:
`介護系なんだね！資格はどうかな？
「初任者研修」「実務者研修」「介護福祉士」のどれかは持ってる？ それとも無資格？`,
          step: 0,
        });
      }

      // 明確なタグが拾えなかった場合でも先へ（未マッチは内部メモ保持）
      s.askedQualification = true;
      return res.json({
        response: `受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック／訪問看護／老健 など`,
        step: 0,
      });
    }

    // 現職 まだ
    if (!s.askedWorkplace) {
      s.workplaceText = text;
      s.askedWorkplace = true;
      s.step = 1; // Step1へ

      return res.json({
        response:
`ありがとう！

はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？
しんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎`,
        step: 1,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: true,
      });
    }

    // ここに落ちないようにする（汎用レスは置かない）
  }

  // -------- Step1 以降は既存のロジックにつなぐ（ここでは固定プロンプト例） --------
  if (s.step === 1) {
    // 以降の深掘りやタグ確定は既存の実装へ委譲（このレスはダミーではなく入口）
    // 必要に応じて OpenAI 呼び出しをここに実装
    return res.json({
      response: `（転職理由を受け取り中…この後は深掘り→候補提示→確定のフローで進める）`,
      step: 1,
    });
  }

  // フォールバック（原則ここに来ない）
  return res.json({ response: '処理位置がブレたよ。ID→職種→現職の順に返してね。', step: s.step });
}
