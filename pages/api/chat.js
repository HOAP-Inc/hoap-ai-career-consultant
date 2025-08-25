// pages/api/chat.js
import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 簡易セッション（デモ用：本番はDBへ置換想定）
const sessions = new Map()
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      candidateNumber: '',
      qualification: '', // 職種（所有資格）
      workplace: '',     // 勤務先
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: '',
    })
  }
  return sessions.get(id)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const {
      message,
      conversationHistory = [],
      currentStep = 0,
      candidateNumber = '',
      isNumberConfirmed = false,
      sessionId = 'default',
    } = req.body

    const session = getSession(sessionId)

    // ===== Step0: ID → 職種 → 勤務先 を“必ずこの順”で確定させる =====
    if (currentStep === 0) {
      // 0-1) ID まだ
      if (!isNumberConfirmed) {
        const m = `${message}`.match(/[A-Za-z]*\d+/)
        if (m) {
          const id = m[0]
          session.candidateNumber = id
          return res.json({
            response: `求職者ID：${id} で確認したよ！\n次は【今の職種（所有資格）】を教えてね。`,
            candidateNumber: id,
            isNumberConfirmed: true,
            step: 0, // まだStep0のまま
            sessionData: session,
          })
        }
        return res.json({
          response: `最初に【求職者ID】を教えてね。\n※IDは「メール」で届いているやつ（LINEじゃないよ）`,
          step: 0,
          sessionData: session,
        })
      }

      // 0-2) 職種 まだ
      if (!session.qualification) {
        session.qualification = message.trim()
        return res.json({
          response: `ありがとう！\n次は【今どこで働いてる？】を教えてね。`,
          step: 0, // まだStep0
          sessionData: session,
        })
      }

      // 0-3) 勤務先 まだ
      if (!session.workplace) {
        session.workplace = message.trim()
        return res.json({
          response:
            `ありがとう！\n\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆に挑戦したいことでもOKだよ◎`,
          step: 1, // ここで初めてStep1へ
          sessionData: session,
        })
      }
    }

    // ===== Step1以降はLLMに委譲（ただしガイドは厳しめ）=====
    const systemPrompt = `あなたはHOAPのAIキャリアエージェント。医療・介護・歯科の求職者に一次ヒアリングを行う。
■厳守
- 既に確認済みの【求職者ID】を再要求しない
- ステップの冒頭で短い共感の一言を入れる
- 回答は端的に。候補羅列は2〜3件まで
- 出力の順序はプロンプトに従うこと
■現在のステップ: ${currentStep}
■セッション: ${JSON.stringify({
  candidateNumber: session.candidateNumber,
  qualification: session.qualification,
  workplace: session.workplace,
  transferReason: session.transferReason,
  mustCount: session.mustConditions.length,
  wantCount: session.wantConditions.length,
  canDo: session.canDo ? 'SET' : '',
  willDo: session.willDo ? 'SET' : '',
})}
`

    const messages = [{ role: 'system', content: systemPrompt }]
    // これまでの会話
    conversationHistory.forEach((m) =>
      messages.push({ role: m.type === 'ai' ? 'assistant' : 'user', content: m.content })
    )
    // 今回の発話
    messages.push({ role: 'user', content: message })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 800,
      temperature: 0.3,
    })

    const response = completion.choices?.[0]?.message?.content || '…'

    // ===== 進行（当面はキーワードフラグで前進）=====
    let nextStep = currentStep
    if (currentStep === 1 && /じゃあ次の質問！|Must|絶対希望/.test(response)) nextStep = 2
    else if (currentStep === 2 && /それじゃあ次に、こうだったらいいな|Want|あったらいいな/.test(response)) nextStep = 3
    else if (currentStep === 3 && /質問は残り2つ！|これまで|Can/.test(response)) nextStep = 4
    else if (currentStep === 4 && /これが最後の質問👏|これから|Will/.test(response)) nextStep = 5
    else if (currentStep === 5 && /今日はたくさん話してくれてありがとう！/.test(response)) nextStep = 6

    return res.json({
      response,
      step: nextStep,
      sessionData: session,
    })
  } catch (e) {
    console.error('API error:', e)
    return res.status(500).json({ message: 'Internal server error', error: e.message })
  }
}
