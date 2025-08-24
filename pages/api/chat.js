// pages/api/chat.js
import fs from 'fs'
import path from 'path'

// セッション保持（簡易）
const sessions = new Map()

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step1: { deep: 0, cat: null, pendingOptions: null },
      must: [],
      want: [],
      canDo: '',
      willDo: '',
    })
  }
  return sessions.get(id)
}

// JSONロード（起動時1回）
const root = process.cwd()
const reasonFlow = JSON.parse(
  fs.readFileSync(path.join(root, 'public', 'tags', 'transfer_reason_flow.json'), 'utf-8')
)
const mustwant = JSON.parse(
  fs.readFileSync(path.join(root, 'public', 'tags', 'mustwant.json'), 'utf-8')
)

// ------- 転職理由：分類 ----------
function classifyReason(text) {
  // 8カテゴリそれぞれにキーワードスコア
  const scores = {}
  Object.keys(reasonFlow).forEach((cat) => (scores[cat] = 0))
  for (const cat of Object.keys(reasonFlow)) {
    for (const kw of reasonFlow[cat].keywords) {
      if (text.includes(kw)) scores[cat]++
    }
  }

  // 明示優先ルール
  if (/(家庭|育児|子育て|両立|子ども)/.test(text)) {
    return { cat: 'プライベートに関すること', tie: false }
  }

  // 「夜勤」単体は労働条件に安易に振らない（文脈不足）
  if (/夜勤/.test(text) && !/(残業|シフト|休日|有給)/.test(text)) {
    // 深掘りで再質問させたいので未確定扱い
    return { cat: null, tie: false }
  }

  const max = Math.max(...Object.values(scores))
  if (max <= 0) return { cat: null, tie: false }

  const tops = Object.keys(scores).filter((k) => scores[k] === max)
  if (tops.length > 1) return { cat: tops.slice(0, 2), tie: true }

  return { cat: tops[0], tie: false }
}

// ------- Must/Want 照合 ----------
function matchTags(text, pool, max = 3) {
  const hits = []
  for (const item of pool) {
    if (text.includes(item)) hits.push(item)
    if (hits.length >= max) break
  }
  return hits
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ msg: 'Method Not Allowed' })
  const { sessionId, currentStep, candidate, message } = req.body
  const S = getSession(sessionId)
  const say = (t) => res.json({ reply: t, nextStep: currentStep, header: {} })

  // Step1: 転職理由
  if (currentStep === 1) {
    // まず分類
    const cls = classifyReason(message)

    // 同点 → どっちを主にするか二択
    if (cls.tie && Array.isArray(cls.cat)) {
      return say(
        `${cls.cat[0]} と ${cls.cat[1]}、どちらも気になってるんだね。\nどちらが今回いちばん重要？\nA) ${cls.cat[0]}\nB) ${cls.cat[1]}`
      )
    }
    // 二択の回答を受け入れる
    if (/^\s*[AB]\s*$/i.test(message) && Array.isArray(S.step1.awaitTwo)) {
      const pick = /^a/i.test(message) ? S.step1.awaitTwo[0] : S.step1.awaitTwo[1]
      S.step1.cat = pick
      S.step1.awaitTwo = null
    } else if (cls.tie) {
      // 初出の二択提示
      S.step1.awaitTwo = cls.cat
      return
    }

    // カテゴリ確定していなければ深掘り
    const cat = S.step1.cat || cls.cat
    if (!cat) {
      S.step1.deep++
      if (S.step1.deep <= 2) {
        return say(
          'もう少し詳しく教えて！\n（例：人間関係／評価制度／残業・休日／育児との両立 などの言葉があると助かる）'
        )
      }
      // 深掘り上限 → 未マッチ扱いで次へ
      S.step1.deep = 0
      S.step1.cat = null
      return res.json({
        reply: 'なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n\nじゃあ次の質問！\n今回の転職で「これだけは絶対譲れない！」というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。',
        nextStep: 2,
        header: {},
      })
    }

    // カテゴリ確定：内部候補提示 or 共感のみ
    const node = reasonFlow[cat]
    S.step1.cat = cat

    if (node.internal_options && node.internal_options.length >= 2) {
      const opts = node.internal_options.slice(0, 3)
      S.step1.pendingOptions = opts
      const lines = opts.map((o, i) => `${i + 1}) ${o}`).join('\n')
      return say(
        `うん、その視点めちゃ大事！\n次のうち近いものを選んでね（番号でOK）\n${lines}`
      )
    } else {
      // 給与・待遇 / 環境設備 / 安定性 などは候補なし → 共感のみで次へ
      S.step1.deep = 0
      S.step1.cat = null
      return res.json({
        reply:
          'なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n\nじゃあ次の質問！\n今回の転職で「これだけは絶対譲れない！」というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。',
        nextStep: 2,
        header: {},
      })
    }
  }

  // Step1: 内部候補の番号選択
  if (currentStep === 1 && /^\s*[1-3]\s*$/.test(message) && S.step1.pendingOptions) {
    const idx = Number(message.trim()) - 1
    const pick = S.step1.pendingOptions[idx]
    S.step1.pendingOptions = null
    S.step1.cat = null
    return res.json({
      reply:
        `了解！『${pick}』で受け取ったよ。\n\nじゃあ次の質問！\n今回の転職で「これだけは絶対譲れない！」というのを教えて！\n仕事内容でも、制度でも、条件でもOK◎\n\n例えば・・・\n「絶対土日休みじゃないと困る！」\n「絶対オンコールはできない！」\n\n後から『あるといいな』『ないといいな』についても聞くから、今は『絶対！』というものだけ教えてね。`,
      nextStep: 2,
      header: {},
    })
  }

  // Step2: Must
  if (currentStep === 2) {
    // “ない/大丈夫/以上” → 次へ
    if (/^(ない|大丈夫|以上|特にない)/.test(message)) {
      return res.json({
        reply:
          '了解！じゃあ次に、こうだったらいいな、というのを聞いていくね。\nこれも仕事内容でも、制度でも、条件面でもOK◎\n\n例えば・・・\n「マイカー通勤ができると嬉しいな」\n「できれば夜勤がないといいな」\nって感じ！',
        nextStep: 3,
        header: { mustCount: S.must.length },
      })
    }

    const hits = matchTags(message, mustwant.pool, 3)
    if (hits.length) {
      // 重複除外
      for (const h of hits) if (!S.must.includes(h)) S.must.push(h)
      return res.json({
        reply:
          `そっか、『${hits.join('／')}』が絶対ってことだね！他にも絶対条件はある？（なければ「ない」）`,
        nextStep: 2,
        header: { mustCount: S.must.length },
      })
    }

    // 深掘り
    return res.json({
      reply:
        '了解！どんな「絶対」をもう少しだけ具体的に！（例：残業ほぼなし／日勤のみ可／直行直帰OK など）',
      nextStep: 2,
      header: { mustCount: S.must.length },
    })
  }

  // Step3: Want
  if (currentStep === 3) {
    if (/^(ない|大丈夫|以上|特にない)/.test(message)) {
      return res.json({
        reply:
          '質問は残り2つ！これまでやってきたことを自然文で教えて。簡条書きでもOK。',
        nextStep: 4,
        header: { wantCount: S.want.length },
      })
    }

    const hits = matchTags(message, mustwant.pool, 3)
    if (hits.length) {
      for (const h of hits) if (!S.want.includes(h)) S.want.push(h)
      return res.json({
        reply: `了解！『${hits.join('／')}』だと嬉しいってことだね！ 他にもある？（なければ「ない」）`,
        nextStep: 3,
        header: { wantCount: S.want.length },
      })
    }

    return res.json({
      reply: 'OK！「できれば」はどんな感じ？キーワードでOK！（例：車通勤可／駅近／残業ほぼなし など）',
      nextStep: 3,
      header: { wantCount: S.want.length },
    })
  }

  // Step4: いままで（Can）
  if (currentStep === 4) {
    S.canDo = (S.canDo ? S.canDo + '\n' : '') + message
    return res.json({
      reply: 'これが最後の質問👏 これから挑戦したいこと・やってみたいことを教えて。',
      nextStep: 5,
      header: {},
    })
  }

  // Step5: これから（Will）
  if (currentStep === 5) {
    S.willDo = (S.willDo ? S.willDo + '\n' : '') + message
    return res.json({
      reply:
        '今日はたくさん話してくれてありがとう！\nあなたの希望は担当エージェントに共有するね。\nこのまま面談に進もう！',
      nextStep: 5,
      header: {},
    })
  }

  // それ以外
  return say('OK')
}
