// pages/api/chat.js
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ===== 転職理由 分岐フロー（司令塔） =====
const transferReasonFlow = {
  '経営・組織に関すること': {
    keywords: ['理念','方針','価値観','経営','運営','マネジメント','方向性','ビジョン','ミッション','評価','昇給','昇格','教育','研修','OJT','フォロー','現場理解','風通し'],
    internal_options: [
      'MVV・経営理念に共感できる職場で働きたい',
      '風通しがよく意見が言いやすい職場で働きたい',
      '評価制度が導入されている職場で働きたい',
      '教育体制が整備されている職場で働きたい',
      '経営者が医療職のところで働きたい',
      '経営者が医療職ではないところで働きたい',
    ],
  },
  '働く仲間に関すること': {
    keywords: ['人間関係','雰囲気','上司','先輩','同僚','チーム','パワハラ','派閥','お局','尊敬','ロールモデル','温度感','一体感'],
    internal_options: [
      '人間関係のトラブルが少ない職場で働きたい',
      '同じ価値観を持つ仲間と働きたい',
      '尊敬できる上司・経営者と働きたい',
      'ロールモデルとなる上司や先輩がほしい',
      '職種関係なく一体感がある仲間と働きたい',
      'お局がいない職場で働きたい',
    ],
  },
  '仕事内容・キャリアに関すること': {
    keywords: ['スキル','成長','挑戦','やりがい','業務','専門性','昇進','資格','患者','利用者','貢献','登用'],
    internal_options: [
      '今までの経験や自分の強みを活かしたい',
      '未経験の仕事／分野に挑戦したい',
      'スキルアップしたい',
      '患者・利用者への貢献実感を感じられる仕事に携われる',
      '昇進・昇格の機会がある',
    ],
  },
  '労働条件に関すること': {
    keywords: ['残業','夜勤','休日','有給','シフト','勤務時間','オンコール','直行直帰','サービス残業','人員配置','就業規則'],
    internal_options: [
      '直行直帰ができる職場で働きたい',
      '残業のない職場で働きたい',
      '希望通りに有給が取得できる職場で働きたい',
      '副業OKな職場で働きたい',
      '社会保険を完備している職場で働きたい',
      '診療時間内で自己研鑽できる職場で働きたい',
      '前残業のない職場で働きたい',
    ],
  },
  'プライベートに関すること': {
    keywords: ['家庭','育児','子育て','両立','子ども','保育園','送迎','学校行事','通院','時短','イベント'],
    internal_options: [
      '家庭との両立に理解のある職場で働きたい',
      '勤務時間外でイベントがない職場で働きたい',
      'プライベートでも仲良くしている職場で働きたい',
    ],
  },
  '職場環境・設備': { keywords: ['設備','器械','機器','システム','IT','デジタル','最新','導入'], internal_options: [] },
  '職場の安定性': { keywords: ['安定','将来性','経営状況','倒産','不安','継続','成長'], internal_options: [] },
  '給与・待遇': { keywords: ['給料','給与','年収','月収','手取り','賞与','ボーナス','手当','待遇','福利厚生'], internal_options: [] },
}

// Must/Want の辞書（代表抜粋）
// 実運用では全件の配列をここに貼る。今回は例示的に最低限で。
const MUSTWANT = [
  '残業ほぼなし', '日勤のみ可', '夜勤専従あり', 'オンコールなし・免除可',
  '直行直帰OK', '駅近（5分以内）', '車通勤可', '社会保険完備', '有給消化率ほぼ100%',
]

const empathy = [
  'なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎',
  'うん、その視点めちゃ大事！転職の根っこだね◎',
  'OK、温度感つかめた！ここはちゃんと整理していこう◎',
]

// ===== セッション管理（インメモリ） =====
const SESS = new Map()
function getS(id) {
  if (!SESS.has(id)) {
    SESS.set(id, {
      reasonTag: null,
      s1Category: null,
      s1Deep: 0,
      s1Options: [],
      _s2Suggest: null,
      _s3Suggest: null,
      must: [],
      want: [],
      can: '',
      will: '',
    })
  }
  return SESS.get(id)
}

// ===== ユーティリティ =====
const pickEmpathy = () => empathy[Math.floor(Math.random() * empathy.length)]
const sanitize = (t) => String(t || '').replace(/絶対NG/g, '（NGは扱わない）')
const numPick = (t) => {
  if (!t) return null
  const m = t.match(/\b([1-9])\b/)
  if (m) return parseInt(m[1], 10)
  const fw = t.match(/[１-９]/)
  if (fw) return '１２３４５６７８９'.indexOf(fw[0]) + 1
  return null
}
const labelPick = (t, ops = []) => {
  const s = String(t || '').trim()
  if (!s) return null
  const exact = ops.findIndex((o) => s === o)
  if (exact >= 0) return exact + 1
  const norm = (v) => v.replace(/\s|　|『|』|「|」/g, '')
  const idx = ops.findIndex((o) => norm(o).startsWith(norm(s)))
  return idx >= 0 ? idx + 1 : null
}
const choices = (ops) => `次のうち近いものを選んでね（番号でOK）\n${ops.map((o, i) => `${i + 1}) 『［${o}］』`).join('\n')}`

function classifyReason(text) {
  const t = String(text)
  // プライベート優先ワード
  if (/(家庭|両立|育児|子ども|保育園|送迎)/.test(t)) return 'プライベートに関すること'
  // 「夜勤」単体は労働条件に即断しない：文脈が他にない時のみ労働条件
  let best = null
  let bestScore = 0
  for (const [cat, cfg] of Object.entries(transferReasonFlow)) {
    const score = cfg.keywords.reduce((acc, k) => acc + (t.includes(k) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }
  if (!best) return null
  // 夜勤だけ、など極小ヒットなら未分類へ
  if (bestScore === 1 && /(夜勤)/.test(t) && !/(家庭|両立|育児|子ども)/.test(t)) {
    return '労働条件に関すること'
  }
  return best
}

function hintMustWant(text) {
  const t = String(text)
  const hits = MUSTWANT.filter((lbl) => t.includes(lbl))
  return Array.from(new Set(hits)).slice(0, 3)
}

// ====== ハンドラ ======
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  try {
    const { message, conversationHistory = [], currentStep = 1, sessionId, basics = {} } = req.body
    const S = getS(sessionId)
    const user = String(message || '')

    // ===== Step1: 転職理由 =====
    if (currentStep === 1) {
      // 選択肢提示中（番号 / ラベル）
      if (S.s1Options.length) {
        const n = numPick(user) ?? labelPick(user, S.s1Options)
        if (n && n >= 1 && n <= S.s1Options.length) {
          S.reasonTag = S.s1Options[n - 1]
          S.s1Options = []
          S.s1Category = null
          S.s1Deep = 0
          return res.json({
            response: sanitize(`そっか、『［${S.reasonTag}］』が一番近いってことだね、了解！\n\nありがとう！\nじゃあ次の質問！\n今回の転職でこれだけは絶対譲れない！というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`),
            step: 2,
            sessionData: S,
          })
        }
        return res.json({
          response: sanitize(`番号（1〜${S.s1Options.length}）か、ラベルそのままで選んでね！\n${choices(S.s1Options)}`),
          step: 1,
          sessionData: S,
        })
      }

      // カテゴリ判定
      const cat = classifyReason(user)
      if (!cat) {
        return res.json({
          response: sanitize(`${pickEmpathy()}\n\n${choices([])}\n（このカテゴリは候補提示なし。次の発話で具体例を教えてね）`),
          step: 1,
          sessionData: S,
        })
      }

      S.s1Category = cat
      S.s1Deep += 1
      const ops = transferReasonFlow[cat].internal_options || []

      if (ops.length) {
        // 2〜3件だけ提示
        const pick = ops.slice(0, 3)
        S.s1Options = pick
        return res.json({
          response: sanitize(`${pickEmpathy()}\n${choices(pick)}`),
          step: 1,
          sessionData: S,
        })
      }
      // 内部候補が空 → 未マッチ処理のみ
      return res.json({
        response: sanitize(`${pickEmpathy()}\n\nありがとう！\nじゃあ次の質問！\n今回の転職でこれだけは絶対譲れない！というのを教えて！\n（仕事内容でも制度でも条件でもOK◎）`),
        step: 2,
        sessionData: S,
      })
    }

    // ===== Step2: Must =====
    if (currentStep === 2) {
      if (S._s2Suggest && S._s2Suggest.length) {
        const n = numPick(user)
        if (n && n >= 1 && n <= S._s2Suggest.length) {
          const chosen = S._s2Suggest[n - 1]
          S.must.push(chosen)
          S._s2Suggest = null
          return res.json({
            response: sanitize(`そっか、『［${chosen}］』が絶対ってことだね！\n他にも絶対条件はある？（「ある」/「ない」）`),
            step: 2,
            sessionData: S,
          })
        }
        return res.json({
          response: sanitize(`番号で選んでね！\n${S._s2Suggest.map((l, i) => `${i + 1}) 『［${l}］'`).join('\n')}`),
          step: 2,
          sessionData: S,
        })
      }

      // 直接ヒット
      const hits = hintMustWant(user)
      if (hits.length) {
        S.must.push(hits[0])
        return res.json({
          response: sanitize(`そっか、『［${hits[0]}］』が絶対ってことだね！\n他にも絶対条件はある？（「ある」/「ない」）`),
          step: 2,
          sessionData: S,
        })
      }

      if (/ある/.test(user)) {
        S._s2Suggest = MUSTWANT.slice(0, 3)
        return res.json({
          response: sanitize(`候補を挙げるね。番号でOK！\n${S._s2Suggest.map((l, i) => `${i + 1}) 『［${l}］'`).join('\n')}`),
          step: 2,
          sessionData: S,
        })
      }
      if (/ない/.test(user)) {
        return res.json({
          response: sanitize(`了解！\nそれじゃあ次に、こうだったらいいな、というのを聞いていくね。\nこれも仕事内容でも、制度でも、条件面でもOK◎\n\n例えば・・・\n「マイカー通勤ができると嬉しいな」\n「できれば夜勤がないといいな」\nって感じ！`),
          step: 3,
          sessionData: S,
        })
      }

      // 深掘り（最小限）
      return res.json({
        response: sanitize(`了解！どんな「絶対」かもう少しだけ具体的に！\n（例：残業ほぼなし／日勤のみ可／直行直帰OK など）`),
        step: 2,
        sessionData: S,
      })
    }

    // ===== Step3: Want =====
    if (currentStep === 3) {
      if (S._s3Suggest && S._s3Suggest.length) {
        const n = numPick(user)
        if (n && n >= 1 && n <= S._s3Suggest.length) {
          const chosen = S._s3Suggest[n - 1]
          S.want.push(chosen)
          S._s3Suggest = null
          return res.json({
            response: sanitize(`了解！『［${chosen}］』だと嬉しいってことだね！\n他にもある？（「ある」/「ない」）`),
            step: 3,
            sessionData: S,
          })
        }
        return res.json({
          response: sanitize(`番号で選んでね！\n${S._s3Suggest.map((l, i) => `${i + 1}) 『［${l}］'`).join('\n')}`),
          step: 3,
          sessionData: S,
        })
      }

      const hits = hintMustWant(user)
      if (hits.length) {
        S.want.push(hits[0])
        return res.json({
          response: sanitize(`了解！『［${hits[0]}］』だと嬉しいってことだね！\n他にもある？（「ある」/「ない」）`),
          step: 3,
          sessionData: S,
        })
      }
      if (/ある/.test(user)) {
        S._s3Suggest = MUSTWANT.slice(3, 6)
        return res.json({
          response: sanitize(`このあたりはどう？番号でOK！\n${S._s3Suggest.map((l, i) => `${i + 1}) 『［${l}］'`).join('\n')}`),
          step: 3,
          sessionData: S,
        })
      }
      if (/ない/.test(user)) {
        return res.json({
          response: sanitize(`質問は残り2つ！\nこれまでやってきたことを自然文で教えて。`),
          step: 4,
          sessionData: S,
        })
      }

      return res.json({
        response: sanitize(`了解！「できれば」どんな感じ？キーワードでOK！\n（例：車通勤可／駅近／残業ほぼなし など）`),
        step: 3,
        sessionData: S,
      })
    }

    // ===== Step4: Can =====
    if (currentStep === 4) {
      S.can = user
      return res.json({
        response: sanitize(`これが最後の質問👏\nこれから挑戦したいこと・やってみたいことを教えて。`),
        step: 5,
        sessionData: S,
      })
    }

    // ===== Step5: Will =====
    if (currentStep === 5) {
      S.will = user
      return res.json({
        response: sanitize(`今日はたくさん話してくれてありがとう！\n整理できた内容は担当エージェントに共有しておくね。`),
        step: 6,
        sessionData: S,
      })
    }

    // フォールバック
    return res.json({
      response: sanitize('OK！続けよう！'),
      step: currentStep,
      sessionData: S,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Internal error' })
  }
}
