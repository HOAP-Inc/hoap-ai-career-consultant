// pages/api/chat.js
import OpenAI from 'openai'

// OpenAIはStep2以降のみ使用。キー未設定でもUIは動く設計
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// セッション（簡易・同一プロセス内）
const sessions = new Map()
const getSession = (id) => {
  if (!sessions.has(id)) {
    sessions.set(id, {
      candidateNumber: '',
      qualification: '',
      workplace: '',
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: ''
    })
  }
  return sessions.get(id)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { return res.status(405).json({ message: 'Method not allowed' }) }

  try {
    const { message, conversationHistory = [], currentStep = 0, candidateNumber = '', isNumberConfirmed = false, sessionId = 'default' } = req.body
    const session = getSession(sessionId)
    const text = (message || '').trim()

    // Step 0: ID → 職種 → 勤務先 を“完全固定フロー”
    if (currentStep === 0 && !isNumberConfirmed) {
      const m = text.match(/\d{3,}/)
      if (!m) {
        return res.json({
          response: `すみません、最初に【求職者ID】を教えてね。\n※IDは「メール」で届いているやつ（LINEじゃないよ）。\n一度に書いてOK（例：12345 看護師 総合病院）`,
          step: 0
        })
      }
      session.candidateNumber = m[0]
      return res.json({
        response: `求職者ID:${m[0]} で確認したよ！\n次は【今の職種（所有資格）】を教えてね。`,
        candidateNumber: m[0],
        isNumberConfirmed: true,
        step: 0,
        sessionData: session
      })
    }

    if (currentStep === 0 && isNumberConfirmed) {
      if (!session.qualification) {
        session.qualification = text
        return res.json({
          response: `ありがとう！\n次は【今どこで働いてる？】を教えてね。`,
          step: 0,
          sessionData: session
        })
      }
      if (!session.workplace) {
        session.workplace = text
        // ここでStep1へ遷移
        return res.json({
          response: `ありがとう！\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理…と思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎`,
          step: 1,
          sessionData: session
        })
      }
    }

    // Step1: 転職理由（OpenAIは任意。なければ共感テンプレで返す）
    if (currentStep === 1) {
      session.transferReason = text
      let reply = `なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\nじゃあ次の質問！【絶対希望（Must）】を2〜3個だけ教えて。`
      if (openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            max_tokens: 180,
            messages: [
              { role: 'system', content: '短く前向きに共感して、次の質問へ誘導して。敬語禁止・圧は優しく。' },
              { role: 'user', content: text }
            ]
          })
          reply = completion.choices[0]?.message?.content || reply
        } catch {}
        reply += `\n\nじゃあ次の質問！【絶対希望（Must）】を2〜3個だけ教えて。`
      }
      return res.json({ response: reply, step: 2, sessionData: session })
    }

    // Step2: Must（カンマ/改行で配列化・重複除去）
    if (currentStep === 2) {
      const items = text.split(/[\n,、]/).map(s => s.trim()).filter(Boolean)
      session.mustConditions = Array.from(new Set([...(session.mustConditions||[]), ...items]))
      return res.json({
        response: `OK！それじゃ次に、こうだったらいいな（Want）を2〜3個だけ教えて。`,
        step: 3,
        sessionData: session
      })
    }

    // Step3: Want
    if (currentStep === 3) {
      const items = text.split(/[\n,、]/).map(s => s.trim()).filter(Boolean)
      session.wantConditions = Array.from(new Set([...(session.wantConditions||[]), ...items]))
      return res.json({
        response: `質問は残り2つ！\nこれまで（Can）：やってきたこと・得意なことを教えて。`,
        step: 4,
        sessionData: session
      })
    }

    // Step4: Can
    if (currentStep === 4) {
      session.canDo = text
      return res.json({
        response: `これが最後の質問👏\nこれから（Will）：挑戦したいこと・成し遂げたいことを教えて。`,
        step: 5,
        sessionData: session
      })
    }

    // Step5: Will → クローズ
    if (currentStep === 5) {
      session.willDo = text
      return res.json({
        response: `今日はたくさん話してくれてありがとう！\n要点をまとめるね：\n・転職理由：${session.transferReason || '（未入力）'}\n・Must：${(session.mustConditions||[]).join('／') || '（0件）'}\n・Want：${(session.wantConditions||[]).join('／') || '（0件）'}\n・Can：${session.canDo || '（未入力）'}\n・Will：${session.willDo || '（未入力）'}\n\n担当エージェントに引き継ぐよ。おつかれさま！`,
        step: 6,
        sessionData: session
      })
    }

    // フォールバック
    return res.json({ response: '了解、続けよう。', step: currentStep, sessionData: session })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ message: 'Internal error', error: e.message })
  }
}
