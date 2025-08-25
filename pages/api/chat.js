// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** 所有資格タグ辞書 */
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
  { tag: '歯科助手', patterns: ['歯科助手'] },
  { tag: '介護支援専門員（ケアマネ）', patterns: ['ケアマネ', '介護支援専門員'] },
  { tag: '医療事務', patterns: ['医療事務'] },
  { tag: '福祉用具専門相談員', patterns: ['福祉用具専門相談員', '福祉用具'] },
  { tag: '保育士', patterns: ['保育士'] },
]

/** 介護系だけど資格が曖昧なワード */
const AMBIG_CARE = ['介護', 'ヘルパー', '介護職']

const norm = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

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

function looksAmbiguousCare(input) {
  const n = norm(input)
  return AMBIG_CARE.some(k => n.includes(norm(k)))
}

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
      // Step0 内のフェーズ管理: needId -> needQualification -> needWorkplace -> done
      step0Phase: 'needId',
      // 資格あいまい確認フラグ
      awaitingQualClarify: false,
      // 内部メモ
      notes: [],
      // 以下、後工程用
      deepDrillCount: 0,
      currentCategory: null,
      awaitingSelection: false,
      selectionOptions: [],
    })
  }
  return sessions.get(sessionId)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

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
    const text = String(message || '').trim()

    /** Step0：ID → 職種（所有資格）→ 現職（勤務先） */
    if (currentStep === 0) {
      if (!session.candidateNumber && isNumberConfirmed) {
        session.candidateNumber = candidateNumber
      }
      if (session.step0Phase === 'needId' && session.candidateNumber) {
        session.step0Phase = 'needQualification'
      }

      // 0-1) 求職者ID
      if (session.step0Phase === 'needId') {
        if (text && text.length >= 3) {
          session.candidateNumber = text
          session.step0Phase = 'needQualification'
          return res.json({
            response:
              'OK、求職者ID確認したよ！\nまず【今の職種（所有資格）】を教えてね。\n（例）正看護師',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }
        return res.json({
          response: '最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。',
          step: 0,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: false,
          sessionData: session,
        })
      }

      // 0-2) 職種（所有資格） — 曖昧入力対応
      if (session.step0Phase === 'needQualification') {
        // すでに曖昧確認モード → 回答判定
        if (session.awaitingQualClarify) {
          const tag = matchQualificationTag(text)
          const noQual = /(無資格|資格なし|持ってない|なし|未取得)/.test(text)

          if (!tag && noQual) {
            session.qualification = session.qualification || '介護（無資格）'
            session.qualificationTag = ''
          } else if (tag) {
            session.qualification = text
            session.qualificationTag = tag
          } else {
            session.qualification = text || session.qualification
            session.qualificationTag = ''
            session.notes.push(`資格あいまい回答: ${text}`)
          }

          session.awaitingQualClarify = false
          session.step0Phase = 'needWorkplace'
          return res.json({
            response:
              '受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }

        // 通常フロー
        if (!text) {
          return res.json({
            response: 'まず【今の職種（所有資格）】を教えてね。\n（例）正看護師',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }

        const tag = matchQualificationTag(text)

        if (tag) {
          session.qualification = text
          session.qualificationTag = tag
          session.step0Phase = 'needWorkplace'
          return res.json({
            response:
              '受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }

        // タグ未一致：介護系の曖昧ワードなら確認質問を挟む
        if (looksAmbiguousCare(text)) {
          session.qualification = text // 原文保持
          session.qualificationTag = '' // 未確定
          session.awaitingQualClarify = true
          return res.json({
            response:
              '「介護／ヘルパー」了解！\n**初任者研修／実務者研修／介護福祉士**などの資格は持ってる？それとも**持っていない**？\n（例）「初任者研修」「介護福祉士」「無資格」などで教えてね。',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }

        // その他の未一致：タグ空保存で現職へ
        session.qualification = text
        session.qualificationTag = ''
        session.step0Phase = 'needWorkplace'
        return res.json({
          response:
            '受け取ったよ！次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック',
          step: 0,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        })
      }

      // 0-3) 現職（勤務先）
      if (session.step0Phase === 'needWorkplace') {
        if (!text) {
          return res.json({
            response: '【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }
        session.workplace = text
        session.step0Phase = 'done'
        // ★ Step1 への誘導は “完全一致” セリフで固定（端折り禁止）
        return res.json({
          response:
            'はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎',
          step: 1,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        })
      }

      // 0-x) 既に done の場合も Step1 のフルセリフで案内
      return res.json({
        response:
          'はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎',
        step: 1,
        candidateNumber: session.candidateNumber,
        isNumberConfirmed: true,
        sessionData: session,
      })
    }

    /** Step1 以降（暫定はGPTに委譲。ほーぷちゃんの制約だけ強める） */
    const systemPrompt = `あなたは「ほーぷちゃん」。医療・介護・歯科の一次ヒアリングを行うAIキャリアエージェント。
- フレンドリーだが順番制で必ず聞き切る。
- 「絶対NG」は存在しない。Must/Want/Can/Willで整理。
- タグ未一致は新規生成しない。原文を保持し、タグは空のまま。
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

    // 暫定の次ステップ判定（今後ここも厳密にする前提）
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
