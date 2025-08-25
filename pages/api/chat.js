import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 簡易セッション（デモ用）
const sessions = new Map()
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      candidateNumber: '',
      qualification: '',
      workplace: '',
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
    const { message, conversationHistory = [], currentStep = 0, candidateNumber = '', isNumberConfirmed = false, sessionId = 'default' } = req.body
    const session = getSession(sessionId)

    // Step0: ID処理（ここだけ厳密制御）
    if (currentStep === 0) {
      if (!isNumberConfirmed) {
        const m = message.match(/[A-Za-z]*\d+/)
        if (m) {
          const id = m[0]
          session.candidateNumber = id
          return res.json({
            response:
`求職者ID：${id} で確認したよ！
次は【今の職種（所有資格）】と【今どこで働いてる？】を教えてね。`,
            candidateNumber: id,
            isNumberConfirmed: true,
            step: 0,
            sessionData: session,
          })
        } else {
          return res.json({
            response:
`ごめん、最初に【求職者ID】を教えてね。
※IDは「メール」で届いているやつ（LINEじゃないよ）`,
            step: 0,
            sessionData: session,
          })
        }
      } else {
        // IDは確認済み → 職種/勤務先を受け取り、Step1へ
        session.qualification = message
        return res.json({
          response:
`ありがとう！

はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？
しんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎`,
          step: 1,
          sessionData: session,
        })
      }
    }

    // 以降はOpenAIへ（ここは既存ロジックそのまま）
    const systemPrompt =
`あなたはHOAPのAIキャリアエージェント。医療・介護・歯科の求職者に一次ヒアリングを行う。
・各ステップの冒頭で短い共感の一言を必ず入れる
・指示がない限り、すでに確認済みの「求職者ID」を再度要求しない
現在のステップ: ${currentStep}
セッション: ${JSON.stringify(session)}`

    const messages = [{ role: 'system', content: systemPrompt }]
    conversationHistory.forEach(msg => {
      messages.push({ role: msg.type === 'ai' ? 'assistant' : 'user', content: msg.content })
    })
    messages.push({ role: 'user', content: message })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 800,
      temperature: 0.3,
    })

    const response = completion.choices[0].message.content || '…'

    // 雑だけど簡易進行
    let nextStep = currentStep
    if (response.includes('じゃあ次の質問！') && currentStep === 1) nextStep = 2
    else if (response.includes('それじゃあ次に、こうだったらいいな') && currentStep === 2) nextStep = 3
    else if (response.includes('質問は残り2つ！') && currentStep === 3) nextStep = 4
    else if (response.includes('これが最後の質問👏') && currentStep === 4) nextStep = 5
    else if (response.includes('今日はたくさん話してくれてありがとう！') && currentStep === 5) nextStep = 6

    return res.json({ response, step: nextStep, sessionData: session })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Internal server error', error: e.message })
  }
}
