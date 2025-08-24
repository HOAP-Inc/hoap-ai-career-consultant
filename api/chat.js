// api/chat.js — モデル優先順: gpt-5 → gpt-5-mini → gpt-4.1-mini → gpt-4o-mini
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ reply: "Method not allowed（POSTだけ使ってね）" });
  }

  try {
    const { message = "", history = [] } = req.body || {};

    const key = process.env.OPENAI_API_KEY;
    if (!key || !key.trim()) {
      return res.status(200).json({
        reply:
          "OPENAI_API_KEY が Production に入ってないか空だよ。Settings > Environment Variables で Production に設定→Redeployして。"
      });
    }

    const models = [
      "gpt-5",          // たかだちゃん指定
      "gpt-5-mini",     // 5の軽量がある場合
      "gpt-4.1-mini",   // 4.1系（多くの環境で使える）
      "gpt-4o-mini"     // さらにフォールバック
    ];

    const sys = "あなたはHOAPのAIキャリアエージェント。ユーザーに見せる返答だけを短く自然に返す。";

    let lastErrText = "";
    for (const model of models) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            messages: [
              { role: "system", content: sys },
              ...(Array.isArray(history) ? history : []),
              { role: "user", content: String(message) }
            ]
          })
        });

        if (!r.ok) {
          const t = await r.text();
          // 401/403/404/400 は次モデルへフォールバック
          lastErrText = `model=${model} → status=${r.status} body=${t.slice(0,400)}`;
          continue;
        }

        const data = await r.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (reply) {
          return res.status(200).json({ reply });
        } else {
          lastErrText = `model=${model} → 異常レスポンス`;
        }
      } catch (e) {
        lastErrText = `model=${model} → 例外: ${String(e).slice(0,400)}`;
        continue;
      }
    }

    // 全滅時：理由を表示
    return res.status(200).json({
      reply: "OpenAI呼び出しに失敗。最終ログ:\n" + lastErrText
    });
  } catch (e) {
    return res.status(200).json({ reply: `サーバー例外：${String(e).slice(0,600)}` });
  }
}
