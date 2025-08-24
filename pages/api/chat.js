// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/* =========================================================
   共有メッセージ（固定セリフ）
========================================================= */
const STEP2_PROMPT = `じゃあ次の質問！
今回の転職でこれだけは絶対譲れない！というのを教えて！
仕事内容でも、制度でも、条件でもOK◎

例えば・・・
「絶対土日休みじゃないと困る！」
「絶対オンコールはできない！」

後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`

const STEP3_PROMPT = `それじゃあ次に、こうだったらいいな、というのを聞いていくね。 
これも仕事内容でも、制度でも、条件面でもOK◎

例えば・・・
「マイカー通勤ができると嬉しいな」
「できれば夜勤がないといいな」
って感じ！`

/* =========================================================
   転職理由カテゴリ辞書（修正版分岐フローの司令塔）
========================================================= */
const REASON_CATS = {
  '経営・組織に関すること': {
    keywords: ['理念','方針','価値観','経営','運営','マネジメント','方向性','ビジョン','ミッション','考え方','姿勢','経営陣','トップ','風通し','意見','発言','評価制度','評価','昇給','昇格','公平','基準','教育体制','研修','マニュアル','OJT','フォロー','教育','サポート','現場理解','売上','数字'],
    internal: [
      'MVV・経営理念に共感できる職場で働きたい',
      '風通しがよく意見が言いやすい職場で働きたい',
      '評価制度が導入されている職場で働きたい',
      '教育体制が整備されている職場で働きたい',
      '経営者が医療職のところで働きたい',
      '経営者が医療職ではないところで働きたい',
    ],
  },
  '働く仲間に関すること': {
    keywords: ['人間関係','職場の雰囲気','上司','先輩','同僚','チームワーク','いじめ','パワハラ','セクハラ','陰口','派閥','お局','理不尽','相談できない','孤立','コミュニケーション','ロールモデル','尊敬','憧れ','見習いたい','価値観','温度感','やる気','信頼','品格','一貫性','目標','手本','職種','連携','助け合い','壁','分断','古株','権力','圧','支配'],
    internal: [
      '人間関係のトラブルが少ない職場で働きたい',
      '同じ価値観を持つ仲間と働きたい',
      '尊敬できる上司・経営者と働きたい',
      'ロールモデルとなる上司や先輩がほしい',
      '職種関係なく一体感がある仲間と働きたい',
      'お局がいない職場で働きたい',
    ],
  },
  '仕事内容・キャリアに関すること': {
    keywords: ['スキルアップ','成長','挑戦','やりがい','業務内容','専門性','研修','教育','キャリア','昇進','昇格','資格取得','経験','学べる','新しい','幅を広げる','強み','活かす','得意','未経験','分野','患者','利用者','貢献','実感','書類','件数','役立つ','ありがとう','責任','役職','機会','道筋','登用'],
    internal: [
      '今までの経験や自分の強みを活かしたい',
      '未経験の仕事／分野に挑戦したい',
      'スキルアップしたい',
      '患者・利用者への貢献実感を感じられる仕事に携われる',
      '昇進・昇格の機会がある',
    ],
  },
  '労働条件に関すること': {
    keywords: ['残業','夜勤','休日','有給','働き方','時間','シフト','勤務時間','連勤','休憩','オンコール','呼び出し','副業','兼業','診療時間','自己研鑽','勉強','学習','研修時間','直行直帰','事務所','立ち寄り','朝礼','日報','定時','サービス残業','申請制','人員配置','希望日','半休','時間有休','承認','就業規則','兼業','許可','始業前','準備','清掃','打刻'],
    internal: [
      '直行直帰ができる職場で働きたい',
      '残業のない職場で働きたい',
      '希望通りに有給が取得できる職場で働きたい',
      '副業OKな職場で働きたい',
      '診療時間内で自己研鑽できる職場で働きたい',
      '前残業のない職場で働きたい',
    ],
  },
  'プライベートに関すること': {
    keywords: ['家庭','育児','子育て','両立','ライフステージ','子ども','家族','介護','保育園','送迎','学校行事','通院','発熱','中抜け','時短','イベント','飲み会','BBQ','社員旅行','早朝清掃','強制','業務外','就業後','休日','オフ','プライベート','仲良く','交流','ごはん','趣味'],
    internal: [
      '家庭との両立に理解のある職場で働きたい',
      '勤務時間外でイベントがない職場で働きたい',
      'プライベートでも仲良くしている職場で働きたい',
    ],
  },
  '職場環境・設備': {
    keywords: ['設備','環境','施設','器械','機器','システム','IT','デジタル','古い','新しい','最新','設置','導入','整備'],
    internal: [],
  },
  '職場の安定性': {
    keywords: ['安定','将来性','経営状況','倒産','リストラ','不安','継続','持続','成長','発展','将来','先行き'],
    internal: [],
  },
  '給与・待遇': {
    keywords: ['給料','給与','年収','月収','手取り','賞与','ボーナス','昇給','手当','待遇','福利厚生','安い','低い','上がらない','生活できない','お金'],
    internal: [],
  },
}

/* =========================================================
   Must / Want 照合辞書（ラベル文字列一致ベース）
   ※ラベルはそのまま提示・保存する
========================================================= */
const MUSTWANT_LABELS = [
  // サービス形態/分野など（抜粋＋既存辞書）
  '急性期病棟','回復期病棟','慢性期・療養型病院','一般病院','地域包括ケア病棟','緩和ケア病棟（ホスピス）','クリニック','精神科病院',
  '訪問看護ステーション','機能強化型訪問看護ステーション','訪問リハビリテーション','通所介護（デイサービス）','通所リハビリテーション（デイケア）',
  '特別養護老人ホーム','介護老人保健施設','介護付き有料老人ホーム','サービス付き高齢者向け住宅（サ高住）','住宅型有料老人ホーム',
  '訪問歯科','歯科クリニック','歯科口腔外科（病院内診療科）',
  // 勤務条件
  '4週8休以上','年間休日120日以上','土日祝休み','週休2日','週休3日','日勤のみ可','夜勤専従あり','残業ほぼなし','オンコールなし・免除可',
  '直行直帰OK','駅近（5分以内）','車通勤可','駐車場完備','時短勤務相談可',
  // 待遇など
  '年収400万以上','年収450万以上','年収500万以上','賞与あり','退職金あり',
  // 制度/文化
  '社会保険完備','交通費支給','ハラスメント相談窓口あり','研修制度あり','資格取得支援あり','評価制度あり','メンター制度あり',
]

/* =========================================================
   セッション
========================================================= */
const sessions = new Map()
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      // 基本情報
      candidateNumber: '',
      qualification: '',
      workplace: '',
      // Step1
      s1Deep: 0,
      s1Category: null,
      s1Tie: null, // ['A','B'] -> ['カテゴリ名1','カテゴリ名2']
      s1Options: [], // internal options 現在提示中
      reasonTag: '', // 確定 or '未分類'
      // Step2/3
      must: [],
      want: [],
      s2Pending: false,
      s3Pending: false,
    })
  }
  return sessions.get(id)
}

/* =========================================================
   ヘルパー
========================================================= */
const sanitizeNG = (t) =>
  (t || '')
    .replace(/絶対[\s　]*ＮＧ/gi, '絶対条件')
    .replace(/絶対[\s　]*NG/gi, '絶対条件')
    .replace(/ＮＧ/g, '避けたい')
    .replace(/(?<![A-Za-z0-9])NG(?![A-Za-z0-9])/g, '避けたい')

function scoreCategory(text) {
  const scores = {}
  for (const [cat, def] of Object.entries(REASON_CATS)) {
    scores[cat] = 0
    def.keywords.forEach((k) => {
      if (text.includes(k)) scores[cat] += 1
    })
  }
  return scores
}

function pickReasonCategory(userText) {
  const text = userText || ''
  const scores = scoreCategory(text)

  // プライベート優先トリガー
  const privateWords = ['家庭','育児','子育て','両立','子ども','家族']
  const hasPrivate = privateWords.some((w) => text.includes(w))
  if (hasPrivate) return { cat: 'プライベートに関すること', tie: null }

  // 夜勤単語のみ → 文脈確認へ（カテゴリ未確定）
  if (/夜勤/.test(text) && !hasPrivate) {
    const lc = scores['労働条件に関すること'] || 0
    const restMax = Math.max(
      scores['プライベートに関すること'] || 0,
      scores['仕事内容・キャリアに関すること'] || 0,
      scores['働く仲間に関すること'] || 0,
      scores['経営・組織に関すること'] || 0,
      scores['職場環境・設備'] || 0,
      scores['職場の安定性'] || 0,
      scores['給与・待遇'] || 0
    )
    if (lc >= 1 && restMax === 0) {
      // 夜勤だけなら判定保留（フロント深掘りへ）
      return { cat: null, tie: null, ask:
        '夜勤が大変ということだね。これは「家庭との両立の観点」と「働き方（シフト/負担）の観点」どっちが近い？\nA) 両立の観点\nB) 働き方の観点'
      }
    }
  }

  // 最大スコア
  const entries = Object.entries(scores)
  entries.sort((a,b)=>b[1]-a[1])
  const top = entries[0]
  const second = entries[1]
  if (!top || top[1] === 0) return { cat: null, tie: null }

  if (second && top[1] === second[1]) {
    return { cat: null, tie: [top[0], second[0]] }
  }
  return { cat: top[0], tie: null }
}

function presentInternal(cat) {
  const arr = REASON_CATS[cat]?.internal || []
  return arr.slice(0, 3) // 2〜3件
}

function formatChoices(labels) {
  // 『［tag_label］』 形式で提示（番号選択）
  const lines = labels.map((t, i) => `${i + 1}) 『［${t}］』`)
  return `次のうち近いものを選んでね。（番号でOK）\n${lines.join('\n')}`
}

function numberPick(t) {
  const m = (t || '').match(/([1-3])/)
  return m ? parseInt(m[1], 10) : null
}

function matchLabelsFromText(text) {
  const hits = []
  for (const lbl of MUSTWANT_LABELS) {
    if (text.includes(lbl)) hits.push(lbl)
  }
  return hits.slice(0, 3)
}

/* =========================================================
   Handler
========================================================= */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  try {
    const {
      message,
      currentStep = 0,
      sessionId = 'default',
      candidateNumber,
      isNumberConfirmed,
      qualification,
      workplace,
      conversationHistory = [],
    } = req.body

    const S = getSession(sessionId)
    if (candidateNumber) S.candidateNumber = candidateNumber
    if (qualification) S.qualification = qualification
    if (workplace) S.workplace = workplace

    // Step0 はフロント固定制御
    if (currentStep === 0 && (!isNumberConfirmed || !S.qualification || !S.workplace)) {
      return res.json({ response: '番号→所有資格→勤務先の順で入力してね！', step: 0 })
    }

    /* ----------------------------------------
       Step1：転職理由（司令塔ロジック）
    ---------------------------------------- */
    if (currentStep === 1) {
      const user = (message || '').trim()

      // A/B タイブレークの回答処理
      if (S.s1Tie && /^(a|b|Ａ|Ｂ)$/i.test(user)) {
        const pick = /a|Ａ/i.test(user) ? S.s1Tie[0] : S.s1Tie[1]
        S.s1Tie = null
        S.s1Category = pick
      }

      // 夜勤→両立or働き方 の確認回答
      if (!S.s1Category && /^(a|b|Ａ|Ｂ)$/i.test(user) && S.s1Deep === -1) {
        S.s1Deep = 0
        S.s1Category = /a|Ａ/i.test(user) ? 'プライベートに関すること' : '労働条件に関すること'
      }

      // まだカテゴリ未確定なら判定
      if (!S.s1Category && !S.s1Tie) {
        const judged = pickReasonCategory(user)
        if (judged.ask) {
          S.s1Deep = -1 // 特殊分岐
          return res.json({
            response: sanitizeNG(judged.ask),
            step: 1,
            sessionData: S,
          })
        }
        if (judged.tie) {
          S.s1Tie = judged.tie
          return res.json({
            response: sanitizeNG(`${judged.tie[0]} と ${judged.tie[1]}、どちらも気になってるんだね。\nどちらが今回の転職で一番重要？\nA) ${judged.tie[0]} の方が主な理由\nB) ${judged.tie[1]} の方が主な理由`),
            step: 1,
            sessionData: S,
          })
        }
        S.s1Category = judged.cat
      }

      // 深掘り回数管理（最大2回、3回目で提示/未マッチ）
      if (S.s1Deep >= 2 && !S.s1Options.length) {
        if (S.s1Category) {
          const ops = presentInternal(S.s1Category)
          if (ops.length) {
            S.s1Options = ops
            return res.json({
              response: sanitizeNG(formatChoices(ops)),
              step: 1,
              sessionData: S,
            })
          }
        }
        // 内部候補なし or 未分類 → 未マッチ処理→Step2へ
        S.reasonTag = '未分類'
        return res.json({
          response: sanitizeNG(`なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n\nありがとう！\n${STEP2_PROMPT}`),
          step: 2,
          sessionData: S,
        })
      }

      // すでに選択肢提示中→番号で確定
      if (S.s1Options.length) {
        const n = numberPick(user)
        if (n && n >= 1 && n <= S.s1Options.length) {
          S.reasonTag = S.s1Options[n - 1]
          S.s1Options = []
          return res.json({
            response: sanitizeNG(`そっか、『［${S.reasonTag}］』が一番近いってことだね、了解！\n\nありがとう！\n${STEP2_PROMPT}`),
            step: 2,
            sessionData: S,
          })
        }
        // 選択肢以外→番号促し
        return res.json({
          response: sanitizeNG(`ごめん！番号で選んでね。\n${formatChoices(S.s1Options)}`),
          step: 1,
          sessionData: S,
        })
      }

      // 通常フロー：カテゴリ確定→内部候補があれば提示／なければ未マッチ扱い
      if (S.s1Category) {
        const ops = presentInternal(S.s1Category)
        if (ops.length) {
          S.s1Options = ops
          S.s1Deep += 1
          return res.json({
            response: sanitizeNG(formatChoices(ops)),
            step: 1,
            sessionData: S,
          })
        } else {
          S.reasonTag = '未分類'
          return res.json({
            response: sanitizeNG(`なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n\nありがとう！\n${STEP2_PROMPT}`),
            step: 2,
            sessionData: S,
          })
        }
      }

      // まだ判定できない→深掘り質問（最大2回）
      S.s1Deep += 1
      return res.json({
        response: sanitizeNG('もう少しだけ詳しく教えて！\n具体的にはどんな場面/出来事が一番のきっかけになった？'),
        step: 1,
        sessionData: S,
      })
    }

    /* ----------------------------------------
       Step2：絶対希望（Must）
    ---------------------------------------- */
    if (currentStep === 2) {
      const user = (message || '').trim()
      // 初回誘導
      if (!S.s2Pending && S.must.length === 0) {
        S.s2Pending = true
        return res.json({ response: sanitizeNG(STEP2_PROMPT), step: 2, sessionData: S })
      }

      // 照合
      const hits = matchLabelsFromText(user)
      if (hits.length) {
        // 1件ずつ確定報告
        S.must.push(...hits)
        return res.json({
          response: sanitizeNG(`そっか、${hits.map((h)=>`『［${h}］』`).join(' と ')} が絶対ってことだね！\n他にも絶対条件はある？（「ある」/「ない」）`),
          step: 2,
          sessionData: S,
        })
      }

      // 追加の有無
      if (/^ない$|^もうない$|^大丈夫$/i.test(user)) {
        S.s2Pending = false
        return res.json({
          response: sanitizeNG(`ありがとう！\n${STEP3_PROMPT}`),
          step: 3,
          sessionData: S,
        })
      }
      if (/^ある$|^はい$|^もう一つ$|^追加$/i.test(user)) {
        return res.json({
          response: sanitizeNG('OK！絶対条件を続けて教えて。キーワードでもラベルそのままでも大丈夫だよ。'),
          step: 2,
          sessionData: S,
        })
      }

      // ヒットなし → 短問深掘り（2回まで）
      if (!S._s2Drill) S._s2Drill = 0
      if (S._s2Drill < 2) {
        S._s2Drill += 1
        return res.json({
          response: sanitizeNG('対象（施設形態・働き方・待遇など）と最低ラインがあれば教えて！（例：日勤のみ／残業ほぼなし／駅近など）'),
          step: 2,
          sessionData: S,
        })
      }
      // 3回目は候補提示（固定候補から抜粋）
      const suggest = MUSTWANT_LABELS.slice(0, 3)
      return res.json({
        response: sanitizeNG(`候補を挙げるね。番号でOK！\n${suggest.map((l,i)=>`${i+1}) 『［${l}］'`).join('\n')}`),
        step: 2,
        sessionData: S,
      })
    }

    /* ----------------------------------------
       Step3：できれば希望（Want）
    ---------------------------------------- */
    if (currentStep === 3) {
      const user = (message || '').trim()
      if (!S.s3Pending && S.want.length === 0) {
        S.s3Pending = true
        return res.json({ response: sanitizeNG(STEP3_PROMPT), step: 3, sessionData: S })
      }

      const hits = matchLabelsFromText(user)
      if (hits.length) {
        S.want.push(...hits)
        return res.json({
          response: sanitizeNG(`了解！${hits.map((h)=>`『［${h}］』`).join(' と ')} だと嬉しいってことだね！\n他にもある？（「ある」/「ない」）`),
          step: 3,
          sessionData: S,
        })
      }

      if (/^ない$|^もうない$|^大丈夫$/i.test(user)) {
        S.s3Pending = false
        // ここからは OpenAI に任せる（Can→Will の自然誘導）
        const sys = `
あなたはHOAPのAIキャリアエージェント。以降は Step4:いままで（Can）→Step5:これから（Will）へ自然に誘導し、原文保持で整理する。
- 「絶対NG」等は使わず、「避けたい条件」などに言い換える。
- 短く具体質問を添えて深掘り。
基本情報: 番号:${S.candidateNumber||'(未)'} / 資格:${S.qualification||'(未)'} / 勤務先:${S.workplace||'(未)'}
`.trim()
        const msgs = [{ role: 'system', content: sys }]
        conversationHistory.forEach(m=>{
          if (m?.content) msgs.push({ role: m.type==='ai'?'assistant':'user', content: m.content })
        })
        msgs.push({ role: 'user', content: '分かった。次に進もう。' })

        const comp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: msgs,
          max_tokens: 600,
          temperature: 0.3,
        })
        const out = sanitizeNG(comp.choices?.[0]?.message?.content || 'ここまでありがとう。次は、これまで（Can）を教えてね。')
        return res.json({ response: out, step: 4, sessionData: S })
      }

      if (/^ある$|^はい$|^追加$/i.test(user)) {
        return res.json({
          response: sanitizeNG('OK！「できれば」条件を続けてどうぞ。'),
          step: 3,
          sessionData: S,
        })
      }

      // 深掘り（最大2回）
      if (!S._s3Drill) S._s3Drill = 0
      if (S._s3Drill < 2) {
        S._s3Drill += 1
        return res.json({
          response: sanitizeNG('優先度が高い順に1〜2個、キーワードでOK！（例：車通勤／駅近／残業少なめ）'),
          step: 3,
          sessionData: S,
        })
      }
      // 候補提示
      const suggest = MUSTWANT_LABELS.slice(3, 6)
      return res.json({
        response: sanitizeNG(`このあたりはどう？番号でOK！\n${suggest.map((l,i)=>`${i+1}) 『［${l}］'`).join('\n')}`),
        step: 3,
        sessionData: S,
      })
    }

    /* ----------------------------------------
       Step4以降は既存挙動（OpenAI）に委譲
    ---------------------------------------- */
    const systemPrompt = `
あなたはHOAPのAIキャリアエージェント。会話フローを守り、過度な共感は避け、短く具体質問で深掘り。
- 「絶対NG」「NG」は使わず、「避けたい条件」「絶対条件」などに変換。
- Step4: いままで（Can）→ Step5: これから（Will）へ。
`.trim()

    const msgs = [{ role: 'system', content: systemPrompt }]
    conversationHistory.forEach(m=>{
      if (m?.content) msgs.push({ role: m.type==='ai'?'assistant':'user', content: m.content })
    })
    msgs.push({ role: 'user', content: message })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: msgs,
      max_tokens: 700,
      temperature: 0.3,
    })
    const response = sanitizeNG(completion.choices?.[0]?.message?.content || '')
    let nextStep = currentStep
    if (currentStep === 4 && /(これから|Will|挑戦|やりたい|最後)/.test(response)) nextStep = 5
    if (currentStep === 5 && /(ありがとう|以上|整理できた)/.test(response)) nextStep = 6

    return res.json({ response, step: nextStep, sessionData: S })
  } catch (e) {
    console.error('chat api error', e)
    return res.status(500).json({ message: 'Internal server error', error: String(e?.message || e) })
  }
}
