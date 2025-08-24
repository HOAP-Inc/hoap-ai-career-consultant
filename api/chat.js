// api/chat.js  — Vercel Serverless Function（タグ厳密対照）
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 転職理由：内部候補のみ（提示/確定に使える語はこれだけ）
const REASON_OPTIONS = [
  "MVV・経営理念に共感できる職場で働きたい",
  "風通しがよく意見が言いやすい職場で働きたい",
  "評価制度が導入されている職場で働きたい",
  "教育体制が整備されている職場で働きたい",
  "経営者が医療職のところで働きたい",
  "経営者が医療職ではないところで働きたい",
  "人間関係のトラブルが少ない職場で働きたい",
  "同じ価値観を持つ仲間と働きたい",
  "尊敬できる上司・経営者と働きたい",
  "ロールモデルとなる上司や先輩がほしい",
  "職種関係なく一体感がある仲間と働きたい",
  "お局がいない職場で働きたい",
  "今までの経験や自分の強みを活かしたい",
  "未経験の仕事／分野に挑戦したい",
  "スキルアップしたい",
  "患者・利用者への貢献実感を感じられる仕事に携われる",
  "昇進・昇格の機会がある",
  "直行直帰ができる職場で働きたい",
  "残業のない職場で働きたい",
  "希望通りに有給が取得できる職場で働きたい",
  "副業OKな職場で働きたい",
  "社会保険を完備している職場で働きたい",
  "診療時間内で自己研鑽できる職場で働きたい",
  "前残業のない職場で働きたい",
  "家庭との両立に理解のある職場で働きたい",
  "勤務時間外でイベントがない職場で働きたい",
  "プライベートでも仲良くしている職場で働きたい"
];

// must/want：必要十分な抜粋（デモ用：ここに増やせる）
const MW_FLAT = [
  "日勤のみ可","夜勤専従あり","2交替制","3交替制",
  "残業ほぼなし","オンコールなし・免除可","緊急訪問なし",
  "時差出勤導入","フレックスタイム制度あり","残業月20時間以内",
  "駅近（5分以内）","直行直帰OK","車通勤可","バイク通勤可","自転車通勤可","駐車場完備",
  "土日祝休み","週休2日","週休3日","有給消化率ほぼ100%"
];

// 同義語→正式ラベル寄せ（入力のブレ吸収）
const SYN = {
  "オンコールなし":"オンコールなし・免除可",
  "オンコール免除":"オンコールなし・免除可",
  "夜間呼び出しなし":"オンコールなし・免除可",
  "直行直帰":"直行直帰OK",
  "車通勤":"車通勤可",
  "駐車場あり":"駐車場完備",
  "土日休み":"土日祝休み",
  "夜勤なし":"日勤のみ可",
  "残業なし":"残業ほぼなし"
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { stage, message, history = [] } = req.body || {};
    // stage: "reason" | "must" | "want" | "free"（freeはStep4/5）
    const sys = `
あなたはHOAPのAIキャリアエージェント。日本語で短く、明るくテンポよく。
禁止：新しい語の生成・意訳・言い換え・メタ語（タグ/JSON等）。出力は必ずJSONのみ。

要件：
- stage="reason"：reasonTag は ${JSON.stringify(REASON_OPTIONS)} のいずれか/未設定。options は同集合から最大3件。
- stage="must"/"want"：入力文を同義語補正してから ${JSON.stringify(MW_FLAT)} に完全一致するラベルのみを追加。複数可。options は同集合から最大3件。
- stage="free"：タグ化せず reply のみ。

出力フォーマット（必須）：
{
  "reply": "ユーザーへの返答。共感→一言の深掘り or 確認。step遷移のセリフは「ありがとう！」のみ。",
  "reasonTag": "…またはnull",
  "mustTagsAdd": ["…"],   // 追加がなければ []
  "wantTagsAdd": ["…"],   // 追加がなければ []
  "options": ["…"]        // 候補提示 0〜3件（stageに応じた集合内）
}
`.trim();

    const msgs = [
      { role: "system", content: sys },
      { role: "user", content: `stage=${stage}\nhistory=${JSON.stringify(history, null, 2)}\nmessage=${message || ""}` }
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: msgs
    });

    // JSONパース
    let out = {};
    try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}
    if (!out || typeof out !== "object") out = {};

    // サーバー側ガード：集合外は落とす
    const allowReason = new Set(REASON_OPTIONS);
    const allowMW = new Set(MW_FLAT);

    if (stage === "reason") {
      out.reasonTag = allowReason.has(out.reasonTag) ? out.reasonTag : null;
      out.mustTagsAdd = [];
      out.wantTagsAdd = [];
      out.options = Array.isArray(out.options) ? out.options.filter(t => allowReason.has(t)).slice(0,3) : [];
    } else if (stage === "must" || stage === "want") {
      const norm = (arr) => (Array.isArray(arr) ? arr : []).map(x => SYN[x] || x).filter(x => allowMW.has(x));
      if (stage === "must") { out.mustTagsAdd = norm(out.mustTagsAdd); out.wantTagsAdd = []; }
      if (stage === "want") { out.wantTagsAdd = norm(out.wantTagsAdd); out.mustTagsAdd = []; }
      out.reasonTag = null;
      out.options = Array.isArray(out.options) ? out.options.map(x => SYN[x] || x).filter(x => allowMW.has(x)).slice(0,3) : [];
    } else { // free
      out.reasonTag = null; out.mustTagsAdd = []; out.wantTagsAdd = []; out.options = [];
    }

    // 最低限の既定値
    if (typeof out.reply !== "string") out.reply = "ありがとう！";

    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "OpenAI API error" });
  }
}
