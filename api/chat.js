// api/chat.js  ---- Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 受け取り
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString() || "{}");
    const { stage, history = [] } = body;

    if (stage !== "reason") {
      return res.status(400).json({ error: "unsupported stage" });
    }

    // 転職理由：許可されるタグ（内部候補のみ）
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

    const joined = history.join("\n");

    // OpenAI Chat Completions（JSONで返させる）
    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
あなたはHOAPのAIキャリアエージェント。日本語で短く、やわらかく話す。
目的：会話履歴から意図をつかみ、下記の「許可タグ」だけに厳密整合させる。
禁止：新しい語の生成、言い換え、自然文アレンジ。必ず許可タグそのまま。

出力は必ずJSONオブジェクトのみ：
{
  "reply": "ユーザーへの返答（共感→自然な深掘り or 候補提示）。「ありがとう！」は入れない",
  "options": ["許可タグA","許可タグB"] // 0〜3件。なければ空配列。
}

会話制御：
- 履歴のユーザー発話が3回未満：共感1行＋やわらかい深掘り1行（質問は1つ）。
- 3回目以降：候補タグを2〜3件だけ提示。「この中だとどれが一番近い？」の一文を入れる。
- 候補が出せないと判断したら options は空配列でOK（その場合もreplyは自然に）。
- 「タグ」「JSON」などのメタ語は禁止。
許可タグ: ${JSON.stringify(REASON_OPTIONS)}
`.trim()
        },
        {
          role: "user",
          content: `会話履歴（最新が末尾）:
${joined || "(まだ発話なし)"}`
        }
      ]
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { reply: "ごめん、今うまく読み取れなかった。もう一度だけ送ってみて！", options: [] }; }

    // 安全弁：optionsは許可タグだけに絞る＆最大3件
    const allow = new Set(REASON_OPTIONS);
    parsed.options = Array.isArray(parsed.options) ? parsed.options.filter(t => allow.has(t)).slice(0,3) : [];

    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "OpenAI request failed" });
  }
}
