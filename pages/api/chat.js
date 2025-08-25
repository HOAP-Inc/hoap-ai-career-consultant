// pages/api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ─────────────────────────────────────────────────────────
 *  セッション管理（メモリ簡易版：デモ用）
 *  本番は外部ストアへ移行推奨
 *  ───────────────────────────────────────────────────────── */
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      // Step0
      candidateNumber: "",
      askedQualification: false,
      askedWorkplace: false,
      qualificationText: "",
      workplaceText: "",

      // Step1以降で渡すメモ
      transferReason: "",
      mustConditions: [],
      wantConditions: [],
      canDo: "",
      willDo: "",

      // 内部原文メモ（未マッチ保持用）
      notes: [],
    });
  }
  return sessions.get(id);
}

/** ─────────────────────────────────────────────────────────
 *  所有資格タグ（例）
 *  ※「職種→所有資格タグ整合」の最低限辞書
 *  ───────────────────────────────────────────────────────── */
const QUAL_TAGS = [
  "正看護師",
  "准看護師",
  "介護福祉士",
  "実務者研修",
  "初任者研修",
  "理学療法士",
  "作業療法士",
  "言語聴覚士",
  "管理栄養士",
  "栄養士",
  "歯科衛生士",
  "歯科技工士",
  "保育士",
];

const CARE_WORDS = ["介護", "ヘルパー", "デイ", "老健", "特養", "サ高住", "グループホーム"];

/** ─────────────────────────────────────────────────────────
 *  API ハンドラ
 *  ───────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const {
    message = "",
    conversationHistory = [],
    currentStep = 0,
    candidateNumber = "",
    isNumberConfirmed = false,
    sessionId = "default",
  } = req.body;

  const text = String(message || "").trim();
  const s = getSession(sessionId);

  /* ── Step0: 求職者ID → 職種（所有資格） → 現職 ───────────────── */
  if (currentStep === 0) {
    // まだID未確定：数値抽出して確定
    if (!isNumberConfirmed || !s.candidateNumber) {
      const m = text.match(/\d{3,}/);
      if (!m) {
        return res.json({
          response:
            "すみません、最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！",
          step: 0,
        });
      }
      // ★ 修正：ID確定時に職種質問モードへ遷移するためのフラグ初期化
      s.candidateNumber = m[0];
      s.askedQualification = false;
      s.askedWorkplace = false;

      return res.json({
        response:
          `OK、求職者ID：${s.candidateNumber} で確認したよ！\nまず【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など`,
        step: 0,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: true,
      });
    }

    // 職種（所有資格）をまだ聞いていない
    if (!s.askedQualification) {
      s.qualificationText = text;

      const matchedTag = QUAL_TAGS.find((tag) => s.qualificationText.includes(tag));
      const hasCareWord = CARE_WORDS.some((w) => s.qualificationText.includes(w));

      if (matchedTag) {
        // タグ整合OK → 次は現職
        s.askedQualification = true;
        return res.json({
          response:
            "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック／訪問看護／老健 など",
          step: 0,
        });
      }

      // 介護系ワードだけ来た：資格の有無を確認（確定はまだ）
      if (hasCareWord) {
        return res.json({
          response:
            "介護系なんだね！資格はどうかな？\n「初任者研修」「実務者研修」「介護福祉士」のどれかは持ってる？ それとも無資格？",
          step: 0,
        });
      }

      // 未マッチ：内部メモ保持して次へ（UIは「未入力」扱いでOK）
      s.notes.push({ field: "qualification", text: s.qualificationText });
      s.askedQualification = true;
      return res.json({
        response:
          "受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック／訪問看護／老健 など",
        step: 0,
      });
    }

    // 現職（勤務先）をまだ聞いていない
    if (!s.askedWorkplace) {
      s.workplaceText = text;
      s.askedWorkplace = true;

      // ★ Step1 固定セリフ（完全一致版）
      return res.json({
        response:
          "ありがとう！\n\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎",
        step: 1,
      });
    }
  }

  /* ── Step1 以降：既存の会話制御（ベースは維持） ──────────────── */
  // このプロンプトは従来どおり。必要なセッション情報だけ埋め込む
  const systemPrompt = `あなたは、HOAPの新規事業におけるAIキャリアエージェント「ほーぷちゃん」。
医療・介護・歯科の求職者に一次ヒアリングを行い、登録済み知識に整合させる。
禁止：登録外タグの生成／自然文アレンジでの保存。

セッション概要:
- candidateNumber: ${s.candidateNumber}
- qualificationText: ${s.qualificationText}
- workplaceText: ${s.workplaceText}
- notesCount: ${s.notes.length}

重要: ユーザーの表現はそのまま尊重し、タグ保存時のみ既存のtag_labelを使うこと。`;

  // 会話履歴構築
  const msgs = [{ role: "system", content: systemPrompt }];
  for (const m of conversationHistory) {
    msgs.push(m.type === "ai" ? { role: "assistant", content: m.content } : { role: "user", content: m.content });
  }
  msgs.push({ role: "user", content: text });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: msgs,
      max_tokens: 800,
      temperature: 0.3,
    });

    const out = completion.choices?.[0]?.message?.content || "すみません、もう一度お願いします。";
    // ステップ進行は従来トリガーで（ここは既存ロジックを温存）
    let nextStep = currentStep;
    if (out.includes("じゃあ次の質問！") && currentStep === 1) nextStep = 2;
    else if (out.includes("それじゃあ次に、こうだったらいいな") && currentStep === 2) nextStep = 3;
    else if (out.includes("質問は残り2つ！") && currentStep === 3) nextStep = 4;
    else if (out.includes("これが最後の質問👏") && currentStep === 4) nextStep = 5;
    else if (out.includes("今日はたくさん話してくれてありがとう！") && currentStep === 5) nextStep = 6;

    return res.json({
      response: out,
      step: nextStep,
    });
  } catch (e) {
    console.error("OpenAI error:", e);
    return res.status(500).json({ message: "Internal server error", error: e?.message || String(e) });
  }
}
