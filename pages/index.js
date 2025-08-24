// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// 会話セッション最小管理（必要最小限だけ）
const sessions = new Map()
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      candidateNumber: '',
      qualification: '',
      workplace: '',
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: '',
      deepDrillCount: 0,
      awaitingSelection: false,
      selectionOptions: [],
    })
  }
  return sessions.get(sessionId)
}

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

    // セッション同期（フロントのStep0結果を保持するだけ）
    const session = getSession(sessionId)
    if (candidateNumber) session.candidateNumber = candidateNumber
    if (qualification) session.qualification = qualification
    if (workplace) session.workplace = workplace

    // Step0はフロント強制なので、このAPIはStep1以降だけ応答
    // ただし安全側でガード（Step0の途中で来たら促しメッセージ）
    if (currentStep === 0 && (!isNumberConfirmed || !session.qualification || !session.workplace)) {
      return res.json({
        response:
          'ごめん！まずはフロントの案内どおりに「番号 → 所有資格 → 勤務先」を教えてね。',
        step: 0,
        sessionData: session,
      })
    }

    // ---- OpenAIへ丸投げするためのシステムプロンプト（元構成準拠） ----
    const systemPrompt = `あなたは、HOAPの新規事業におけるAIキャリアエージェント。医療・介護・歯科の求職者に一次ヒアリングを行い、会話から要点をつかみ、登録済みの知識に厳密に整合させる。

■ゴール
・会話で「転職理由」「絶対希望（Must）」「絶対NG（使わないなら言及しないでOK）」「あるといいな（Want）」を自然文で確定
・確定内容は既存の正式タグに整合
・「これまで（Can）」「これから（Will）」は原文保持
・候補者が「自分の条件が整理できた」と感じられる締め

■重要ルール
・タグにない語の生成・使用はしない（曖昧なら自然文のまま保持）
・「給与・待遇」「職場環境・設備」「職場の安定性」にヒットした場合は候補提示を行わず、共感の一言だけで受ける
・候補提示は2〜3件に限定（羅列禁止）
・ステップを乱さない：いまのステップは ${currentStep}。次の質問に進む時だけ、自然な導線で促す

■現在の基本情報
・求職者番号: ${session.candidateNumber || candidateNumber || '(未)'}
・所有資格(=職種タグ起点): ${session.qualification || qualification || '(未)'}
・勤務先: ${session.workplace || workplace || '(未)'}
    `

    // 会話履歴を構築
    const messages = [{ role: 'system', content: systemPrompt }]
    for (const msg of conversationHistory) {
      if (!msg || !msg.content) continue
      messages.push({
        role: msg.type === 'ai' ? 'assistant' : 'user',
        content: msg.content,
      })
    }
    messages.push({ role: 'user', content: message })

    // OpenAI呼び出し（モデルは軽量でOK）
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 900,
      temperature: 0.3,
    })
    const response = completion.choices?.[0]?.message?.content || '…'

    // 最低限の進行判定：
    // 「転職理由 → Must → Want → Can → Will」の順。キーワードでざっくり遷移。
    let nextStep = currentStep
    const r = response

    if (currentStep === 1) {
      // 転職理由の返しの中で「じゃあ次」「Must」などの合図が含まれたらStep2へ
      if (/[次|では次に].*(Must|絶対条件|条件)/.test(r) || /Must/.test(r)) {
        nextStep = 2
      }
    } else if (currentStep === 2) {
      if (/(Want|あるといいな|希望条件)/.test(r)) {
        nextStep = 3
      }
    } else if (currentStep === 3) {
      if (/(これまで|Can|経験|やってきたこと)/.test(r)) {
        nextStep = 4
      }
    } else if (currentStep === 4) {
      if (/(これから|Will|挑戦|やりたいこと)/.test(r)) {
        nextStep = 5
      }
    } else if (currentStep === 5) {
      if (/ありがとう|以上|整理できた/.test(r)) {
        nextStep = 6 // 完了
      }
    }

    return res.json({
      response,
      step: nextStep,
      sessionData: session,
    })
  } catch (error) {
    console.error('Error in chat API:', error)
    return res.status(500).json({
      message: 'Internal server error',
      error: error?.message || String(error),
    })
  }
}
