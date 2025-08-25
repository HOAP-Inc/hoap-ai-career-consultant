// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** 所有資格タグ辞書（正規化パターン） */
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
  { tag: '歯科助手', patterns: ['歯科助手'] }, // 運用タグ
  { tag: '介護支援専門員（ケアマネ）', patterns: ['ケアマネ', '介護支援専門員'] },
  { tag: '医療事務', patterns: ['医療事務'] },
  { tag: '福祉用具専門相談員', patterns: ['福祉用具専門相談員', '福祉用具'] },
  { tag: '保育士', patterns: ['保育士'] },
]

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

const sessions = new Map()
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      // 基本情報
      candidateNumber: '',
      qualification: '',
      qualificationTag: '',
      workplace: '',
      // 以降の項目
      transferReason: '',
      mustConditions: [],
      wantConditions: [],
      canDo: '',
      willDo: '',
      // Step0のサブ段階: needId | needQualification | needWorkplace | done
      step0Phase: 'needId',
      // その他
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

    /** Step0：ID → 職種 → 現職（厳密な順番制） */
    if (currentStep === 0) {
      // フェーズの初期整合
      if (!session.candidateNumber && isNumberConfirmed) {
        session.candidateNumber = candidateNumber
      }
      if (session.step0Phase === 'needId' && session.candidateNumber) {
        session.step0Phase = 'needQualification'
      }

      // 0-1) ID 確認
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

      // 0-2) 職種（所有資格タグに整合）
      if (session.step0Phase === 'needQualification') {
        if (!text) {
          return res.json({
            response:
              'まず【今の職種（所有資格）】を教えてね。\n（例）正看護師',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }
        session.qualification = text
        session.qualificationTag = matchQualificationTag(text)
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

      // 0-3) 現職（そのまま保持）
      if (session.step0Phase === 'needWorkplace') {
        if (!text) {
          return res.json({
            response:
              '【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          })
        }
        session.workplace = text
        session.step0Phase = 'done'
        return res.json({
          response:
            'OK、基本情報そろった！\nはじめに、今回の【転職理由】を教えて。きっかけ・しんどかったこと・挑戦したいこと、何でもOK！',
          step: 1, // ← ここで次ステップへ
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        })
      }

      // 念のため（doneで戻ってきたら転職理由へ誘導）
      return res.json({
        response:
          'はじめに、今回の【転職理由】を教えて。きっかけ・しんどかったこと・挑戦したいこと、何でもOK！',
        step: 1,
        candidateNumber: session.candidateNumber,
        isNumberConfirmed: true,
        sessionData: session,
      })
    }

    /** Step1以降：既存（暫定） */
    const systemPrompt = `あなたはHOAPのAIキャリアエージェント。順番制でヒアリングし、登録済みのタグにのみ整合する。
- 「絶対NG」は使わない。Must/Want/Can/Willで整理。
- タグ未一致は新規生成せず、原文を保持して「未一致」として扱う。
- 現在のステップ: ${currentStep}
- セッション: ${JSON.stringify(session)}`
    const msgs = [{ role: 'system', content: systemPrompt }]
    for (const m of conversationHistory) {
      msgs.push(m.type === 'ai' ? { role: 'assistant', content: m.content } : { role: 'user', content: m.content })
    }
    msgs.push({ role: 'user', content: message })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: msgs,
      temperature: 0.3,
      max_tokens: 1000,
    })
    const response = completion.choices?.[0]?.message?.content ?? '…'

    // 既存の簡易ステップ制御（後で置換予定）
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
