// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/** -------------------------
 *  所有資格タグ辞書（正規化パターン）
 *  入力（職種）→ qualificationTag を決定
 * ------------------------- */
const QUAL_TAGS = [
  { tag: '看護師', patterns: ['看護師', '正看', '正看護師', 'rn'] },
  { tag: '准看護師', patterns: ['准看', '准看護師'] },
  { tag: '保健師', patterns: ['保健師'] },
  { tag: '助産師', patterns: ['助産師'] },
  { tag: '介護福祉士', patterns: ['介護福祉士', '介福'] },
  { tag: '介護職（初任者研修）', patterns: ['初任者', '初任者研修', 'ヘルパー2級', 'ﾍﾙﾊﾟｰ2級'] },
  { tag: '介護職（実務者研修）', patterns: ['実務者', '実務者研修', 'ヘルパー1級', 'ﾍﾙﾊﾟｰ1級'] },
  { tag: '理学療法士', patterns: ['理学療法士', 'pt'] },
  { tag: '作業療法士', patterns: ['作業療法士', 'ot'] },
  { tag: '言語聴覚士', patterns: ['言語聴覚士', 'st'] },
  { tag: '管理栄養士', patterns: ['管理栄養士'] },
  { tag: '栄養士', patterns: ['栄養士'] },
  { tag: '歯科衛生士', patterns: ['歯科衛生士', 'dh'] },
  { tag: '歯科技工士', patterns: ['歯科技工士'] },
  { tag: '歯科助手', patterns: ['歯科助手'] }, // 資格ではないが運用タグとして保持
  { tag: '介護支援専門員（ケアマネ）', patterns: ['ケアマネ', '介護支援専門員'] },
  { tag: '医療事務', patterns: ['医療事務'] },
  { tag: '福祉用具専門相談員', patterns: ['福祉用具専門相談員', '福祉用具'] },
  { tag: '保育士', patterns: ['保育士'] },
]

const norm = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )

function matchQualificationTag(input) {
  const n = norm(input)
  if (!n) return ''
  for (const { tag, patterns } of QUAL_TAGS) {
    for (const p of patterns) {
      if (n.includes(norm(p))) return tag
    }
  }
  return ''
}

/** -------------------------
 *  セッション（簡易）
 * ------------------------- */
const sessions = new Map()
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      candidateNumber: '',
      qualification: '',
      qualificationTag: '',
      workplace: '',
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: '',
      deepDrillCount: 0,
      currentCategory: null,
      awaitingSelection: false,
      selectionOptions: [],
    })
  }
  return sessions.get(sessionId)
}

/** -------------------------
 *  ハンドラ
 * ------------------------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      message = '',
      conversationHistory = [],
      currentStep = 0,
      candidateNumber = '',
      isNumberConfirmed = false,
      sessionId = 'default',
    } = req.body

    const session = getSession(sessionId)

    /** -------------------------
     *  Step0：ID確認 → 職種（所有資格タグに整合）
     * ------------------------- */
    if (currentStep === 0) {
      // 0-1) 求職者IDまだ：IDを確定（※数字限定にしない。メールID想定で非空を許容）
      if (!isNumberConfirmed && !session.candidateNumber) {
        const id = String(message).trim()
        if (id && id.length >= 3) {
          session.candidateNumber = id
          return res.json({
            response:
              'OK、求職者ID確認したよ！\nつづいて【今の職種（所有資格）】と【今どこで働いてる？】を教えてね。\n（例）正看護師／〇〇病院 外来',
            step: 0,
            candidateNumber: id,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }
        return res.json({
          response:
            '最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。',
          step: 0,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: false,
          sessionData: session,
        })
      }

      // 0-2) IDは確定済み：今回のメッセージを「職種」として受け取り、タグに整合
      //      現職（workplace）はそのまま保存運用だが、ここでは職種タグ整合を最優先で実装
      const text = String(message || '').trim()
      if (text) {
        // 一旦全文を職種フィールドに入れる（分割入力・一行入力どちらも吸収）
        session.qualification = text
        session.qualificationTag = matchQualificationTag(text)

        // 現職は壊さない運用：もし「／」「,」「、」などで併記されていれば軽く推定（無理に分割しない）
        // ※要件：推測で壊さない → 厳密分割は後続Stepで実装、ここでは未タッチでもOK
      }

      return res.json({
        response:
          '受け取ったよ！職種はタグに整合しておくね。\n次は【転職理由】を教えて。きっかけ・しんどかったこと・挑戦したいこと、何でもOK！',
        step: 1,
        candidateNumber: session.candidateNumber,
        isNumberConfirmed: true,
        sessionData: session,
      })
    }

    /** -------------------------
     *  Step1以降：既存ロジック（OpenAIに委譲）
     *  ※ここはまだ粗くてもOK。Step0が要件を満たせればUIのチップ表示は揃う。
     * ------------------------- */
    const systemPrompt = `あなたは、HOAPの新規事業におけるAIキャリアエージェント。医療・介護・歯科の一次ヒアリングを行い、会話から要点をつかみ、登録済み知識に厳密整合する。
- 会話トーンはフレンドリーだが断定せず、順序を守る。
- 「絶対NG」は存在しない前提。Must/Want/Can/Willで整理する。
- タグにない新規生成は禁止。タグ未一致は「未一致」として記録し原文保持。
- 現在のステップ: ${currentStep}
- セッション: ${JSON.stringify(session)}`

    const msgs = [{ role: 'system', content: systemPrompt }]
    for (const m of conversationHistory) {
      msgs.push(
        m.type === 'ai'
          ? { role: 'assistant', content: m.content }
          : { role: 'user', content: m.content }
      )
    }
    msgs.push({ role: 'user', content: message })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: msgs,
      temperature: 0.3,
      max_tokens: 1000,
    })

    const response = completion.choices?.[0]?.message?.content ?? '…'

    // 簡易ステップ進行（暫定のまま）
    let nextStep = currentStep
    if (response.includes('じゃあ次の質問！') && currentStep === 1) nextStep = 2
    else if (response.includes('それじゃあ次に、こうだったらいいな') && currentStep === 2) nextStep = 3
    else if (response.includes('質問は残り2つ！') && currentStep === 3) nextStep = 4
    else if (response.includes('これが最後の質問👏') && currentStep === 4) nextStep = 5
    else if (response.includes('今日はたくさん話してくれてありがとう！') && currentStep === 5) nextStep = 6

    return res.json({
      response,
      step: nextStep,
      candidateNumber: session.candidateNumber,
      isNumberConfirmed: Boolean(session.candidateNumber),
      sessionData: session,
    })
  } catch (err) {
    console.error('Error in chat API:', err)
    return res.status(500).json({ message: 'Internal server error', error: err.message })
  }
}
