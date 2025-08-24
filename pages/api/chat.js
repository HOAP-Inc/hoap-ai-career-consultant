// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 最小限のセッション
const sessions = new Map()
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      candidateNumber: '',
      qualification: '',
      workplace: '',
      // 将来的な拡張用フィールド
      must: [],
      want: [],
      can: '',
      will: '',
    })
  }
  return sessions.get(sessionId)
}

// 固定ブリッジ台詞（絶対この文面）
const BRIDGE_TO_MUST =
  'じゃあ次の質問！\n絶対にゆずれない条件を教えて。'
const BRIDGE_TO_WANT =
  'それじゃあ次に、こうだったらいいな（Want）を教えて。'

// 禁止語（返ってきたら強制修正）
const HARD_BANNED_PHRASES = ['絶対NG']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      message,
      conversationHistory = [],
      currentStep = 0,
      candidateNumber = '',
      isNumberConfirmed = false,
      sessionId = 'default',
      qualification = '',
      workplace = '',
    } = req.body

    const session = getSession(sessionId)
    if (candidateNumber) session.candidateNumber = candidateNumber
    if (qualification) session.qualification = qualification
    if (workplace) session.workplace = workplace

    // Step0 はフロント固定。ガードだけ。
    if (currentStep === 0 && (!isNumberConfirmed || !session.qualification || !session.workplace)) {
      return res.json({
        response:
          'ごめん！まずはフロントの案内どおりに「番号 → 所有資格 → 勤務先」を教えてね。',
        step: 0,
      })
    }

    // —— System Prompt（フロー厳守 & 禁止ワード）——
    const systemPrompt = `
あなたはHOAPのAIキャリアエージェント。会話は次のフローを厳守して進める。

[フロー]
Step1: 転職理由（深掘り可・短い共感→具体質問）
Step2: 絶対条件（Must）
Step3: あるといいな（Want）
Step4: いままで（Can）
Step5: これから（Will）

[固定ルール]
- 「絶対NG」「NG」という表現やステップは一切使わない／導入しない。
- Step1 でユーザーの回答に対しては、カテゴリに応じた短い共感を1行（バリエーション可）。ただし固定文「なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎」のみで終わらせない。必ず具体的な深掘りや次の誘導につなげる。
- Step1終了→Step2 に進むときは、**必ず次の2行をそのまま含める（文面完全一致）**：
${BRIDGE_TO_MUST}

- Step2 から Step3 に進むときは、**必ず次の1行をそのまま含める（文面完全一致）**：
${BRIDGE_TO_WANT}

- Step名を変えない。Must/Want/Can/Will の語は使ってOKだが、**「絶対NG」系の語は絶対禁止**。
- 文章は日本語。テンションはやわらかく、行き過ぎたポエム禁止。冗長にしない。

[ユーザー基本情報]
・求職者番号: ${session.candidateNumber || '(未)'}
・所有資格(=職種表示の起点): ${session.qualification || '(未)'}
・勤務先: ${session.workplace || '(未)'}
    `.trim()

    // 会話履歴の組立
    const msgs = [{ role: 'system', content: systemPrompt }]
    for (const m of conversationHistory) {
      if (!m || !m.content) continue
      msgs.push({ role: m.type === 'ai' ? 'assistant' : 'user', content: m.content })
    }
    msgs.push({ role: 'user', content: message })

    // OpenAI コール
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: msgs,
      max_tokens: 900,
      temperature: 0.3,
    })

    let response = completion.choices?.[0]?.message?.content || ''

    // --- サニタイズ：禁止語を潰す ---
    for (const bad of HARD_BANNED_PHRASES) {
      if (response.includes(bad)) {
        // 代表ケース「絶対NG」を「絶対条件」に差し替え
        response = response.replaceAll('絶対NG', '絶対条件')
      }
    }

    // --- ブリッジ強制挿入（端折り対策） ---
    // Step1の返答には必ず Step2 ブリッジ文面を含める
    if (currentStep === 1 && !response.includes(BRIDGE_TO_MUST)) {
      response = response.trim() + `\n\n${BRIDGE_TO_MUST}`
    }
    // Step2の返答には必ず Step3 ブリッジ文面を含める（Mustの追加ヒアリングが続く間はAIが出さないことがあるため保険）
    if (currentStep === 2 && !response.includes(BRIDGE_TO_WANT)) {
      response = response.trim() + `\n\n${BRIDGE_TO_WANT}`
    }

    // --- 進行判定：固定フレーズで確定遷移 ---
    let nextStep = currentStep
    if (currentStep === 1 && response.includes(BRIDGE_TO_MUST)) {
      nextStep = 2
    } else if (currentStep === 2 && response.includes(BRIDGE_TO_WANT)) {
      nextStep = 3
    } else if (currentStep === 3 && /(これまで|Can|やってきたこと)/.test(response)) {
      nextStep = 4
    } else if (currentStep === 4 && /(これから|Will|挑戦|やりたいこと)/.test(response)) {
      nextStep = 5
    } else if (currentStep === 5 && /(今日はたくさん話してくれてありがとう|整理できた|以上)/.test(response)) {
      nextStep = 6
    }

    return res.json({
      response,
      step: nextStep,
      sessionData: session,
    })
  } catch (err) {
    console.error('chat api error', err)
    return res.status(500).json({ message: 'Internal server error', error: String(err?.message || err) })
  }
}
