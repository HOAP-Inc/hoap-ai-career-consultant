// ハイブリッド土台版：フロー制御＝サーバー固定、文面整形は任意でGPTに委譲
import OpenAI from 'openai'
const usePolish = process.env.POLISH_WITH_GPT === 'true'
const openai = usePolish ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// ===== データ定義（既存のまま） =====
const transferReasonFlow = {
  '経営・組織に関すること': {
    keywords: ['理念','方針','価値観','経営','運営','マネジメント','方向性','ビジョン','ミッション','考え方','姿勢','経営陣','トップ','風通し','意見','発言','評価制度','評価','昇給','昇格','公平','基準','教育体制','研修','マニュアル','OJT','フォロー','教育','サポート','経営者','医療職','現場理解','売上','数字'],
    internal_options: ['MVV・経営理念に共感できる職場で働きたい','風通しがよく意見が言いやすい職場で働きたい','評価制度が導入されている職場で働きたい','教育体制が整備されている職場で働きたい','経営者が医療職のところで働きたい','経営者が医療職ではないところで働きたい']
  },
  '働く仲間に関すること': {
    keywords: ['人間関係','職場の雰囲気','上司','先輩','同僚','チームワーク','いじめ','パワハラ','セクハラ','陰口','派閥','お局','理不尽','相談できない','孤立','コミュニケーション','ロールモデル','尊敬','憧れ','見習いたい','価値観','温度感','やる気','信頼','品格','一貫性','目標','手本','職種','連携','助け合い','壁','分断','古株','権力','圧','支配'],
    internal_options: ['人間関係のトラブルが少ない職場で働きたい','同じ価値観を持つ仲間と働きたい','尊敬できる上司・経営者と働きたい','ロールモデルとなる上司や先輩がほしい','職種関係なく一体感がある仲間と働きたい','お局がいない職場で働きたい']
  },
  '仕事内容・キャリアに関すること': {
    keywords: ['スキルアップ','成長','挑戦','やりがい','業務内容','専門性','研修','教育','キャリア','昇進','昇格','資格取得','経験','学べる','新しい','幅を広げる','強み','活かす','資格','得意','未経験','分野','患者','利用者','貢献','実感','書類','件数','役立つ','ありがとう','責任','役職','機会','道筋','登用'],
    internal_options: ['今までの経験や自分の強みを活かしたい','未経験の仕事／分野に挑戦したい','スキルアップしたい','患者・利用者への貢献実感を感じられる仕事に携われる','昇進・昇格の機会がある']
  },
  '労働条件に関すること': { keywords: ['残業','夜勤','休日','有給','働き方','時間','シフト','勤務時間','連勤','休憩','オンコール','呼び出し','副業','兼業','社会保険','保険','健保','厚生年金','診療時間','自己研鑽','勉強','学習','研修時間','直行直帰','事務所','立ち寄り','朝礼','日報','定時','サービス残業','申請制','人員配置','希望日','半休','時間有休','承認','就業規則','兼業','許可','健康保険','雇用保険','労災','手続き','始業前','準備','清掃','打刻'], internal_options: [] },
  'プライベートに関すること': { keywords: ['家庭','育児','子育て','両立','ライフステージ','子ども','家族','介護','保育園','送迎','学校行事','通院','発熱','中抜け','時短','イベント','飲み会','BBQ','社員旅行','早朝清掃','強制','業務外','就業後','休日','オフ','プライベート','仲良く','交流','ごはん','趣味'], internal_options: ['家庭との両立に理解のある職場で働きたい','勤務時間外でイベントがない職場で働きたい','プライベートでも仲良くしている職場で働きたい'] },
  '職場環境・設備': { keywords: ['設備','環境','施設','器械','機器','システム','IT','デジタル','古い','新しい','最新','設置','導入','整備'], internal_options: [] },
  '職場の安定性': { keywords: ['安定','将来性','経営状況','倒産','リストラ','不安','継続','持続','成長','発展','将来','先行き'], internal_options: [] },
  '給与・待遇': { keywords: ['給料','給与','年収','月収','手取り','賞与','ボーナス','昇給','手当','待遇','福利厚生','安い','低い','上がらない','生活できない','お金'], internal_options: [] }
}

const mustWantItems = [/* 既存の長い配列そのまま */ 
  '急性期病棟','回復期病棟','慢性期・療養型病院','一般病院','地域包括ケア病棟','療養病棟',
  '緩和ケア病棟（ホスピス）','クリニック','精神科病院','訪問看護ステーション','精神科特化型訪問看護ステーション',
  '機能強化型訪問看護ステーション','訪問リハビリテーション','訪問栄養指導','通所介護（デイサービス）',
  '認知症対応型通所介護（認知症専門デイサービス）','地域密着型通所介護（定員18名以下）','通所リハビリテーション（デイケア）',
  '訪問介護','定期巡回・随時対応型訪問介護看護','訪問入浴','小規模多機能型居宅介護','看護小規模多機能型居宅介護',
  '特別養護老人ホーム','地域密着型特別養護老人ホーム（定員29名以下）','介護老人保健施設','介護付き有料老人ホーム',
  'ショートステイ（短期入所生活介護）','サービス付き高齢者向け住宅（サ高住）','住宅型有料老人ホーム','軽費老人ホーム（ケアハウス）',
  '健康型有料老人ホーム','シニア向け分譲マンション','放課後等デイサービス','生活介護（障害者の日中活動）',
  '就労継続支援A型','就労継続支援B型','短期入所（障害者向けショートステイ）','歯科クリニック','訪問歯科',
  '歯科口腔外科（病院内診療科）','大学病院歯科・歯学部附属病院','歯科技工所','院内ラボ','保育園','幼稚園',
  '企業（産業保健・企業内看護など）','4週8休以上','育児支援あり','年間休日120日以上','週1日からOK','週2日からOK',
  '土日祝休み','家庭都合休OK','月1シフト提出','毎週〜隔週シフト提出','有給消化率ほぼ100%','長期休暇あり','週休2日','週休3日',
  '日勤のみ可','夜勤専従あり','2交替制','3交替制','午前のみ勤務','午後のみ勤務','残業ほぼなし','オンコールなし・免除可',
  '緊急訪問なし','時差出勤導入','フレックスタイム制度あり','残業月20時間以内','スキマ時間勤務','時短勤務相談可','駅近（5分以内）',
  '車通勤可','バイク通勤可','自転車通勤可','駐車場完備','直行直帰OK','年収300万以上','年収350万以上','年収400万以上',
  '年収450万以上','年収500万以上','年収550万以上','年収600万以上','年収650万以上','年収700万以上','賞与あり','退職金あり',
  '寮あり・社宅あり','託児所・保育支援あり','社会保険完備','交通費支給','扶養控除内考慮','復職支援','住宅手当','副業OK',
  '日・祝日給与UP','引越し手当','緊急訪問時の手当・代休あり','スマホ・タブレット貸与あり','電動アシスト自転車・バイク・車貸与',
  '社割あり','ハラスメント相談窓口あり','研修制度あり','資格取得支援あり','セミナー参加費補助あり','マニュアル完備','動画マニュアルあり',
  '評価制度あり','メンター制度あり','独立・開業支援あり','院長・分院長候補','担当制'
]

// ===== セッション =====
const sessions = new Map()
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      candidateNumber: '', qualification: '', workplace: '',
      transferReason: '', mustConditions: [], ngConditions: [],
      canDo: '', willDo: '',
      currentCategory: null, awaitingSelection: false, selectionOptions: []
    })
  }
  return sessions.get(id)
}

// ===== ユーティリティ =====
function detectCategory(text) {
  const hits = []
  for (const [cat, cfg] of Object.entries(transferReasonFlow)) {
    const found = cfg.keywords.filter(kw => text.includes(kw))
    if (found.length) hits.push({ cat, score: found.length, keywords: found })
  }
  hits.sort((a,b)=>b.score-a.score)
  return hits[0] || null
}
function pickOptions(cat) {
  const opts = transferReasonFlow[cat]?.internal_options || []
  if (!opts.length) return []
  const shuffled = [...opts].sort(()=>Math.random()-0.5)
  return shuffled.slice(0, Math.min(3, opts.length))
}
function matchDict(text) {
  const out = []
  for (const w of mustWantItems) if (text.includes(w)) out.push(w)
  return [...new Set(out)]
}

// ===== 文面整形（ハイブリッドのコア） =====
async function polish(text) {
  if (!usePolish || !openai) return text
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'あなたは丁寧すぎないフレンドリーな日本語の編集者。意味を変えずに言い回しだけ自然に整える。絵文字や顔文字は増やさない。' },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      max_tokens: 300
    })
    return (r.choices?.[0]?.message?.content || text).trim()
  } catch {
    return text
  }
}
async function respond(res, text, step, extra = {}) {
  const msg = await polish(text)
  return res.json({ response: msg, step, ...extra })
}

// ===== ハンドラ =====
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' })
  try {
    const { message, currentStep = 0, isNumberConfirmed = false, sessionId = 'default' } = req.body
    const session = getSession(sessionId)

    // Step0: ①番号→②職種→③勤務先
    if (currentStep === 0) {
      if (!isNumberConfirmed) {
        const num = (message.match(/\d+/) || [null])[0]
        if (num) {
          session.candidateNumber = num
          return respond(res, `求職者番号：${num} ね！\n次は ②「今の職種」を教えて！`, 0, { candidateNumber: num, isNumberConfirmed: true })
        }
        return respond(res, 'OK、まずは ①求職者番号 だけ教えて！', 0)
      }
      if (!session.qualification) {
        session.qualification = message.trim()
        return respond(res, 'ナイス。次は ③「いま働いてる場所」（施設名や業態）を教えて！', 0)
      }
      if (!session.workplace) {
        session.workplace = message.trim()
        return respond(res,
          'OK、ここから本題いくよ。\nまずは「転職理由」。きっかけってどんなことだった？\nしんどかったこと、これは無理だと思ったこと、挑戦したいこと、何でもOK！',
          1)
      }
      return respond(res,'ここから本題いくよ。まずは「転職理由」を教えて！',1)
    }

    // Step1: 転職理由（カテゴリ検出→候補2-3件 or 共感して次へ）
    if (currentStep === 1) {
      if (session.awaitingSelection) {
        const num = (message.match(/[1-3１-３]/) || [null])[0]
        let chosen = null
        if (num) {
          const idx = parseInt(num.replace('１','1').replace('２','2').replace('３','3')) - 1
          chosen = session.selectionOptions[idx]
        } else {
          chosen = session.selectionOptions.find(o => message.includes(o)) || null
        }
        if (chosen) {
          session.transferReason = chosen
          session.awaitingSelection = false
          session.selectionOptions = []
          return respond(res, '了解。\nじゃあ次！絶対にゆずれない条件を教えて。', 2)
        }
        const list = session.selectionOptions.map((o,i)=>`${i+1}. ${o}`).join('\n')
        return respond(res, `番号で選んでね（自由入力でもOK）。\n\n${list}`, 1)
      }

      const det = detectCategory(message)
      if (det) session.currentCategory = det.cat
      const header = det
        ? `カテゴリ：${det.cat}\n拾えたキーワード：${(det.keywords||[]).slice(0,5).join('・') || '—'}\n`
        : 'カテゴリ：未分類\n拾えたキーワード：—\n'
      const noCandidate = det && !(transferReasonFlow[det.cat]?.internal_options || []).length

      if (noCandidate) {
        session.transferReason = message.trim()
        return respond(res, `なるほど、その気持ちよくわかる！大事な転職のきっかけだね◎\n${header}じゃあ次！絶対にゆずれない条件を教えて。`, 2)
      }

      const options = pickOptions(session.currentCategory)
      if (options.length) {
        session.selectionOptions = options
        session.awaitingSelection = true
        const list = options.map((o,i)=>`${i+1}. ${o}`).join('\n')
        return respond(res, `${header}近いのはこのあたり。番号で選んでね（自由入力でもOK）。\n\n${list}`, 1)
      }

      session.transferReason = message.trim()
      return respond(res, `${header}OK。じゃあ次！絶対にゆずれない条件を教えて。`, 2)
    }

    // Step2: Must
    if (currentStep === 2) {
      const found = matchDict(message)
      if (found.length) session.mustConditions = Array.from(new Set([...(session.mustConditions||[]), ...found]))
      return respond(res, '了解。次、絶対NGを教えて。\n避けたい職場タイプや働き方があれば挙げてね。', 3)
    }

    // Step3: NG
    if (currentStep === 3) {
      const found = matchDict(message)
      if (found.length) session.ngConditions = Array.from(new Set([...(session.ngConditions||[]), ...found]))
      return respond(res, '質問は残り2つ！これまでやってきたことを自然文で教えて。箇条書きでもOK。', 4)
    }

    // Step4: これまで
    if (currentStep === 4) {
      session.canDo = message.trim()
      return respond(res, 'これが最後の質問👏 これから挑戦したいこと・やってみたいことを教えて。', 5)
    }

    // Step5: これから + 簡易要約（整形のみGPT可）
    if (currentStep === 5) {
      session.willDo = message.trim()
      const plain =
`今日はたくさん話してくれてありがとう！
この内容をもとに、担当エージェントがピッタリな提案を準備するね。

▼面談前共有メモ
- 転職理由: ${session.transferReason || '未入力'}
- 絶対条件: ${(session.mustConditions||[]).join('、') || '未入力'}
- 絶対NG: ${(session.ngConditions||[]).join('、') || '未入力'}
- これまで: ${session.canDo || '未入力'}
- これから: ${session.willDo || '未入力'}`
      return respond(res, plain, 6, { sessionData: session })
    }

    return respond(res, '想定外のステップです。最初からやり直してね。', 0)
  } catch (e) {
    console.error('chat api error', e)
    return res.status(500).json({ message: 'Internal server error', error: e.message })
  }
}
