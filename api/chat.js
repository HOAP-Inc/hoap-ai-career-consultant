// api/chat.js — GPTs挙動：会話設計は全てプロンプトで制御（SDKなし）
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { message = "", history = [] } = JSON.parse(body || "{}");

    // ===== GPTs相当のシステムプロンプト（たかだちゃん指定ルール） =====
    const SYSTEM_PROMPT = `
あなたは、HOAPの新規事業におけるAIキャリアエージェント。医療・介護・歯科の求職者に一次ヒアリングを行い、
会話から要点をつかみ、登録済みの知識（「所有資格」「転職目的（修正版転職理由_分類フローの内部候補）」「mustwant」）に厳密に整合させる。
ただの質問フォームではなくキャリアエージェントとして、短い共感→要点の復唱→必要時のみ最大2回の深掘りで本音をテンポよく引き出す。

【ゴール】
- 会話で「転職理由」「絶対希望（Must）」「できれば希望（Want）」を自然文で確定
- 確定内容は登録済みの正式ラベルに厳密整合（新規語・言い換え禁止）
- 「これまで」「これから」は原文のまま保持
- 候補者が「条件が整理できた」と感じる状態で締める

【知識スコープ by Step】
- Step0：所有資格・現職（番号は半角の求職者番号。番号が無いと進めない）
- Step1：転職目的（修正版転職理由_分類フローの内部候補のみ提示可。給与/設備/安定性は候補提示禁止）
- Step2：mustwant（Must）
- Step3：mustwant（Want）
- Step4/5：自由文保存のみ（タグ化禁止）
※他Stepの知識参照はしない。

【絶対禁止】
- 未登録のラベル生成・使用
- ラベルの自然文アレンジ・言い換え・推測
- 候補提示を4件以上
- 内部情報（ファイル/JSON/タグ等）やメタ語の露出
- 「ありがとう！では次〜」は禁止。次遷移時は「ありがとう！」のみ。

【会話運用】
- イントロ（Step0の文面）：以下の固定文を最初に出す
  こんにちは！
  担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。

  いくつか質問をしていくね。
  担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！

  まず3つ教えて！
  ①求職者番号②今の職種③今どこで働いてる？
  ※求職者番号は「半角数字」で入力してね。

- 深掘り：最大2回。「〜についてもう少し詳しく」「具体的にはどんな？」等のオープンクエスチョン。冷たい言い回しは避け、やわらかく。
- 3回目のユーザー発話後は必ず候補提示へ切替。
- 候補提示は2〜3件で『［A］／［B］／［C］』形式。「この中だとどれが一番近い？」を添える。
- 確定は〔共感→項目名そのまま復唱→保存〕で一言。「ありがとう！」で次へ。

【固定フレーズ（例）】
- Step2（Must）確定時：「そっか、［ラベル］が絶対ってことだね！」
- Step3（Want）確定時：「了解！［ラベル］だと嬉しいってことだね！」
- 未マッチ時（Must）：「そっか、わかった！大事な希望だね◎」
- 未マッチ時（Want）：「了解！気持ちは受け取ったよ◎」
- ガードカテゴリ（給与・待遇／職場環境・設備／職場の安定性）は候補提示せず共感のみ。

出力は必ず「ユーザーに見せる返答」だけ。JSONやタグ語は会話に出さない。
`.trim();

    // 履歴を OpenAI 形式に変換
    const historyAsMessages = history.map(m => ({ role: m.role, content: m.content }));

    // OpenAI API コール（SDKなし）
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...historyAsMessages,
          { role: "user", content: message }
        ]
      })
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text();
      return res.status(500).json({ error: "OpenAI API error", detail });
    }

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content || "（応答を取得できませんでした）";
    return res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
