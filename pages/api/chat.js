// pages/api/chat.js
step: 3,
})
}


// =====================================================
// Step3: 絶対NG
// =====================================================
if (currentStep === 3) {
const found = matchMustWant(message)
if (found.length) {
session.ngConditions = Array.from(new Set([...(session.ngConditions || []), ...found]))
}
return res.json({
response: `質問は残り2つ！これまでやってきたことを、できるだけ自然な言い方で教えて。\n箇条書きでもOK。`,
step: 4,
})
}


// =====================================================
// Step4: これまで（原文保持）
// =====================================================
if (currentStep === 4) {
session.canDo = message.trim()
return res.json({
response: `これが最後の質問👏 これから挑戦したいこと・やってみたいことを教えて。\n気持ちベースでもOKだよ。`,
step: 5,
})
}


// =====================================================
// Step5: これから（原文保持）→ サマリー
// =====================================================
if (currentStep === 5) {
session.willDo = message.trim()


// 最終サマリーはOpenAIで表現だけ整える（タグ生成は禁止）
const summaryPrompt = `${systemPrompt}\n次のデータをもとに、面談前の共有用に短い要約を作成。\n禁止: 新しいラベルや項目の生成。与えられていない事実の追加。\n\nデータ:\n- 転職理由: ${session.transferReason || '記録なし'}\n- 絶対条件: ${(session.mustConditions || []).join('、') || 'なし'}\n- 絶対NG: ${(session.ngConditions || []).join('、') || 'なし'}\n- これまで: ${session.canDo || '未入力'}\n- これから: ${session.willDo || '未入力'}\n\n出力は次の順番で自然文で2〜4行。\n1. 転職理由の要点を一行\n2. 絶対条件と絶対NGのハイライト\n3. これまで→これからの流れが伝わる一行`


let summary = ''
try {
const completion = await openai.chat.completions.create({
model: 'gpt-4o-mini',
messages: [
{ role: 'system', content: systemPrompt },
{ role: 'user', content: summaryPrompt },
],
temperature: 0.2,
max_tokens: 300,
})
summary = completion.choices[0]?.message?.content?.trim() || ''
} catch (_) {
summary = '面談前共有: 要約の生成に失敗しましたが、入力データは保存済みです。'
}


const closing = `今日はたくさん話してくれてありがとう！\nこの内容をもとに、担当エージェントがピッタリな提案を準備するね。\n\n▼面談前共有\n${summary}`


return res.json({ response: closing, step: 6, sessionData: session })
}


// それ以外
return res.json({ response: '想定外のステップです。最初からやり直してください。', step: 0 })
} catch (error) {
console.error('Error in chat API:', error)
return res.status(500).json({ message: 'Internal server error', error: error.message })
}
}
