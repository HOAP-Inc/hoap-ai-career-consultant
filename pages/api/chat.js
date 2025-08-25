// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * 所有資格タグ（職種入力をここに整合）
 * ここは必要に応じて増やせる。部分一致でマッチ。
 */
const qualificationTags = [
  '看護師','准看護師','助産師',
  '介護福祉士','介護職員初任者研修','実務者研修','ケアマネジャー',
  '理学療法士','作業療法士','言語聴覚士','柔道整復師','あん摩マッサージ指圧師',
  '歯科衛生士','歯科技工士','歯科助手',
  '医師','薬剤師','管理栄養士','栄養士',
  '臨床検査技師','臨床工学技士','診療放射線技師','視能訓練士','救急救命士',
  '保育士','社会福祉士','精神保健福祉士','看護助手'
]

// セッション管理（UIのサマリー反映用）
const sessions = new Map()
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      candidateNumber: '',     // 表示名は「求職者ID」
      qualification: '',       // タグに整合した正式名を入れる（未マッチは空）
      memoQualification: '',   // 職種原文メモ（未マッチ時でも残す）
      workplace: '',           // 現職（原文保存）
      transferReason: '',      // 転職目的（タグ整合は別途拡張予定）
      mustConditions: [],      // Mustタグ
      wantConditions: [],      // Wantタグ
      canDo: '',               // 原文保存（UIは空なら「済」表示）
      willDo: '',              // 原文保存（UIは空なら「済」表示）
    })
  }
  return sessions.get(sessionId)
}

// 共感セリフ（Stepごとに固定で先頭に付与）
function empathyPrefix(step) {
  switch (step) {
    case 1:
      return 'なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎'
    case 2:
      return 'OK！それはすごく大事な条件だね！'
    case 3:
      return 'なるほど、そこは避けたいポイントなんだね！'
    case 4:
      return '了解、これまでの経験はしっかり把握したよ。'
    case 5:
      return 'いいね、その挑戦は前に進むパワーになる！'
    default:
      return ''
  }
}

// 部分一致で1件でも該当するタグを返す（最初にマッチしたもの）
function matchQualificationTag(input) {
  const text = (input || '').trim()
  if (!text) return null
  // 完全一致優先
  const exact = qualificationTags.find(t => t === text)
  if (exact) return exact
  // 部分一致
  const partial = qualificationTags.find(t => text.includes(t) || t.includes(text))
  return partial || null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      message = '',
      currentStep = 0,
      candidateNumber = '',
      isNumberConfirmed = false,
      sessionId = 'default',
    } = req.body

    const session = getSession(sessionId)

    // --- Step0: 求職者ID 確認＆基本情報の収集 ---
    if (currentStep === 0) {
      // まだID未確定 → ID抽出
      if (!isNumberConfirmed) {
        // 英数ハイフン含むID想定（必要なら正規表現を強化してOK）
        const idMatch = (message || '').match(/[A-Za-z0-9\-_]+/)
        if (idMatch) {
          const extracted = idMatch[0]
          session.candidateNumber = extracted
          return res.json({
            response:
`求職者ID：${extracted} で確認したよ！
次は【今の職種（所有資格）】を教えてね。例）看護師／歯科衛生士／介護福祉士 など

（IDは「メール」で届いているやつだよ。LINEではないよ！）`,
            candidateNumber: extracted,
            isNumberConfirmed: true,
            step: 0,
            sessionData: session,
          })
        } else {
          return res.json({
            response:
`すみません、最初に【求職者ID】を教えてください。
IDは「メール」に届いているやつ（LINEではありません）。

IDが確認できたら、続けて
・今の職種（所有資格）
・今どこで働いてる？
を聞いていくよ！`,
            step: 0,
            sessionData: session,
          })
        }
      }

      // ここからはID確定後：職種→現職の順で受ける
      if (!session.qualification) {
        // 職種（所有資格タグに整合／原文メモも保存）
        const input = (message || '').trim()
        const tag = matchQualificationTag(input)
        session.memoQualification = input
        session.qualification = tag ? tag : '' // 未マッチは空（UIは「済」）
        return res.json({
          response:
`ありがとう！職種（所有資格）を記録したよ${session.qualification ? `（タグ：${session.qualification}）` : '（タグ未マッチ：内部メモで保持）'}。
次は【今どこで働いてる？】を教えてね（例：総合病院の急性期病棟／訪問看護／歯科クリニック 等）`,
          step: 0, // まだ基本情報内
          sessionData: session,
        })
      } else if (!session.workplace) {
        // 現職（原文保存）
        session.workplace = (message || '').trim()
        return res.json({
          response:
`ありがとう！基本情報はここまで。
はじめに、今回の【転職理由】を教えてほしいな。きっかけってどんなことだった？

しんどかったこと、無理だと思ったこと、逆に挑戦したいこと、何でもOKだよ◎`,
          step: 1, // 転職理由へ進める
          sessionData: session,
        })
      }
    }

    // --- Step1以降：OpenAIに委譲＋共感セリフ固定で前置き ---
    const systemPrompt = `あなたはHOAPのAIキャリアエージェント。医療・介護・歯科の求職者から自然に情報を引き出し、
セッションデータ（転職目的・Must・Want・Can・Will）を正確に更新する。

必須ルール:
- 「求職者ID」はユーザー入力どおりに保持（session.candidateNumber）
- 「職種（所有資格）」はタグに一致させる（未マッチ時は空／原文は memoQualification に保持済み）
- 「現職」は原文のまま保存
- 転職目的・Must・Wantは登録済みタグに一致させる（未マッチは空→UIで「済」表示）
- Can/Willは自由記述のまま保存（UIは空なら「済」表示）
- 候補提示は最大3件
- 進行制御はセリフで誘導（「じゃあ次の質問！」「それじゃあ次に…」「質問は残り2つ！」「これが最後の質問👏」「今日はたくさん話してくれてありがとう！」のいずれかを含める）
- 出力は自然な日本語、簡潔・明瞭に。

現在のステップ: ${currentStep}
現在のセッション: ${JSON.stringify(session)}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message || '' },
      ],
      max_tokens: 800,
      temperature: 0.3,
    })

    let response = completion.choices?.[0]?.message?.content?.trim() || ''

    // 共感セリフを先頭に付ける
    const prefix = empathyPrefix(currentStep)
    if (prefix) {
      response = `${prefix}\n\n${response}`
    }

    // 簡易ステップ遷移（セリフ検知）
    let nextStep = currentStep
    if (response.includes('じゃあ次の質問！') && currentStep === 1) {
      nextStep = 2
    } else if (response.includes('それじゃあ次に') && currentStep === 2) {
      nextStep = 3
    } else if (response.includes('質問は残り2つ！') && currentStep === 3) {
      nextStep = 4
    } else if (response.includes('これが最後の質問') && currentStep === 4) {
      nextStep = 5
    } else if (response.includes('今日はたくさん話してくれてありがとう！') && currentStep === 5) {
      nextStep = 6
    }

    // ここで将来的に：message内容から Must/Want/Can/Will を解析して session を更新する処理を追加予定

    return res.json({
      response,
      step: nextStep,
      candidateNumber: session.candidateNumber,
      isNumberConfirmed: !!session.candidateNumber,
      sessionData: session, // UIサマリー用
    })
  } catch (error) {
    console.error('Error in chat API:', error)
    return res.status(500).json({ message: 'Internal server error', error: error.message })
  }
}
