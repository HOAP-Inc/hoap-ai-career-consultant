// pages/api/chat.js  —— 全置換
// ほーぷちゃん：Step1〜5の厳密フロー実装（タグは登録済みtag_labelのみ使用）

/* ---------------- 辞書（tag_labelのみ） ---------------- */
// Step1 転職目的カテゴリ → 固定候補（2〜3件/カテゴリ）
const REASON_CANDIDATES = {
  '働く仲間に関すること': [
    '人間関係のトラブルが少ない職場で働きたい',
    '同じ価値観を持つ仲間と働きたい',
    '尊敬できる上司・経営者と働きたい',
  ],
  '労働条件に関すること': [
    '残業のない職場で働きたい',
    '希望通りに有給が取得できる職場で働きたい',
    '副業OKな職場で働きたい',
  ],
  '経営・組織に関すること': [
    '風通しがよく意見が言いやすい職場で働きたい',
    '評価制度が導入されている職場で働きたい',
    '教育体制が整備されている職場で働きたい',
  ],
  '仕事内容・キャリアに関すること': [
    '今までの経験や自分の強みを活かしたい',
    '未経験の仕事／分野に挑戦したい',
    '昇進・昇格の機会がある',
  ],
  'プライベートに関すること': [
    '家庭との両立に理解のある職場で働きたい',
    '勤務時間外でイベントがない職場で働きたい',
  ],
  '職場環境・設備': [
    // ※候補提示は2〜3件ルールだが、ここは候補提示禁止カテゴリにはしていない
    '最新の設備・システムが整った職場で働きたい',
    'デジタルツールが整備された職場で働きたい',
  ],
  '職場の安定性': [
    '将来性のある安定した職場で働きたい',
    '経営が安定している職場で働きたい',
  ],
  '給与・待遇': [
    '昇給・賞与の仕組みが明確な職場で働きたい',
    '手当や福利厚生が充実した職場で働きたい',
  ],
}

// Step2（絶対）/Step3（あったら良い） 用の辞書（tag_labelのみ）
const MUST_TAGS = [
  '残業のない職場で働きたい',
  '希望通りに有給が取得できる職場で働きたい',
  '副業OKな職場で働きたい',
  '直行直帰ができる職場で働きたい',
  '社会保険を完備している職場で働きたい',
  '診療時間内で自己研鑽できる職場で働きたい',
  '前残業のない職場で働きたい',
]
const WANT_TAGS = [
  '人間関係のトラブルが少ない職場で働きたい',
  '同じ価値観を持つ仲間と働きたい',
  '尊敬できる上司・経営者と働きたい',
  '風通しがよく意見が言いやすい職場で働きたい',
  '評価制度が導入されている職場で働きたい',
  '教育体制が整備されている職場で働きたい',
  '今までの経験や自分の強みを活かしたい',
  '未経験の仕事／分野に挑戦したい',
  '昇進・昇格の機会がある',
  '家庭との両立に理解のある職場で働きたい',
  '勤務時間外でイベントがない職場で働きたい',
]

/* ------------- カテゴリ推定用の軽量キーワード ------------- */
const CATEGORY_HINTS = [
  { cat: '働く仲間に関すること', keys: ['人間関係','上司','先輩','同僚','雰囲気','チーム','陰口','派閥','ハラスメント'] },
  { cat: '労働条件に関すること', keys: ['残業','夜勤','休日','シフト','有給','時間','働き方','オンコール','直行直帰','前残業'] },
  { cat: '経営・組織に関すること', keys: ['理念','方針','評価','教育','研修','制度','風通し','トップ','経営'] },
  { cat: '仕事内容・キャリアに関すること', keys: ['やりがい','成長','挑戦','キャリア','昇進','専門','幅を広げ','スキル'] },
  { cat: 'プライベートに関すること', keys: ['家庭','育児','両立','プライベート','行事','イベント','時短'] },
  { cat: '職場環境・設備', keys: ['設備','機器','システム','デジタル','古い','新しい'] },
  { cat: '職場の安定性', keys: ['安定','倒産','将来性','不安'] },
  { cat: '給与・待遇', keys: ['給与','年収','手取り','賞与','ボーナス','手当','福利厚生'] },
]

/* ---------------- セッション（メモリ内） ---------------- */
const sessions = new Map()
const getS = (id) => {
  if (!sessions.has(id)) {
    sessions.set(id, {
      // 共通保存
      candidateNumber: '',
      qualificationTag: '',
      workplaceText: '',
      // Step1
      step1: {
        deepCount: 0, // 0→1→2（ユーザー発話数）
        cat: null,
        notes: [], // ユーザー原文はここに保持（会話では繰り返さない）
        awaitingPick: false,
        options: [],
        decided: '', // tag_label
      },
      // Step2/3
      must: [], // tag_label[] 保存
      want: [], // tag_label[]
      // Step4/5
      canText: '',
      willText: '',
    })
  }
  return sessions.get(id)
}

/* ----------------- ユーティリティ ----------------- */
const norm = (s='') => String(s).trim()
const includesAny = (text, arr) => arr.some(k => text.includes(k))
const pickReasonCategory = (text) => {
  const t = norm(text)
  let best = null, score = 0
  for (const {cat, keys} of CATEGORY_HINTS) {
    const hit = keys.reduce((n,k)=> n + (t.includes(k) ? 1 : 0), 0)
    if (hit > score) { score = hit; best = cat }
  }
  return (score > 0) ? best : null
}
const candidateListFor = (cat) => (REASON_CANDIDATES[cat] || []).slice(0,3)
const textHasExit = (text) => /(?:ない|無し|ありません|以上|特にない)/.test(text)

/* ----------------- 返答ビルダー ----------------- */
const say = (text) => ({ response: text })

/* ================== メインハンドラ ================== */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })

  const {
    message = '',
    currentStep = 1,
    sessionId = 'default',
    candidateNumber = '',
    isNumberConfirmed = false,
  } = req.body

  const s = getS(sessionId)
  const user = norm(message)

  // 既存の番号を受け取った場合は保存しておく（UIのため）
  if (isNumberConfirmed && candidateNumber && !s.candidateNumber) {
    s.candidateNumber = candidateNumber
  }

  /* ---------- Step1：転職目的（深掘り→候補→確定） ---------- */
  if (currentStep === 1) {
    const st = s.step1

    // 候補提示済み → 選択待ち
    if (st.awaitingPick && st.options.length) {
      const pickByNumber = user.match(/[1-3]/) ? st.options[Number(user.match(/[1-3]/)[0]) - 1] : ''
      const picked = st.options.find(o => user.includes(o)) || pickByNumber
      if (picked) {
        st.decided = picked
        st.awaitingPick = false
        st.options = []
        st.deepCount = 0
        // ①共感 → ②復唱（tag_labelそのまま） → ③保存完了メッセージ
        return res.json({
          response:
            `なるほど、それは大事だよね！\n` +
            `つまり『${picked}』ってことだね！\n` +
            `ありがとう！じゃあ次は、希望の中でも「これは外せない」と思う条件について教えてね。短くてOKだよ。`,
          step: 2,
          candidateNumber: s.candidateNumber,
          isNumberConfirmed: !!s.candidateNumber,
          sessionData: s,
        })
      }
      // 正しく選ばれなかった場合も候補提示を維持
      return res.json({
        response: `この中だとどれが一番近い？『${st.options.join('／')}』\n（番号 1〜3 でもOK）`,
        step: 1,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }

    // 深掘り：ユーザー 1→2→3 発話で区切る（オープンクエスチョンのみ）
    if (st.deepCount === 0) {
      st.notes.push(user)
      st.cat = pickReasonCategory(user)
      st.deepCount = 1
      return res.json({
        response: 'そのことについて、もう少し詳しく教えてもらってもいい？',
        step: 1,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    if (st.deepCount === 1) {
      st.notes.push(user)
      st.deepCount = 2
      return res.json({
        response: '具体的にはどんな場面でそう感じたの？',
        step: 1,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    if (st.deepCount === 2) {
      st.notes.push(user)
      // 3回目のユーザー発話後は必ず候補提示に切替
      const cat = st.cat || pickReasonCategory([st.notes[0], st.notes[1], user].join(' '))
      const options = candidateListFor(cat)
      if (cat && options.length >= 2 && options.length <= 3) {
        st.awaitingPick = true
        st.options = options
        return res.json({
          response: `この中だとどれが一番近い？『${options.join('／')}』\n（番号 1〜3 でもOK）`,
          step: 1,
          candidateNumber: s.candidateNumber,
          isNumberConfirmed: !!s.candidateNumber,
          sessionData: s,
        })
      }
      // 未マッチ：候補提示せず固定文で終了、タグ化は行わない
      st.deepCount = 0
      st.cat = null
      st.options = []
      st.awaitingPick = false
      return res.json({
        response: 'なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\nありがとう！じゃあ次は、希望の中でも「これは外せない」と思う条件について教えてね。短くてOKだよ。',
        step: 2,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
  }

  /* ---------------- Step2：必須条件（辞書マッチ） ---------------- */
  if (currentStep === 2) {
    // マッチ判定
    const hit = MUST_TAGS.find(tag => user.includes(tag))
    if (hit) {
      if (!s.must.includes(hit)) s.must.push(hit)
      return res.json({
        response: `そっか、『${hit}』が絶対ってことだね！\n他にも絶対条件はある？（なければ「ない」でOK）`,
        step: 2,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    // 未マッチでも前進
    if (textHasExit(user)) {
      return res.json({
        response: 'ありがとう！じゃあ次は、あったら嬉しい条件について教えてね。短くてOKだよ。',
        step: 3,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    return res.json({
      response: 'そっか、わかった！大事な希望だね◎\n他にも絶対条件はある？（なければ「ない」でOK）',
      step: 2,
      candidateNumber: s.candidateNumber,
      isNumberConfirmed: !!s.candidateNumber,
      sessionData: s,
    })
  }

  /* --------------- Step3：あったら嬉しい（辞書マッチ） --------------- */
  if (currentStep === 3) {
    const hit = WANT_TAGS.find(tag => user.includes(tag))
    if (hit) {
      if (!s.want.includes(hit)) s.want.push(hit)
      return res.json({
        response: `了解！『${hit}』だと嬉しいってことだね！\n他にもあったらいいなっていうのはある？（なければ「ない」でOK）`,
        step: 3,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    if (textHasExit(user)) {
      return res.json({
        response: 'ありがとう！それじゃあ次は、今できることや得意なことを教えてね。自由に書いてOKだよ。',
        step: 4,
        candidateNumber: s.candidateNumber,
        isNumberConfirmed: !!s.candidateNumber,
        sessionData: s,
      })
    }
    return res.json({
      response: '了解！気持ちは受け取ったよ◎\n他にもあったらいいなっていうのはある？（なければ「ない」でOK）',
      step: 3,
      candidateNumber: s.candidateNumber,
      isNumberConfirmed: !!s.candidateNumber,
      sessionData: s,
    })
  }

  /* ---------------- Step4：Can（テキスト保存のみ） ---------------- */
  if (currentStep === 4) {
    s.canText = user // 原文保存のみ（タグ化禁止）
    return res.json({
      response: 'いいね！次は、これからやりたいことや興味のあることを教えてね。自由に書いてOKだよ。',
      step: 5,
      candidateNumber: s.candidateNumber,
      isNumberConfirmed: !!s.candidateNumber,
      sessionData: s,
    })
  }

  /* ---------------- Step5：Will（テキスト保存のみ） ---------------- */
  if (currentStep === 5) {
    s.willText = user // 原文保存のみ（タグ化禁止）
    return res.json({
      response: '今日はたくさん話してくれてありがとう！内容は担当エージェントにしっかり共有するね。面談で詳しく相談していこう！',
      step: 6,
      candidateNumber: s.candidateNumber,
      isNumberConfirmed: !!s.candidateNumber,
      sessionData: s,
    })
  }

  // それ以外（保険）
  return res.json({
    response: 'OK！続けよう。',
    step: currentStep,
    candidateNumber: s.candidateNumber,
    isNumberConfirmed: !!s.candidateNumber,
    sessionData: s,
  })
}
