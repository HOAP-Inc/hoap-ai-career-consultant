/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import { kv } from "@vercel/kv"
import { OpenAI } from "openai"

const PROMPTS_DIR = join(process.cwd(), "lib", "prompts")

function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    console.error("prompt_read_failed", filePath, error)
    return ""
  }
}

const STEP_PROMPTS = {
  1: safeRead(join(PROMPTS_DIR, "step1_license_system.txt")),
  2: safeRead(join(PROMPTS_DIR, "step2_can_system.txt")),
  3: safeRead(join(PROMPTS_DIR, "step3_will_system.txt")),
  4: safeRead(join(PROMPTS_DIR, "step4_must_system.txt")),
  5: safeRead(join(PROMPTS_DIR, "step5_self_system.txt")),
  6: safeRead(join(PROMPTS_DIR, "step6_doingbeing_system.txt")),
}
const COMMON_PROMPT = safeRead(join(PROMPTS_DIR, "common_instructions.txt"))
const LLM_BRAKE_PROMPT = safeRead(join(PROMPTS_DIR, "llm_brake_system.txt"))

// ==========================================
// 各STEPの初回質問（サーバ管理）
// ==========================================
// 【重要】この定数が各STEPの初回質問の唯一の管理箇所です
// プロンプトファイルには「サーバ管理」の注記のみ記載されています
// 修正時はここだけを変更してください（プロンプトファイルは不要）
//
// STEP遷移時のブリッジメッセージ（"ありがとう！"等）もサーバ管理です
// ==========================================
const STEP_INTRO_QUESTIONS = {
  2: {
    first: "これまでどんな職場でどんなことをしてきた？あなたの経歴を簡単でいいから教えてね。",
    second: "その経験の中で、あなたが得意だなと感じていることや、これからも活かしていきたい強みってどんなこと？"
  },
  3: "次は、今後挑戦したいこと、やってみたいことを教えて！『これができたらいいな』って思うことでOKだよ✨",
  4: "次は、働きたい事業形態や労働条件を教えて！たとえば『クリニックがいい』『夜勤は避けたい』みたいなイメージでOKだよ✨",
  5: "自分で自分ってどんなタイプの人間だと思う？周りからこんな人って言われる、っていうのでもいいよ！",
}

function ensureArray(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object" && Array.isArray(value.items)) return value.items
  if (value && typeof value === "object" && Array.isArray(value.qualifications)) return value.qualifications
  return []
}

function loadJson(fileName: string): any {
  const tried: Array<{ error?: string; path: string; step: string }> = []

  const candidates = [
    join(process.cwd(), "lib", "data", fileName),
    join(process.cwd(), "public", fileName),
    join(process.cwd(), fileName),
  ]

  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf8")
        try {
          return JSON.parse(raw) as unknown
        } catch (error) {
          tried.push({
            error: error instanceof Error ? error.message : undefined,
            path: filePath,
            step: "parse_error",
          })
          console.error("json_parse_failed", fileName, filePath, error instanceof Error ? error.message : undefined)
        }
      } else {
        tried.push({ path: filePath, step: "not_exist" })
      }
    } catch (error) {
      tried.push({
        error: error instanceof Error ? error.message : undefined,
        path: filePath,
        step: "fs_error",
      })
      console.error("json_read_failed", fileName, filePath, error instanceof Error ? error.message : undefined)
    }
  }

  console.error("json_read_failed_all", fileName, JSON.stringify(tried))
  return undefined
}

const QUALIFICATIONS = ensureArray(loadJson("qualifications.json"))
const LICENSE_SOURCES = loadJson("licenses.json") ?? {}
const TAGS_DATA = loadJson("tags.json") ?? {}
const TAG_NAME_BY_ID = new Map()
const TAG_BY_NORMALIZED_NAME = new Map()

if (Array.isArray(TAGS_DATA?.tags)) {
  for (const tag of TAGS_DATA.tags) {
    const id = Number(tag?.id)
    const name = typeof tag?.name === "string" ? tag.name.trim() : ""
    if (Number.isInteger(id) && name) {
      TAG_NAME_BY_ID.set(id, name)
      TAG_BY_NORMALIZED_NAME.set(normKey(name), tag)
    }
  }
}

const QUAL_NAME_BY_ID = new Map()
const QUAL_ID_BY_NORMAL = new Map()

function isNoMessage(text) {
  if (!text) return false
  const n = String(text ?? "")
    .trim()
    .replaceAll(/\s+/g, "")
    .replaceAll(/[。、．,]/g, "")
    .toLowerCase()
  return (
    n === "ない" ||
    n === "無い" ||
    n === "ありません" ||
    n === "ないです" ||
    n === "なし" ||
    n === "無し" ||
    n === "資格なし" ||
    n === "しかくなし"
  )
}

function normalizePick(value) {
  return String(value ?? "")
    .trim()
    .replaceAll('(', "（")
    .replaceAll(')', "）")
    .replaceAll(/\s+/g, " ")
}

function normKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[\s\u3000]/g, "")
}

for (const item of QUALIFICATIONS) {
  const id = Number(item?.id)
  const name = typeof item?.name === "string" ? item.name.trim() : ""
  if (!Number.isInteger(id) || !name) continue
  QUAL_NAME_BY_ID.set(id, name)
  QUAL_ID_BY_NORMAL.set(normKey(name), id)
}

const LICENSE_LABEL_TO_QUAL_ID = new Map()
const LICENSE_ALIAS_MAP = new Map()

function addAlias(alias, label) {
  const normalized = normKey(alias)
  if (!normalized) return
  if (!LICENSE_ALIAS_MAP.has(normalized)) {
    LICENSE_ALIAS_MAP.set(normalized, [])
  }
  const list = LICENSE_ALIAS_MAP.get(normalized)
  if (!list.includes(label)) {
    list.push(label)
  }
}

function findLicenseLabelsByAlias(text) {
  const norm = normKey(text)
  if (!norm) return []
  const labels = LICENSE_ALIAS_MAP.get(norm) ?? []
  return [...labels]
}

for (const group of Object.values(LICENSE_SOURCES ?? {})) {
  if (!Array.isArray(group)) continue
  for (const entry of group) {
    if (!entry) continue
    const label = typeof entry === "string" ? entry : String(entry.label ?? "").trim()
    if (!label) continue
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases : []
    const qualId = resolveQualificationIdByName(label)
    if (qualId) {
      LICENSE_LABEL_TO_QUAL_ID.set(label, qualId)
    }
    addAlias(label, label)
    for (const alias of aliases) {
      addAlias(alias, label)
    }
  }
}

function mapLicenseLabelToQualificationId(label) {
  if (!label) return undefined
  if (LICENSE_LABEL_TO_QUAL_ID.has(label)) {
    return LICENSE_LABEL_TO_QUAL_ID.get(label)
  }
  return resolveQualificationIdByName(label)
}

function resolveQualificationIdByName(name) {
  if (!name) return undefined
  return QUAL_ID_BY_NORMAL.get(normKey(name)) || undefined
}

// セッションの有効期限（秒）: 24時間
const SESSION_TTL = 60 * 60 * 24

// メモリベースのフォールバックストレージ（KVが利用できない場合）
const memoryStorage = new Map()

function _extractJsonBlock(rawText) {
  if (rawText == undefined) return undefined
  const text = String(rawText).trim()
  if (!text) return undefined
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return undefined
  const snippet = text.slice(start, end + 1)
  try {
    return JSON.parse(snippet)
  } catch {
    return undefined
  }
}

function applyMustStatus(session, status, meta) {
  session.status.must_have_ids = Array.isArray(status?.must_ids) ? status.must_ids : []
  session.status.ng_ids = Array.isArray(status?.ng_ids) ? status.ng_ids : []
  session.status.pending_ids = Array.isArray(status?.pending_ids) ? status.pending_ids : []
  session.status.direction_map = status?.direction_map && typeof status.direction_map === "object" ? status.direction_map : {}
  session.status.status_bar = typeof status?.status_bar === "string" ? status.status_bar : ""
  session.status.must_text = typeof status?.must_text === "string" ? status.must_text : ""
  if (meta?.deepening_attempt_total != undefined) {
    const total = Number(meta.deepening_attempt_total)
    if (!Number.isNaN(total)) {
      session.meta.deepening_attempt_total = total
    }
  }
}

function buildCompactSummary(session, step, maxSentences = 3) {
  const texts = collectUserStepTexts(session, step)
  return buildCompactSummaryFromTexts(texts, maxSentences)
}

function buildCompactSummaryFromTexts(texts, maxSentences = 3) {
  const seen = new Set()
  const sentences = []
  for (const raw of texts ?? []) {
    const normalized = String(raw ?? "")
      .replaceAll(/\s+/g, " ")
      .trim()
    if (!normalized) continue
    const key = normKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    const ended = /[。.!?！？]$/.test(normalized) ? normalized : `${normalized}。`
    sentences.push(ended)
    if (sentences.length >= maxSentences) break
  }
  const joined = sentences.join("").trim()
  return polishSummaryText(joined, maxSentences)
}

function buildSchemaError(step, session, message, errorCode = "schema_mismatch") {
  return {
    _error: errorCode,
    drill: session.drill,
    meta: { error: errorCode, step },
    response: message,
    status: session.status,
  }
}

function buildStep4BridgeMessage(empathyMessage, confirmMessage, nextMessage) {
  const parts = []
  const trimmedEmpathy = empathyMessage && empathyMessage.trim()

  // 共感メッセージがあれば追加
  if (trimmedEmpathy) {
    parts.push(trimmedEmpathy)
  }

  // STEP5のintro質問だけを返す（二重質問を回避）
  const step5Intro = (nextMessage && String(nextMessage).trim()) || STEP_INTRO_QUESTIONS[5]
  parts.push(step5Intro)

  return parts.filter(Boolean).join("\n\n")
}

function buildStepPayload(session, userText, recentCount) {
  return {
    locale: "ja",
    recent_texts: session.history.slice(-recentCount).map(item => item.text),
    stage: { turn_index: session.stage.turnIndex },
    status: session.status,
    user_text: userText,
  }
}

async function callLLM(stepKey: any, payload: any, session: any, options: { model?: string } = {}) {
  if (typeof globalThis.__TEST_LLM__ === "function") {
    try {
      const raw = await globalThis.__TEST_LLM__({ opts: options, payload, session, stepKey })
      const text = typeof raw === "string" ? raw : JSON.stringify(raw)
      const parsed = _extractJsonBlock(text)
      return { _raw: text, error: parsed ? undefined : "schema_mismatch", ok: Boolean(parsed), parsed }
    } catch (error) {
      return { error: (error as Error)?.message ?? "mock_failure", ok: false }
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { error: "missing_api_key", ok: false }
  }

  try {
    const client = new OpenAI({ apiKey })
    const messages = [
      { content: COMMON_PROMPT, role: "system" as const },
      { content: LLM_BRAKE_PROMPT, role: "system" as const },
      { content: STEP_PROMPTS[stepKey] ?? "", role: "system" as const },
      { content: JSON.stringify(payload), role: "user" as const },
    ]
    const response = await client.chat.completions.create({
      messages,
      model: options.model ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
    })
    const raw = response?.choices?.[0]?.message?.content ?? ""
    const parsed = _extractJsonBlock(raw)
    return { _raw: raw, error: parsed ? undefined : "schema_mismatch", ok: Boolean(parsed), parsed }
  } catch (error) {
    return { error: (error as Error)?.message ?? "llm_failure", ok: false }
  }
}

function collectUserStepTexts(session, step) {
  if (!session?.history) return []
  return session.history
    .filter((h) => h.step === step && h.role === "user" && typeof h.text === "string")
    .map((h) =>
      String(h.text ?? "")
        .replaceAll(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
}

function createSession(sessionId?: string) {
  const base = {
    drill: { awaitingChoice: false, options: [], phase: undefined },
    history: [],
    id: sessionId ?? `s_${Math.random().toString(36).slice(2)}`,
    meta: { deepening_attempt_total: 0 },
    stage: { turnIndex: 0 },
    status: { licenses: [], qual_ids: [] },
    step: 1,
  }
  return normalizeSession(base)
}

function deriveAnchorText(rawText) {
  if (!rawText) return ""
  const normalized = String(rawText)
    .replaceAll(/\s+/g, " ")
    .replaceAll(/[、]+$/g, "")
    .trim()
  if (!normalized) return ""

  const sentences = normalized
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.replaceAll(/[。！？!?\n]/g, "").trim())
    .filter((s) => s.length >= 4)

  const candidate = sentences.length > 0 ? sentences.at(-1) : normalized
  const cleanCandidate = candidate.replaceAll(/[。！？!?\n]+$/g, "").trim()
  if (!cleanCandidate) return ""
  if (cleanCandidate.length <= 26) return cleanCandidate
  return cleanCandidate.slice(-26)
}

function enforcePoliteTone(text) {
  if (!text) return ""
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return polishSummaryText(text, 3)
  }

  const polishedParagraphs = paragraphs.map((para) => {
    const sentences = para
      .split(/(?<=[。！？!])/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (sentences.length === 0) {
      return ensurePoliteEnding(para)
    }
    const adjusted = sentences.map((s) => ensurePoliteEnding(s))
    return adjusted.join("")
  })

  return polishedParagraphs.join("\n\n")
}

function ensureAutoConfirmedIds(session, autoConfirmedIds, autoDirections) {
  if (!Array.isArray(autoConfirmedIds) || autoConfirmedIds.length === 0) return
  if (!session.status) session.status = {}
  if (!Array.isArray(session.status.must_have_ids)) session.status.must_have_ids = []
  if (!Array.isArray(session.status.ng_ids)) session.status.ng_ids = []
  if (!Array.isArray(session.status.pending_ids)) session.status.pending_ids = []
  if (!session.status.direction_map || typeof session.status.direction_map !== "object") {
    session.status.direction_map = {}
  }

  for (const id of autoConfirmedIds) {
    const direction = autoDirections[String(id)] || "have"
    if (direction === "have") {
      if (!session.status.must_have_ids.includes(id)) session.status.must_have_ids.push(id)
      session.status.ng_ids = session.status.ng_ids.filter((value) => value !== id)
      session.status.pending_ids = session.status.pending_ids.filter((value) => value !== id)
    } else if (direction === "ng") {
      if (!session.status.ng_ids.includes(id)) session.status.ng_ids.push(id)
      session.status.must_have_ids = session.status.must_have_ids.filter((value) => value !== id)
      session.status.pending_ids = session.status.pending_ids.filter((value) => value !== id)
    } else {
      if (!session.status.pending_ids.includes(id)) session.status.pending_ids.push(id)
      session.status.must_have_ids = session.status.must_have_ids.filter((value) => value !== id)
      session.status.ng_ids = session.status.ng_ids.filter((value) => value !== id)
    }
    session.status.direction_map[String(id)] = direction
  }

  finalizeMustState(session)
}


function ensurePoliteEnding(sentence) {
  if (!sentence) return ""
  let base = String(sentence).trim()
  if (!base) return ""
  base = base.replaceAll(/[！!？?]+$/g, "").replaceAll(/[。]+$/g, "")
  if (!base) return ""

  // 既に敬体で終わっている場合はそのまま返す
  const politePattern = /(です|ます|でした|ました|できます|できました|ません|たいです|でしょう|ください|てきました|っています|ています|ってます|っていました|ていました|いきます|られます|られました)$/
  if (politePattern.test(base)) {
    return `${base}。`
  }

  // 「ている」系の変換
  if (base.endsWith('ている')) {
    return `${base.replace(/ている$/, "ています")}。`
  }
  if (base.endsWith('っている')) {
    return `${base.replace(/っている$/, "っています")}。`
  }
  if (base.endsWith('でいる')) {
    return `${base.replace(/でいる$/, "でいます")}。`
  }

  // 「ていく」「ていきたい」系の変換
  if (base.endsWith('ていきたい')) {
    return `${base.replace(/ていきたい$/, "ていきたいです")}。`
  }
  if (base.endsWith('ていく')) {
    return `${base.replace(/ていく$/, "ていきます")}。`
  }

  // 「〜たい」系の変換
  if (base.endsWith('たい')) {
    return `${base.replace(/たい$/, "たいです")}。`
  }

  // 動詞の終止形（五段動詞・上一段・下一段）の変換
  // 五段動詞：う列で終わる → いますに変換
  if (/[うくぐすつぬぶむゆる]$/.test(base)) {
    const lastChar = base.slice(-1)
    const stem = base.slice(0, -1)
    const masu = {
      'う': 'います', 'く': 'きます', 'ぐ': 'ぎます', 'す': 'します',
      'つ': 'ちます', 'ぬ': 'にます', 'ぶ': 'びます', 'む': 'みます',
      'る': 'ります'
    }
    if (masu[lastChar]) {
      return `${stem}${masu[lastChar]}。`
    }
  }

  // 「する」系の変換
  if (base.endsWith('する')) {
    return `${base.replace(/する$/, "します")}。`
  }

  // 過去形の変換
  if (base.endsWith('した')) {
    return `${base.replace(/した$/, "しました")}。`
  }
  if (/[いきぎしちにびみり]た$/.test(base)) {
    return `${base.replace(/た$/, "ました")}。`
  }
  if (/[んだ]だ$/.test(base)) {
    return `${base.replace(/だ$/, "でした")}。`
  }

  // 「である」「だ」の変換
  if (base.endsWith('である')) {
    return `${base.replace(/である$/, "です")}。`
  }
  if (base.endsWith('だ')) {
    return `${base.replace(/だ$/, "です")}。`
  }

  // 「ない」系の変換
  if (base.endsWith('ない')) {
    return `${base.replace(/ない$/, "ません")}。`
  }

  // どのパターンにも当てはまらない場合は、そのまま句点を付ける
  // （「です」を無理に付けない）
  return `${base}。`
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll('&', "&amp;")
    .replaceAll('<', "&lt;")
    .replaceAll('>', "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll('\'', "&#39;")
}

/**
 * キーワードの周辺テキストを抽出する
 * @param {string} userText - ユーザー発話全体
 * @param {string} keyword - 検索するキーワード
 * @returns {string} キーワードとその周辺テキスト
 */
function extractKeywordContext(userText, keyword) {
  const index = userText.toLowerCase().indexOf(keyword.toLowerCase())
  if (index === -1) return userText

  // キーワードの前後30文字を取得（句読点を考慮）
  const start = Math.max(0, index - 30)
  const end = Math.min(userText.length, index + keyword.length + 30)
  return userText.slice(start, end)
}

/**
 * ユーザー発話からタグを絞り込む（高速化）
 * 戦略：
 * 0. 直接マッチング：完全一致・部分一致で即座に絞り込み（NEW）
 * 1. キーワードマッチング：頻出ワード（残業、夜勤等）で即座に絞り込み
 * 2. カテゴリー推定：発話内容からカテゴリーを推定し、該当カテゴリーのタグのみを返す
 * 3. 全タグ：該当なしの場合のみ全タグを返す（フォールバック）
 */
function filterTagsByUserText(userText, tagsData) {
  if (!userText || !tagsData?.tags || !Array.isArray(tagsData.tags)) {
    return tagsData
  }

  const text = userText.toLowerCase()
  const allTags = tagsData.tags

  // 【ステップ0】直接マッチング（最優先）
  const directMatches = findDirectIdMatches(userText, tagsData)
  if (directMatches.length > 0 && directMatches.length <= 10) {
    // 候補が10件以下なら即座に返す（LLMの負荷を最小化）
    console.log(`[STEP4 Filter] Direct match: ${directMatches.length} tags (${directMatches.map(t => t.name).join(", ")})`)
    return { tags: directMatches }
  }

  // 【ステップ1】キーワードマッチング（最優先）
  // 頻出ワードで即座にID候補を絞り込む
  const keywordMap = {
    "アップ": ["給与・賞与"],
    "オンコール": ["勤務時間"],
    "クリニック": ["サービス形態"],
    "セミナー": ["教育体制・研修制度"],
    "デイ": ["サービス形態"],
    "テレワーク": ["福利厚生"],
    "バス": ["アクセス"],
    
    "ボーナス": ["給与・賞与"],
    "リハビリ": ["診療科・分野"],
    // 福利厚生関連
    "リモート": ["福利厚生"],
    // 休日関連
    "休み": ["休日"],
    "休日": ["休日"],
    
    "保育": ["福利厚生"],
    // 診療科関連
    "内科": ["診療科・分野"],
    "勉強": ["教育体制・研修制度"],
    "収入": ["給与・賞与"],
    "在宅": ["福利厚生"],
    "外科": ["診療科・分野"],
    "夜勤": ["勤務時間"],
    "夜間": ["勤務時間"],
    
    "小児": ["診療科・分野"],
    "年収": ["給与・賞与"],
    "教育": ["教育体制・研修制度"],
    "整形": ["診療科・分野"],
    "施設": ["サービス形態"],
    "日勤": ["勤務時間"],
    "昇給": ["給与・賞与"],
    
    "時短": ["勤務時間"],
    "有給": ["休日"],
    // 勤務時間関連
    "残業": ["勤務時間"],
    "深夜": ["勤務時間"],
    
    "特養": ["サービス形態"],
    "産休": ["福利厚生"],
    // サービス形態関連
    "病院": ["サービス形態"],
    // 教育・研修関連
    "研修": ["教育体制・研修制度"],
    
    "精神": ["診療科・分野"],
    "給与": ["給与・賞与"],
    // 給与関連
    "給料": ["給与・賞与"],
    "老健": ["サービス形態"],
    "育休": ["福利厚生"],
    "託児": ["福利厚生"],
    "訪問": ["サービス形態"],
    
    "賞与": ["給与・賞与"],
    "車": ["アクセス"],
    "透析": ["診療科・分野"],
    // アクセス関連
    "通勤": ["アクセス"],
    "連休": ["休日"],
    "週休": ["休日"],
    "駅": ["アクセス"],
  }

  // キーワードで該当するカテゴリーを収集
  const matchedCategories = new Set()
  for (const [keyword, categories] of Object.entries(keywordMap)) {
    if (text.includes(keyword)) {
      for (const cat of categories) matchedCategories.add(cat)
    }
  }

  // キーワードマッチした場合、該当カテゴリーのタグのみを返す
  if (matchedCategories.size > 0) {
    const filtered = allTags.filter(tag => matchedCategories.has(tag.category))
    console.log(`[STEP4 Filter] Keyword match: ${[...matchedCategories].join(", ")} (${filtered.length}/${allTags.length} tags)`)
    return { tags: filtered }
  }

  // 【ステップ2】カテゴリー推定（キーワードマッチなしの場合）
  // 文脈から推定
  const contextMap = {
    "スキル": ["教育体制・研修制度", "専門資格"],
    "働き方": ["勤務時間", "休日", "福利厚生"],
    "場所": ["アクセス", "サービス形態"],
    "専門": ["診療科・分野", "専門資格"],
    "待遇": ["給与・賞与", "福利厚生"],
    "環境": ["サービス形態", "福利厚生"],
    "雰囲気": ["サービス形態"],
  }

  for (const [keyword, categories] of Object.entries(contextMap)) {
    if (text.includes(keyword)) {
      for (const cat of categories) matchedCategories.add(cat)
    }
  }

  if (matchedCategories.size > 0) {
    const filtered = allTags.filter(tag => matchedCategories.has(tag.category))
    console.log(`[STEP4 Filter] Context match: ${[...matchedCategories].join(", ")} (${filtered.length}/${allTags.length} tags)`)
    return { tags: filtered }
  }

  // 【ステップ3】フォールバック：全タグを返す
  console.log(`[STEP4 Filter] No match. Returning all tags (${allTags.length} tags)`)
  return tagsData
}

function finalizeMustState(session) {
  if (!session || !session.status) return
  const status = session.status
  if (!status.direction_map || typeof status.direction_map !== "object") {
    status.direction_map = {}
  }
  const dir = status.direction_map

  const register = (ids, direction) => {
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      dir[String(id)] = direction
    }
  }

  register(status.must_have_ids, "have")
  register(status.ng_ids, "ng")
  register(status.pending_ids, "pending")

  const parts = []
  if (Array.isArray(status.must_have_ids)) {
    for (const id of status.must_have_ids) {
      parts.push(`ID:${id}/have`)
    }
  }
  if (Array.isArray(status.ng_ids)) {
    for (const id of status.ng_ids) {
      parts.push(`ID:${id}/ng`)
    }
  }
  if (Array.isArray(status.pending_ids)) {
    for (const id of status.pending_ids) {
      parts.push(`ID:${id}/pending`)
    }
  }

  status.status_bar = parts.join("，")
}

/**
 * ユーザー発話から直接ID候補を検索（最優先・最速）
 * 完全一致・部分一致で即座にタグを絞り込む
 */
function findDirectIdMatches(userText, tagsData) {
  if (!userText || !tagsData?.tags || !Array.isArray(tagsData.tags)) {
    return []
  }

  const text = userText.toLowerCase().trim()
  const matches = []
  
  // 「給料アップ」「年収アップ」等の特殊パターンを優先処理
  const salaryUpPattern = /(給料|給与|年収|収入).*?(アップ|上げ|増やし|増額)/
  if (salaryUpPattern.test(text)) {
    // 「昇給」タグを最優先で返す
    const salaryUpTag = tagsData.tags.find(t => t.name === "昇給")
    if (salaryUpTag) {
      matches.push(salaryUpTag)
    }
    // 給与関連タグも追加
    const salaryTags = tagsData.tags.filter(t => 
      t.category === "給与・賞与" && t.name !== "昇給"
    )
    matches.push(...salaryTags)
    return matches
  }
  
  for (const tag of tagsData.tags) {
    const name = tag.name.toLowerCase()
    
    // 完全一致（最優先）
    if (text === name) {
      matches.unshift(tag); // 先頭に追加
      continue
    }
    
    // 部分一致（ユーザー発話にタグ名が含まれる、またはその逆）
    // 「慢性期」「訪問看護」等の短縮形も検出
    if (text.includes(name) || name.includes(text)) {
      matches.push(tag)
      continue
    }
    
    // 短縮形の特殊処理
    // 「慢性期」→「慢性期・療養型病院」
    if (name.includes("・") || name.includes("（")) {
      const simplifiedName = name.split(/[・（]/)[0]; // 最初の部分のみ取得
      if (text.includes(simplifiedName) || simplifiedName.includes(text)) {
        matches.push(tag)
      }
    }
  }
  
  return matches
}

function formatMustSummary(session) {
  if (!session?.status) return ""
  const {
    must_have_ids: mustIds = [],
    must_text: mustText = "",
    ng_ids: ngIds = [],
    pending_ids: pendingIds = [],
  } = session.status

  const toName = (id) => {
    const number_ = Number(id)
    if (Number.isNaN(number_)) return `ID:${id}`
    return TAG_NAME_BY_ID.get(number_) || `ID:${number_}`
  }

  const lines = []

  for (const id of mustIds) {
    lines.push(`◎ あってほしい：${toName(id)}`)
  }
  for (const id of ngIds) {
    lines.push(`✕ 避けたい：${toName(id)}`)
  }
  for (const id of pendingIds) {
    lines.push(`△ あれば嬉しい：${toName(id)}`)
  }

  const summary = lines.join("\n").trim()
  return summary || String(mustText ?? "")
}

function formatOptions(options) {
  return options.map(opt => `［${opt}］`).join("／")
}

function formatSelfTextFallback(texts) {
  const sentences = (texts ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .map((t) => t.replace(/[。！!？?\s]+$/u, ""))

  if (sentences.length === 0) {
    return "あなたらしさについて伺いました。"
  }

  const unique = [...new Set(sentences)]
  const joined = unique.join("。")
  return polishSummaryText(joined, 3)
}

function getLatestUserText(session, step) {
  if (!session?.history) return ""
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const item = session.history[index]
    if (item && item.role === "user" && item.step === step && item.text) {
      return String(item.text)
    }
  }
  return ""
}

async function getSession(sessionId) {
  if (!sessionId) return createSession()

  const kvAvailable = isKVAvailable()
  console.log(`[SESSION DEBUG] Getting session ${sessionId}, KV available: ${kvAvailable}`)

  // KVが利用可能な場合
  if (kvAvailable) {
    try {
      const existing = await kv.get(`session:${sessionId}`) as any
      if (existing) {
        console.log(`[SESSION] Retrieved from KV: ${sessionId}, step: ${(existing as any).step}, type: ${typeof (existing as any).step}`)
        console.log(`[SESSION] KV data keys: ${Object.keys(existing as any).join(", ")}`)
        const normalized = normalizeSession(existing)
        console.log(`[SESSION] After normalize: step: ${normalized.step}, type: ${typeof normalized.step}`)
        return normalized
      } else {
        console.warn(`[SESSION] Not found in KV: ${sessionId}`)
      }
    } catch (error) {
      console.error(`[KV ERROR] Failed to get session ${sessionId}:`, error)
      // KVエラー時もフォールバックとしてメモリを試す
    }
  } else {
    console.warn(`[SESSION] KV not available, using memory storage`)
  }

  // メモリストレージから取得（KVが利用不可、またはKVにセッションがない場合）
  const existingMemory = memoryStorage.get(sessionId)
  if (existingMemory) {
    console.log(`[SESSION] Retrieved from memory: ${sessionId}, step: ${existingMemory.step}`)
    return normalizeSession(existingMemory)
  }

  // 新規セッション作成
  console.warn(`[SESSION WARNING] Session not found in KV or memory, creating new session: ${sessionId}`)
  console.warn(`[SESSION WARNING] This may indicate session loss. Check KV/memory storage.`)
  console.warn(`[SESSION WARNING] Memory storage size: ${memoryStorage.size}`)
  const created = createSession(sessionId)
  await saveSession(created)
  return created
}

async function handler(request, res) {
  // 全レスポンスで共通の CORS ヘッダを出す（恒久対応）
  res.setHeader("Access-Control-Allow-Origin", "*"); // 本番はワイルドカードではなく許可する origin を指定する
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  // プリフライト（OPTIONS）に正しく応答
  if (request.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS")
    res.status(204).end()
    return
  }

  // POST のみ許可
  if (request.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" })
    return
  }

  // ストレージの状態をログ出力（初回のみ）
  if (!handler.storageLogged) {
    console.log(`[SESSION STORAGE] Using: ${isKVAvailable() ? 'Vercel KV' : 'Memory (fallback)'}`)
    if (isKVAvailable()) {
      console.log(`[SESSION STORAGE] KV URL: ${process.env.KV_REST_API_URL ? 'configured' : 'not configured'}`)
    }
    handler.storageLogged = true
  }

  // body 取得の保険（Edge/Node 両対応）
  const body = (await request.json?.().catch(() => undefined)) ?? request.body ?? {}
  const { message, sessionId } = body
  const session = await getSession(sessionId)
  
  console.log(`[HANDLER] Received request - sessionId: ${sessionId}, message: "${message}"`)
  console.log(`[HANDLER] Session state - step: ${session.step}, qual_ids: ${JSON.stringify(session.status.qual_ids)}, licenses: ${JSON.stringify(session.status.licenses)}, history length: ${session.history.length}`)

  try {
    console.log(`[HANDLER] Processing message: "${message}", sessionId: ${sessionId}, session.step: ${session.step}`)
    
    // 【開発用】テストモード：STEP6を直接表示
    if (message === "__TEST_STEP6__") {
      console.log("[TEST MODE] Generating STEP6 with dummy data")
      // ダミーデータでセッションを初期化
      session.step = 6
      session.status.qual_ids = [1]; // 看護師
      session.status.licenses = ["看護師"]
      session.status.can_text = "病棟、外来、クリニックでの勤務経験があります。患者さんだけでなくご家族とのコミュニケーションも得意です。"
      session.status.will_text = "患者さんとご家族をトータルでケアできる看護師になりたいです。"
      session.status.must_text = "残業は少なめ、年収450万円以上希望"
      session.status.self_text = "プライベートと仕事をしっかり区別して、どちらも楽しんでいます。周りからは「あなたは上手に両立しているよね」と言われます。"
      session.history = [
        { role: "user", step: 1, text: "看護師" },
        { role: "ai", step: 2, text: "ありがとう！" },
        { role: "user", step: 2, text: "病棟で働いています" },
      ]
      const result = await handleStep6(session, "")
      session.step = result.meta?.step || session.step
      await saveSession(session)
      res.status(200).json(result)
      return
    }
    
    // STEP6では空メッセージでも処理を続行（自動開始のため）
    if ((!message || message.trim() === "") && session.step !== 6) {
      console.log("[HANDLER] Empty message and not STEP6, returning greeting")
      const greeting = initialGreeting(session)
      // ここでも CORS ヘッダは既にセット済み
      res.status(200).json(greeting)
      return
    }

    // 空メッセージでない場合のみhistoryに追加
    if (message && message.trim() !== "") {
    session.history.push({ role: "user", step: session.step, text: message })
    }

    let result
    switch (session.step) {
      case 1: {
        result = await handleStep1(session, message)
        break
      }
      case 2: {
        result = await handleStep2(session, message)
        break
      }
      case 3: {
        result = await handleStep3(session, message)
        break
      }
      case 4: {
        result = await handleStep4(session, message)
        break
      }
      case 5: {
        result = await handleStep5(session, message)
        break
      }
      case 6: {
        result = await handleStep6(session, message)
        break
      }
      default: {
        // 想定外のステップの場合はエラー
        console.error(`[HANDLER ERROR] Invalid step: ${session.step}`)
        result = {
          drill: session.drill,
          meta: { step: 1 },
          response: "エラーが発生しました。最初からやり直してください。",
          status: session.status,
        }
        break
      }
    }

    if (!result || typeof result !== "object") {
      res.status(500).json({
        _error: "unknown",
        drill: session.drill,
        meta: { error: "unknown", step: session.step },
        response: "サーバ内部で処理に失敗しちゃった。時間をおいて試してみてね。",
        status: session.status,
      })
      return
    }

    if (result.status) {
      // 【安全装置】session.statusを上書きする前に、qual_idsを保護
      // STEP1で登録したqual_idsが後続のSTEPで消えないようにする
      const existingQualIds = session.status?.qual_ids
      const existingLicenses = session.status?.licenses
      session.status = result.status

      // result.statusにqual_idsが含まれていない場合、既存の値を復元
      if (existingQualIds && existingQualIds.length > 0 && !session.status.qual_ids) {
        session.status.qual_ids = existingQualIds
        console.log(`[HANDLER] Restored qual_ids: ${existingQualIds}`)
      }
      if (existingLicenses && existingLicenses.length > 0 && !session.status.licenses) {
        session.status.licenses = existingLicenses
        console.log(`[HANDLER] Restored licenses: ${existingLicenses}`)
      }
    }
    if (result.meta?.step != undefined) {
      const beforeStep = session.step
      const proposedStep = result.meta.step

      // 【安全装置】result.meta.step が現在のステップより小さい値の場合は拒否
      // ステップは必ず前進するか維持されるべきで、後退してはならない
      if (proposedStep < beforeStep) {
        console.error(`[HANDLER ERROR] ========== STEP REGRESSION DETECTED ==========`)
        console.error(`[HANDLER ERROR] Current step: ${beforeStep}, Proposed step: ${proposedStep}`)
        console.error(`[HANDLER ERROR] User message: "${message}"`)
        console.error(`[HANDLER ERROR] Original response: "${result.response}"`)
        console.error(`[HANDLER ERROR] SessionId: ${sessionId}`)
        console.error(`[HANDLER ERROR] Session history length: ${session.history.length}`)
        console.error(`[HANDLER ERROR] Session licenses: ${JSON.stringify(session.status?.licenses ?? [])}`)
        console.error(`[HANDLER ERROR] Session qual_ids: ${JSON.stringify(session.status?.qual_ids ?? [])}`)
        console.error(`[HANDLER ERROR] Last 3 history entries:`)
        const lastThree = session.history.slice(-3)
        for (const [index, h] of lastThree.entries()) {
          console.error(`[HANDLER ERROR]   [${index}] step=${h.step}, role=${h.role}, text="${h.text?.slice(0, 50)}..."`)
        }
        console.error(`[HANDLER ERROR] This likely indicates session loss or incorrect handler call.`)
        console.error(`[HANDLER ERROR] ===============================================`)
        // ステップ変更を拒否して現在のステップを維持し、エラーレスポンスを上書き
        result.response = "ごめん、処理中にエラーが起きちゃった💦 さっきの続きから話してくれる？"
        result.meta.step = beforeStep
      } else {
        session.step = proposedStep
        if (beforeStep !== session.step) {
          console.log(`[HANDLER] Step changed: ${beforeStep} -> ${session.step}`)
        }
      }
    }
    if (result.drill) session.drill = result.drill
    await saveSession(session)

    res.status(200).json(result)
  } catch (error) {
    // 本番で出るスタックや詳細はログへ。ユーザー向けは汎用メッセージ。
    console.error("handler_unexpected_error", error)
    res.status(500).json({
      _error: "exception",
      drill: session.drill,
      meta: { error: "exception", step: session.step },
      response: "サーバ内部で例外が発生しました。もう一度試してみてください。",
      status: session.status,
    })
  }
}

async function handleStep1(session, userText) {
  console.log(`[STEP1] Called with userText: "${userText}", session.step: ${session.step}, turnIndex: ${session.stage.turnIndex}`)
  session.stage.turnIndex += 1
  const trimmed = String(userText ?? "").trim()

  if (isNoMessage(trimmed)) {
    session.step = 2
    session.stage.turnIndex = 0
    resetDrill(session)
    // 資格なしの場合はSTEP2へ遷移
    if (!session.meta) session.meta = {}
    session.meta.step2_intro_phase = 1
    session.meta.step2_deepening_count = 0
    const step2Response = await handleStep2(session, "")
    return step2Response
  }

    if (session.drill.awaitingChoice) {
    const normalized = normalizePick(trimmed)
    const selected = session.drill.options.find(opt => normalizePick(opt) === normalized)
    if (!selected) {
      return {
        drill: session.drill,
        meta: { step: 1 },
        response: `候補から選んでね。『${formatOptions(session.drill.options)}』`,
        status: session.status,
      }
    }

    const qualId = mapLicenseLabelToQualificationId(selected)

    // ID に紐づかない場合はエラーメッセージを返さず、そのままテキスト保存する
    if (!qualId) {
      if (!Array.isArray(session.status.licenses)) session.status.licenses = []
      if (!session.status.licenses.includes(selected)) session.status.licenses.push(selected)

      resetDrill(session)
      session.stage.turnIndex = 0
      return {
        drill: session.drill,
        meta: { step: 1 },
        response: `「${selected}」はIDに紐づかなかったので、そのまま登録したよ。ほかにあれば教えて！なければ「ない」と言ってね`,
        status: session.status,
      }
    }

    const qualName = QUAL_NAME_BY_ID.get(qualId) || selected

    // IDベースで未登録なら追加（現行のID設計を尊重）
    if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = []
    if (!session.status.qual_ids.includes(qualId)) {
      session.status.qual_ids.push(qualId)
      if (!Array.isArray(session.status.licenses)) session.status.licenses = []
      if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName)
    }

    resetDrill(session)
    session.stage.turnIndex = 0
    // 継続：step は上げない（ユーザーに追加有無を確認する）
    return {
      drill: session.drill,
      meta: { step: 1 },
      response: `「${qualName}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
      status: session.status,
    }
  }

  if (!trimmed) {
    return {
      drill: session.drill,
      meta: { step: 1 },
      response: "今持っている資格や研修名を一言で教えてね！複数ある場合は1つずつ教えてね。",
      status: session.status,
    }
  }

  const directId = resolveQualificationIdByName(trimmed)
  if (directId) {
    // ID 57 (資格なし) が検出された場合、STEP2へ強制移行
    if (directId === 57) {
      session.step = 2
      session.stage.turnIndex = 0
      resetDrill(session)
      // STEP2の2段階質問フェーズを1に設定（first質問から開始）
      if (!session.meta) session.meta = {}
      session.meta.step2_intro_phase = 1
      session.meta.step2_deepening_count = 0
      const step2Response = await handleStep2(session, "")
      return step2Response
    }

    const qualName = QUAL_NAME_BY_ID.get(directId) || trimmed

    if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = []

    if (!session.status.qual_ids.includes(directId)) {
      // 新規追加（IDベース）
      session.status.qual_ids.push(directId)
      if (!Array.isArray(session.status.licenses)) session.status.licenses = []
      if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName)

      session.stage.turnIndex = 0
      resetDrill(session)
      return {
        drill: session.drill,
        meta: { step: 1 },
        response: `了解！「${qualName}」だね。次、他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
      }
    }

    // 既に登録済み
    return {
      drill: session.drill,
      meta: { step: 1 },
      response: `その資格は既に登録済みだよ。他にもある？あれば教えて！なければ「ない」と言ってね`,
      status: session.status,
    }
  }

  const labels = findLicenseLabelsByAlias(trimmed)
  if (labels.length > 0) {
    const uniqueLabels = [...new Set(labels)]
    const resolved = uniqueLabels
      .map(label => ({ id: mapLicenseLabelToQualificationId(label), label }))
      .filter(item => item.id)

    if (uniqueLabels.length === 1 && resolved.length === 1) {
      const { id, label } = resolved[0]
      const qualName = QUAL_NAME_BY_ID.get(id) || label
      if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = []
      if (!session.status.qual_ids.includes(id)) {
        session.status.qual_ids.push(id)
        if (!Array.isArray(session.status.licenses)) session.status.licenses = []
        if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName)
      }
      session.stage.turnIndex = 0
      resetDrill(session)
      return {
        drill: session.drill,
        meta: { step: 1 },
        response: `「${label}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
      }
    }

if (uniqueLabels.length === 1 && resolved.length === 0) {
  const label = uniqueLabels[0]
  if (!Array.isArray(session.status.licenses)) session.status.licenses = []
  if (!session.status.licenses.includes(label)) session.status.licenses.push(label)
  session.stage.turnIndex = 0
  resetDrill(session)
  return {
    drill: session.drill,
    meta: { step: 1 },
    response: `「${label}」だね。他にもある？あれば教えて！なければ「ない」と言ってね`,
    status: session.status,
  }
}


    if (resolved.length === 1) {
      const { id, label } = resolved[0]
      const qualName = QUAL_NAME_BY_ID.get(id) || label
      if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = []
      if (!session.status.qual_ids.includes(id)) {
        session.status.qual_ids.push(id)
        if (!Array.isArray(session.status.licenses)) session.status.licenses = []
        if (!session.status.licenses.includes(qualName)) session.status.licenses.push(qualName)
      }
      session.stage.turnIndex = 0
      resetDrill(session)
      return {
        drill: session.drill,
        meta: { step: 1 },
        response: `「${label}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
        status: session.status,
      }
    }

    session.drill.phase = "license"
    session.drill.awaitingChoice = true
    session.drill.options = uniqueLabels
    return {
      drill: session.drill,
      meta: { step: 1 },
      response: `候補がいくつかあるよ。どれが一番近い？『${formatOptions(uniqueLabels)}』`,
      status: session.status,
    }
  }

  // 資格が見つからない場合でも、ユーザーの入力をそのまま登録して次に進む
  // これにより、離脱を防ぎ、ユーザー体験を向上させる
  console.log(`[STEP1 INFO] License not found in database, registering as-is. User input: "${trimmed}"`)
  
  if (!Array.isArray(session.status.licenses)) session.status.licenses = []
  if (!session.status.licenses.includes(trimmed)) {
    session.status.licenses.push(trimmed)
  }
  
  session.stage.turnIndex = 0
  resetDrill(session)

  return {
    drill: session.drill,
    meta: { step: 1 },
    response: `「${trimmed}」だね！他にもある？あれば教えて！なければ「ない」と言ってね`,
    status: session.status,
  }
}

async function handleStep2(session, userText) {
  console.log(`[STEP2] Called with userText: "${userText}", session.step: ${session.step}, turnIndex: ${session.stage.turnIndex}`)
  // session.meta 初期化
  if (!session.meta) session.meta = {}
  if (typeof session.meta.step2_intro_phase !== "number") {
    session.meta.step2_intro_phase = 1; // デフォルトはfirst質問から開始
  }
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0
  }

  // STEP遷移時（userTextが空）は、introフェーズに応じた質問を返す
  if (!userText || !userText.trim()) {
    if (session.meta.step2_intro_phase === 1) {
      return {
        drill: session.drill,
        meta: { intro_phase: 1, step: 2 },
        response: STEP_INTRO_QUESTIONS[2].first,
        status: session.status,
      }
    }
    return {
      drill: session.drill,
      meta: { intro_phase: 2, step: 2 },
      response: STEP_INTRO_QUESTIONS[2].second,
      status: session.status,
    }
  }

  // userTextがある場合のみturnIndexをインクリメント
  if (userText && userText.trim()) {
    session.stage.turnIndex += 1
  }

  const payload = buildStepPayload(session, userText, 3)
  const llm = await callLLM(2, payload, session, { model: "gpt-4o" })

  if (!llm.ok) {
    return buildSchemaError(2, session, "あなたの「やってきたこと、これからも活かしていきたいこと」の処理でエラーが起きたみたい。もう一度話してみて！", llm.error)
  }

  const parsed = llm.parsed ?? {}

  // 【Phase 1の応答処理】empathy + second質問を結合
  if (session.meta.step2_intro_phase === 1 && parsed?.empathy) {
    session.meta.step2_intro_phase = 2
    const combinedResponse = [parsed.empathy, STEP_INTRO_QUESTIONS[2].second]
      .filter(Boolean)
      .join("\n\n")

    return {
      drill: session.drill,
      meta: { intro_phase: 2, step: 2 },
      response: combinedResponse,
      status: session.status,
    }
  }

  // intro フェーズの処理（安全装置：LLMが予期せずintroを返した場合）
  if (parsed?.control?.phase === "intro") {
    if (!session.meta) session.meta = {}
    session.meta.step2_deepening_count = 0
    return {
      drill: session.drill,
      meta: { step: 2 },
      response: parsed.response || STEP_INTRO_QUESTIONS[2].first,
      status: session.status,
    }
  }

  // generation フェーズ（Can確定、STEP3へ移行）
  if (parsed?.status?.can_text && typeof parsed.status.can_text === "string") {
    const llmCan = normalizeSelfText(parsed.status.can_text)
    const compactCan = buildCompactSummary(session, 2, 3)
    const rawCan = llmCan || compactCan || "今までやってきたことについて伺いました。"
    const finalCan = polishSummaryText(rawCan, 3)

    session.status.can_text = finalCan
    session.status.can_texts = finalCan ? [finalCan] : []
    console.log("[STEP2 GENERATION] can_text (polished):", finalCan)
    const nextStep = Number(parsed?.meta?.step) || 3
    session.step = nextStep
    session.stage.turnIndex = 0
    // deepening_countをリセット
    if (session.meta) session.meta.step2_deepening_count = 0

    // STEP3の初回質問を取得
    resetDrill(session)
    const step3Response = await handleStep3(session, "")

    // 共感文を追加（LLMから取得、なければフォールバック）
    const empathyMessage = parsed?.empathy || "ありがとう！"
    const combinedResponse = [empathyMessage, step3Response.response].filter(Boolean).join("\n\n")

    return {
      drill: step3Response.drill,
      meta: { step: session.step },
      response: combinedResponse || step3Response.response,
      status: session.status,
    }
  }
  
  console.log("[STEP2 DEBUG] No generation phase detected. parsed.status:", parsed?.status)

  const { ask_next, empathy, meta } = parsed

  // 基本検査
  if (typeof empathy !== "string" || (ask_next != undefined && typeof ask_next !== "string")) {
    return buildSchemaError(2, session, "あなたの「やってきたこと、これからも活かしていきたいこと」の処理でエラーが起きたみたい。もう一度話してみて！")
  }

  // session.meta 初期化（安全）
  if (!session.meta) session.meta = {}
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0
  }

  // サーバー側でdeepening_countを管理（フェイルセーフ）
  if (!session.meta) session.meta = {}
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0
  }
  session.meta.step2_deepening_count += 1

  // STEP2では meta.step は 3 のみが有効（STEP3への遷移）
  // 1 や 2 などの不正な値が返ってきた場合は無視する
  let llmNextStep = Number(meta?.step) || session.step
  if (llmNextStep !== session.step && llmNextStep !== 3) {
    console.warn(`[STEP2 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`)
    llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
  }

  let nextStep = llmNextStep
  if (llmNextStep === session.step || llmNextStep === 3) {
    // サーバー側の暴走停止装置（フェイルセーフ）
    const deepeningCount = Number(meta?.deepening_count) ?? 0
    const serverCount = session.meta.step2_deepening_count ?? 0

    // ユーザー素材の把握（Doing/Being生成に必要な質を確認）
    const userStep2Texts = session.history
      .filter(h => h.step === 2 && h.role === "user" && typeof h.text === "string")
      .map(h => h.text.trim())
      .filter(Boolean)
    const distinctStrengths = new Set(
      (session.status.can_texts ?? []).map(ct => normKey(String(ct ?? "")))
    )

    const hasEnoughStrengths = distinctStrengths.size >= 2
    const hasEnoughEpisodes = userStep2Texts.length >= 2
    const hasEnoughMaterial = hasEnoughStrengths && hasEnoughEpisodes

    const MAX_DEEPENING = 3
    const deepeningMaxed = Math.max(deepeningCount, serverCount) >= MAX_DEEPENING

    if (nextStep === 3 && !hasEnoughMaterial) {
      console.log(
        `[STEP2 INFO] Holding transition to enrich material. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      )
      nextStep = session.step
    }

    if (!hasEnoughMaterial && deepeningMaxed) {
      console.warn(
        `[STEP2 WARN] Max deepening reached without sufficient material. Proceeding to STEP3 forcibly. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      )
      nextStep = 3
    } else if (hasEnoughMaterial && deepeningMaxed) {
      console.log(
        `[STEP2 INFO] Max deepening reached with sufficient material. Proceeding to STEP3. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}`
      )
      nextStep = 3
    }

    if (nextStep === 3 && hasEnoughMaterial && !deepeningMaxed) {
      console.log(
        `[STEP2 INFO] Adequate material confirmed before max deepening. Proceeding to STEP3. ` +
          `DistinctStrengths=${distinctStrengths.size}, UserTexts=${userStep2Texts.length}, ` +
          `LLM count=${deepeningCount}, Server count=${serverCount}`
      )
    }

    // 念のため、深掘り回数が上限に達した場合は必ず遷移
    if (nextStep !== 3 && deepeningMaxed) {
      nextStep = 3
    }
  }

  if (nextStep !== session.step) {
    // STEP3へ移行
    // フェイルセーフで遷移する場合でも、LLMにcan_textを生成させる
    // session.historyからSTEP2のユーザー発話を取得
    const step2Texts = session.history
      .filter(h => h.step === 2 && h.role === "user")
      .map(h => h.text)
      .filter(Boolean)

    // LLMにgenerationを依頼（強制的にcan_text生成）
    const genPayload = {
      force_generation: true, // generationフェーズを強制
      locale: "ja",
      recent_texts: step2Texts,
      stage: { turn_index: 999 }, // 終了フラグ
      status: session.status,
      user_text: step2Texts.join("。"), // 全ての発話を結合
    }

    const genLLM = await callLLM(2, genPayload, session, { model: "gpt-4o" })
    console.log("[STEP2 FAILSAFE] genLLM.ok:", genLLM.ok)
    console.log("[STEP2 FAILSAFE] genLLM.parsed?.status?.can_text:", genLLM.parsed?.status?.can_text)

    let generatedCan = ""

    if (genLLM.ok && genLLM.parsed?.status?.can_text) {
      generatedCan = normalizeSelfText(genLLM.parsed.status.can_text)
      console.log("[STEP2 FAILSAFE] Using LLM generated can_text:", generatedCan)
    }

    if (!generatedCan) {
      generatedCan = buildCompactSummaryFromTexts(step2Texts, 3)
    }

    if (!generatedCan) {
      if (step2Texts.length > 0) {
        // LLM失敗時は最後の発話を整形
        const lastText = step2Texts.at(-1)
        const normalizedLast = String(lastText ?? "").replaceAll(/\s+/g, " ").trim()
        generatedCan =
          normalizedLast.length > 0
            ? (/[。.!?！？]$/.test(normalizedLast) ? normalizedLast : `${normalizedLast}。`)
            : "今までやってきたことについて伺いました。"
        console.log("[STEP2 FAILSAFE] Using fallback can_text:", generatedCan)
      } else {
        generatedCan = "今までやってきたことについて伺いました。"
      }
    }

    const polishedCan = polishSummaryText(generatedCan, 3)
    session.status.can_text = polishedCan
    session.status.can_texts = polishedCan ? [polishedCan] : []
    console.log("[STEP2 FAILSAFE] Final can_text:", polishedCan)

    session.step = nextStep
    session.stage.turnIndex = 0
    // deepening_countをリセット
    session.meta.step2_deepening_count = 0

        const step3Response = await handleStep3(session, "")
        const combinedResponse = [empathy, "ありがとう！", step3Response.response].filter(Boolean).join("\n\n")
        return {
          drill: step3Response.drill,
          meta: { step: session.step },
          response: combinedResponse || step3Response.response,
      status: session.status,
        }
  }

  // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
  const message = [empathy, ask_next].filter(Boolean).join("\n\n") || empathy || "ありがとう。もう少し教えて。"
  return {
    drill: session.drill,
    meta: { step: session.step },
    response: message,
    status: session.status,
  }
}

async function handleStep3(session, userText) {
  console.log(`[STEP3] Called with userText: "${userText}", session.step: ${session.step}, turnIndex: ${session.stage.turnIndex}`)
  // 【重要】STEP遷移時（userTextが空）は、LLMを呼ばずにintro質問を返す
  if (!userText || !userText.trim()) {
    console.log(`[STEP3] Returning intro question (empty userText)`)
    return {
      drill: session.drill,
      meta: { step: 3 },
      response: STEP_INTRO_QUESTIONS[3],
      status: session.status,
    }
  }

  // userTextがある場合のみturnIndexをインクリメント
    session.stage.turnIndex += 1
  const payload = buildStepPayload(session, userText, 5)
  const llm = await callLLM(3, payload, session, { model: "gpt-4o" })
  if (!llm.ok) {
    return buildSchemaError(3, session, "あなたの「これから挑戦したいこと」の生成でエラーが発生したよ。少し時間を置いてみてね。", llm.error)
  }
  const parsed = llm.parsed ?? {}
  console.log(`[STEP3] LLM response phase: ${parsed?.control?.phase}, meta.step: ${parsed?.meta?.step}`)

  // intro フェーズ（初回質問）
  if (parsed?.control?.phase === "intro") {
    // deepening_countをリセット
    if (!session.meta) session.meta = {}
    session.meta.step3_deepening_count = 0
    return {
      drill: session.drill,
      meta: { step: 3 },
      response: parsed.response || "これから挑戦してみたいことや、やってみたい仕事を教えて！まったくやったことがないものでも大丈夫。ちょっと気になってることでもOKだよ✨",
      status: session.status,
    }
  }

  // generation フェーズ（Will確定、STEP4へ移行）
  if (parsed?.status?.will_text && typeof parsed.status.will_text === "string") {
    const llmWill = normalizeSelfText(parsed.status.will_text)
    const compactWill = buildCompactSummary(session, 3, 3)
    const rawWill = llmWill || compactWill || "これから挑戦したいことについて伺いました。"
    const finalWill = polishSummaryText(rawWill, 3)

    session.status.will_text = finalWill
    session.status.will_texts = finalWill ? [finalWill] : []
    const nextStep = Number(parsed?.meta?.step) || 4
    session.step = nextStep
    session.stage.turnIndex = 0
    // deepening_countをリセット
    if (session.meta) session.meta.step3_deepening_count = 0

    // STEP4の初回質問を取得して結合
    const step4Response = await handleStep4(session, "")
    // LLM生成文は表示せず、ブリッジメッセージ → STEP4の初回質問のみ
    const combinedResponse = ["ありがとう！次の質問に移るね", step4Response.response].filter(Boolean).join("\n\n")
    return {
      drill: step4Response.drill,
      meta: { step: session.step },
      response: combinedResponse || step4Response.response,
      status: session.status,
    }
  }

  // empathy + deepening フェーズ（STEP2と同じ構造）
  const { ask_next, empathy, meta } = parsed
  if (typeof empathy === "string") {
    // サーバー側でdeepening_countを管理（フェイルセーフ）
    if (!session.meta) session.meta = {}
    if (typeof session.meta.step3_deepening_count !== "number") {
      session.meta.step3_deepening_count = 0
    }
    session.meta.step3_deepening_count += 1

    // STEP3では meta.step は 4 のみが有効（STEP4への遷移）
    // 1, 2, 3 などの不正な値が返ってきた場合は無視する
    let llmNextStep = Number(meta?.step) || session.step
    if (llmNextStep !== session.step && llmNextStep !== 4) {
      console.warn(`[STEP3 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`)
      llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
    }

    let nextStep = llmNextStep

    // サーバー側の暴走停止装置（フェイルセーフ）
    // LLMのdeepening_countとサーバー側のカウントの両方をチェック
    const deepeningCount = Number(meta?.deepening_count) ?? 0
    const serverCount = session.meta.step3_deepening_count ?? 0

    if (llmNextStep === session.step && (deepeningCount >= 3 || serverCount >= 3)) {
      // 3回に達したら強制的にSTEP4へ
      nextStep = 4
      console.log(`[STEP3 FAILSAFE] Forcing transition to STEP4. LLM count: ${deepeningCount}, Server count: ${serverCount}`)
    }

    if (nextStep !== session.step) {
      // STEP4へ移行
      // フェイルセーフで遷移する場合でも、LLMにwill_textを生成させる
      // session.historyからSTEP3のユーザー発話を取得
      const step3Texts = session.history
        .filter(h => h.step === 3 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean)

      // LLMにgenerationを依頼（強制的にwill_text生成）
      const genPayload = {
        force_generation: true, // generationフェーズを強制
        locale: "ja",
        recent_texts: step3Texts,
        stage: { turn_index: 999 }, // 終了フラグ
        status: session.status,
        user_text: step3Texts.join("。"), // 全ての発話を結合
      }

      const genLLM = await callLLM(3, genPayload, session, { model: "gpt-4o" })
      let generatedWill = buildCompactSummaryFromTexts(step3Texts, 3)

      if (!generatedWill) {
      if (genLLM.ok && genLLM.parsed?.status?.will_text) {
          generatedWill = normalizeSelfText(genLLM.parsed.status.will_text)
      } else if (step3Texts.length > 0) {
        const lastText = step3Texts.at(-1)
          const normalizedLast = String(lastText ?? "").replaceAll(/\s+/g, " ").trim()
          generatedWill =
            normalizedLast.length > 0
              ? (/[。.!?！？]$/.test(normalizedLast) ? normalizedLast : `${normalizedLast}。`)
              : "これから挑戦したいことについて伺いました。"
        } else {
          generatedWill = "これから挑戦したいことについて伺いました。"
        }
      }

      const polishedWill = polishSummaryText(generatedWill, 3)
      session.status.will_text = polishedWill
      session.status.will_texts = polishedWill ? [polishedWill] : []

      session.step = nextStep
      session.stage.turnIndex = 0
      // deepening_countをリセット
      session.meta.step3_deepening_count = 0

      // STEP4の初回質問を使用
      resetDrill(session)
      const combinedResponse = [empathy, STEP_INTRO_QUESTIONS[4]].filter(Boolean).join("\n\n")
      return {
        drill: session.drill,
        meta: { step: session.step },
        response: combinedResponse,
        status: session.status,
      }
    }

    // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
    const message = [empathy, ask_next].filter(Boolean).join("\n\n") || empathy || "ありがとう。もう少し教えて。"
    console.log(`[STEP3] Returning empathy+deepening. session.step: ${session.step}, nextStep: ${nextStep}`)
    return {
      drill: session.drill,
      meta: { step: session.step },
      response: message,
      status: session.status,
    }
  }

  console.log(`[STEP3] Fallback response. session.step: ${session.step}`)
  return {
    drill: session.drill,
    meta: { step: 3 },
    response: "これから挑戦したいことについて、もう少し具体的に教えてほしい。短くで良いから、やってみたいことの概要を教えて。",
    status: session.status,
  }
}

async function handleStep4(session, userText) {
  // サーバー側カウンター初期化（LLM呼び出し前に確実に初期化）
  if (!session.meta) session.meta = {}
  if (typeof session.meta.step4_deepening_count !== "number") {
    session.meta.step4_deepening_count = 0
  }

  // 選択肢待ちの場合（タグ候補からの選択）を先に処理
  if (session.drill.awaitingChoice && session.drill.phase === "step4_tag_choice") {
    const options = Array.isArray(session.drill.options) ? session.drill.options : []
    const normalized = normKey(userText ?? "")
    const selectedLabel = options.find(opt => normKey(opt) === normalized || normalizePick(opt) === normalizePick(userText ?? ""))
    if (!selectedLabel) {
      return {
        drill: session.drill,
        meta: { phase: "choice", step: 4 },
        response: `候補から選んでね。『${formatOptions(options)}』`,
        status: session.status,
      }
    }
    session.drill.awaitingChoice = false
    session.drill.phase = undefined
    session.drill.options = []
    userText = selectedLabel
  }

  // 方向性選択の場合（残業、休日などの選択肢）
  if (session.drill.awaitingChoice && session.drill.phase === "step4_direction_choice") {
    const options = Array.isArray(session.drill.options) ? session.drill.options : []
    const normalized = normKey(userText ?? "")
    const selectedOption = options.find(opt => normKey(opt) === normalized || normalizePick(opt) === normalizePick(userText ?? ""))
    if (!selectedOption) {
      return {
        drill: session.drill,
        meta: { phase: "choice", step: 4 },
        response: `候補から選んでね。『${formatOptions(options)}』`,
        status: session.status,
      }
    }
    session.drill.awaitingChoice = false
    session.drill.phase = undefined
    session.drill.options = []
    
    // 選択肢に基づいてuserTextを再構成（LLMに渡すため）
    userText = selectedOption
  }

  // 【重要】STEP遷移時（userTextが空）は、LLMを呼ばずにintro質問を返す
  if (!userText || !userText.trim()) {
    // intro質問を既に表示済みの場合は空応答を返す（重複防止）
    if (session.meta.step4_intro_shown) {
      console.log("[STEP4] Intro already shown. Returning empty response.")
      return {
        drill: session.drill,
        meta: { phase: "waiting", step: 4 },
        response: "",
        status: session.status,
      }
    }

    // intro質問を表示してフラグを立てる（deepening_countは0のまま）
    session.meta.step4_intro_shown = true
    console.log("[STEP4] Showing intro question for the first time.")
    return {
      drill: session.drill,
      meta: { deepening_count: 0, phase: "intro", step: 4 },
      response: STEP_INTRO_QUESTIONS[4],
      status: session.status,
    }
  }

  // userTextがある場合のみturnIndexをインクリメント
  session.stage.turnIndex += 1

  // 【超高速化】直接マッチングでID確定を試みる
  let preselectedTag = undefined
  const normalizedLabel = normKey(userText)
  if (TAG_BY_NORMALIZED_NAME.has(normalizedLabel)) {
    preselectedTag = TAG_BY_NORMALIZED_NAME.get(normalizedLabel)
  }

  let directMatches = []
  directMatches = preselectedTag ? [preselectedTag] : findDirectIdMatches(userText, TAGS_DATA)
  let autoConfirmedIds = []
  const autoDirectionMap = {}
  let pendingDirectionTag = undefined; // 方向性が不明なタグを保存

  if (directMatches.length === 1) {
    const matchedTag = directMatches[0]
    console.log(
      `[STEP4 FAST] Direct ID match found: ${matchedTag.id} (${matchedTag.name})`
    )

    // キーワードの周辺テキストを抽出して方向性を判定
    const context = extractKeywordContext(userText, matchedTag.name)
    let direction = judgeDirection(context)

    // 方向性が確定した場合のみauto_confirmed_idsに含める
    if (direction === undefined) {
      // 方向性が不明な場合はLLMに委ねる（auto_confirmed_idsに含めない）
      console.log(
        `[STEP4 FAST] Direction unclear for "${userText}". Deferring to LLM for direction_check.`
      )
      direction = undefined; // LLMに判断を委ねる
      pendingDirectionTag = matchedTag; // 方向性確認が必要なタグを保存
    } else {
      autoConfirmedIds = [matchedTag.id]
      console.log(
        `[STEP4 FAST] Auto-confirmed ID with direction: ${matchedTag.id} (${matchedTag.name}) → ${direction}`
      )
    }

    // 方向性が確定した場合のみ、sessionのstatusを更新
    if (direction !== undefined && autoConfirmedIds.length > 0) {
    if (!session.status.must_have_ids) session.status.must_have_ids = []
    if (!session.status.ng_ids) session.status.ng_ids = []
    if (!session.status.pending_ids) session.status.pending_ids = []
    if (!session.status.direction_map) session.status.direction_map = {}
    const id = autoConfirmedIds[0]

    // 他の配列から同一IDを除外
    const removeId = (array) => {
      if (Array.isArray(array)) {
        const index = array.indexOf(id)
        if (index !== -1) array.splice(index, 1)
      }
    }
    removeId(session.status.must_have_ids)
    removeId(session.status.ng_ids)
    removeId(session.status.pending_ids)

    switch (direction) {
    case "have": {
      if (!session.status.must_have_ids.includes(id)) {
        session.status.must_have_ids.push(id)
      }
    
    break
    }
    case "ng": {
      if (!session.status.ng_ids.includes(id)) {
        session.status.ng_ids.push(id)
      }
      
    break
    }
    case "pending": {
      if (!session.status.pending_ids.includes(id)) {
        session.status.pending_ids.push(id)
      }
    
    break
    }
    // No default
    }
    session.status.direction_map[String(id)] = direction
    autoDirectionMap[String(id)] = direction

      // ステータスバーは後で finalizeMustState で生成するため、ここでは更新しない
      // （LLMの共感文生成後に更新）
    }
  } else if (directMatches.length > 1) {
    // 複数キーワードが見つかった場合、各キーワードについて個別に方向性を判定
      console.log(
      `[STEP4 FAST] Multiple matches found: ${directMatches.map(t => t.name).join(", ")}`
    )

    if (!session.status.must_have_ids) session.status.must_have_ids = []
    if (!session.status.ng_ids) session.status.ng_ids = []
    if (!session.status.pending_ids) session.status.pending_ids = []
    if (!session.status.direction_map) session.status.direction_map = {}

    const processedTags = []

    for (const tag of directMatches) {
      // キーワードの周辺テキストを抽出
      const context = extractKeywordContext(userText, tag.name)
      const direction = judgeDirection(context)

      if (direction !== undefined) {
        // 方向性が確定した場合のみ登録
        processedTags.push({ direction, tag })
        autoConfirmedIds.push(tag.id)

        // 他の配列から同一IDを除外
        const removeId = (array) => {
          if (Array.isArray(array)) {
            const index = array.indexOf(tag.id)
            if (index !== -1) array.splice(index, 1)
          }
        }
        removeId(session.status.must_have_ids)
        removeId(session.status.ng_ids)
        removeId(session.status.pending_ids)

        // 方向性に応じて配列に追加
        switch (direction) {
        case "have": {
          if (!session.status.must_have_ids.includes(tag.id)) {
            session.status.must_have_ids.push(tag.id)
          }
        
        break
        }
        case "ng": {
          if (!session.status.ng_ids.includes(tag.id)) {
            session.status.ng_ids.push(tag.id)
          }
        
        break
        }
        case "pending": {
          if (!session.status.pending_ids.includes(tag.id)) {
            session.status.pending_ids.push(tag.id)
          }
        
        break
        }
        // No default
        }

        session.status.direction_map[String(tag.id)] = direction
        autoDirectionMap[String(tag.id)] = direction

        console.log(
          `[STEP4 FAST] Auto-processed: ${tag.id} (${tag.name}) → ${direction}`
        )
      }
    }

    // 一部でも方向性が不明なタグがあれば、LLMに委ねる
    if (processedTags.length < directMatches.length) {
      console.log(
        `[STEP4 FAST] Some tags have unclear direction. Deferring to LLM. Processed: ${processedTags.length}/${directMatches.length}`
      )
    }
  }

  // 【高速化】ユーザー発話からタグを絞り込む（全2306行→数十行に削減）
  const filteredTags = filterTagsByUserText(userText, TAGS_DATA)

  // LLMの役割：
  // - ID確定済みの場合：ネガ/ポジ判断 + 共感文生成のみ
  // - ID未確定の場合：従来通りID化も含める
  const step4History = session.history.filter(h => h.step === 4)
  const payload = {
    auto_confirmed_ids: autoConfirmedIds.length > 0 ? autoConfirmedIds : undefined, // ID確定済みフラグ
    deepening_attempt_total: session.meta.step4_deepening_count,
    locale: "ja",
    recent_texts: step4History.slice(-6).map(item => item.text),
    stage: { turn_index: session.stage.turnIndex },
    status: session.status,
    tags: filteredTags,
    user_text: userText,
  }

  const llm = await callLLM(4, payload, session, { model: "gpt-4o" })
  if (!llm.ok) {
    return buildSchemaError(4, session, "あなたの譲れない条件の整理に失敗しちゃった。もう一度教えてもらえる？", llm.error)
  }
  const parsed = llm.parsed ?? {}

  // intro フェーズ（安全装置：LLMが予期せずintroを返した場合）
  if (parsed?.control?.phase === "intro") {
    // 既にintro質問を表示済みの場合はスキップ（重複防止）
    if (session.meta.step4_intro_shown) {
      console.warn("[STEP4 WARNING] LLM returned intro phase but intro was already shown. Treating as empathy phase.")
      // カウンターは既にインクリメント済みなので、そのまま継続
      // empathyフェーズとして処理を続行
      parsed.control.phase = "empathy"
      // 以下の処理を続行させる（return しない）
    } else {
      // intro質問を初めて表示する（通常はここには来ないはず）
      console.log("[STEP4] LLM returned intro. Showing intro question.")
      session.meta.step4_intro_shown = true
      session.meta.step4_deepening_count = 0
      return {
        drill: session.drill,
        meta: { deepening_count: 0, phase: "intro", step: 4 },
        response: parsed.response || STEP_INTRO_QUESTIONS[4],
        status: session.status,
      }
    }
  }

  // ユーザーが応答した場合、カウンターを増やす
  session.meta.step4_deepening_count += 1
  console.log(`[STEP4] User responded. Counter: ${session.meta.step4_deepening_count}`)


  // サーバー側の暴走停止装置（フェイルセーフ） - generationより前にチェック
  const serverCount = session.meta.step4_deepening_count ?? 0
  // 2回のやり取りで強制的にgenerationフェーズへ（しつこすぎるのを防止）
  if (serverCount >= 2) {
    console.log(`[STEP4 FAILSAFE] Forcing transition to STEP5. Server count: ${serverCount}`)

    // フェイルセーフで遷移する場合でも、LLMにmust_ids/must_textを生成させる
    // session.historyからSTEP4のユーザー発話を取得
    const step4Texts = session.history
      .filter(h => h.step === 4 && h.role === "user")
      .map(h => h.text)
      .filter(Boolean)

    // LLMにgenerationを依頼（強制的にmust_ids生成）
    // 全発話を結合してタグを絞り込む
    const combinedText = step4Texts.join("。")
    const filteredTagsForGen = filterTagsByUserText(combinedText, TAGS_DATA)
    
    const genPayload = {
      force_generation: true, // generationフェーズを強制
      locale: "ja",
      recent_texts: step4Texts,
      stage: { turn_index: 999 }, // 終了フラグ
      status: session.status,
      tags: filteredTagsForGen,  // 絞り込んだタグのみを送る
      user_text: combinedText, // 全ての発話を結合
    }

    const genLLM = await callLLM(4, genPayload, session, { model: "gpt-4o" })

    if (genLLM.ok && genLLM.parsed?.status) {
      // LLM生成成功：statusを適用
      applyMustStatus(session, genLLM.parsed.status, genLLM.parsed.meta ?? {})
      ensureAutoConfirmedIds(session, autoConfirmedIds, autoDirectionMap)
      ensureAutoConfirmedIds(session, autoConfirmedIds, autoDirectionMap)
      finalizeMustState(session)
    }
    
    // ID化できなかった場合でも、ユーザー発話をそのまま保存（内部用語は使わない）
    if (step4Texts.length > 0) {
      // must_textが空の場合のみ、ユーザー発話をそのまま保存
      if (!session.status.must_text || session.status.must_text.trim() === "") {
        session.status.must_text = step4Texts.join("、")
      }
      // must_have_idsが空でもOK（ID化できなかった場合）
      if (!Array.isArray(session.status.must_have_ids)) {
        session.status.must_have_ids = []
      }
    } else {
      // 発話がない場合のフォールバック
      session.status.must_text = "譲れない条件について伺いました。"
      session.status.must_have_ids = []
    }

    finalizeMustState(session)

    session.step = 5
    session.stage.turnIndex = 0
    session.meta.step4_deepening_count = 0

    const step5Response = await handleStep5(session, "")
    const step5Message = step5Response.response || STEP_INTRO_QUESTIONS[5]
    const bridgeMessage = buildStep4BridgeMessage("", "", step5Message)
    // must_textは表示せず、STEP5の質問のみを返す（LLMの不要な発話を防ぐ）
    return {
      drill: step5Response.drill,
      meta: { step: session.step },
      response: bridgeMessage,
      status: session.status,
    }
  }

  // generation フェーズ（Must確定、STEP5へ移行）
  if (parsed?.status && typeof parsed.status === "object") {
    // LLM から帰ってきた譲れない条件をセッションへ適用
    applyMustStatus(session, parsed.status, parsed.meta ?? {})
    ensureAutoConfirmedIds(session, autoConfirmedIds, autoDirectionMap)
    ensureAutoConfirmedIds(session, autoConfirmedIds, autoDirectionMap)
    finalizeMustState(session)
    
    // ID化が行われていない場合、強制的にID化を試みる
    const hasMustIds = Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0
    const hasNgIds = Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0
    const hasPendingIds = Array.isArray(session.status.pending_ids) && session.status.pending_ids.length > 0
    
    if (!hasMustIds && !hasNgIds && !hasPendingIds) {
      // ID化が行われていない場合、ユーザー発話をそのまま保存（内部用語は使わない）
      console.log("[STEP4] No IDs found in status. Saving user text as-is.")
      const step4Texts = session.history
        .filter(h => h.step === 4 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean)
      
      if (step4Texts.length > 0) {
        // ユーザー発話をそのまま保存
        session.status.must_text = step4Texts.join("、")
        session.status.must_have_ids = []
        session.status.ng_ids = []
        session.status.pending_ids = []
        finalizeMustState(session)
      }
    }
    
    // status_barが空の場合、must_have_idsまたはng_idsから生成
    if (!session.status.status_bar || session.status.status_bar.trim() === "") {
      const statusBarParts = []
      if (Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0) {
        const directionMap = session.status.direction_map ?? {}
        for (const id of session.status.must_have_ids) {
          const direction = directionMap[String(id)] || "have"
          statusBarParts.push(`${id}:${direction}`)
        }
      }
      if (Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0) {
        const directionMap = session.status.direction_map ?? {}
        for (const id of session.status.ng_ids) {
          const direction = directionMap[String(id)] || "ng"
          statusBarParts.push(`${id}:${direction}`)
        }
      }
      if (Array.isArray(session.status.pending_ids) && session.status.pending_ids.length > 0) {
        for (const id of session.status.pending_ids) {
          statusBarParts.push(`${id}:pending`)
        }
      }
      if (statusBarParts.length > 0) {
        session.status.status_bar = statusBarParts.join(",")
      }
    }
    finalizeMustState(session)
    
    // 次のステップは LLM の meta から決定（デフォルトは 5）
    // STEP4では meta.step は 5 または 6 のみが有効
    let nextStep = Number(parsed?.meta?.step) || 5
    if (nextStep !== 5 && nextStep !== 6) {
      console.warn(`[STEP4 WARNING] Invalid meta.step=${nextStep} from LLM. Defaulting to 5.`)
      nextStep = 5;  // 不正な値の場合はデフォルトの5にする
    }

    // セッションを次STEPにセットして、次STEPの初回質問を取得
    session.step = nextStep
    session.stage.turnIndex = 0
    // deepening_countをリセット
    if (session.meta) session.meta.step4_deepening_count = 0

    switch (nextStep) {
      case 5: {
        // STEP5（Self）の初回質問を使用
        resetDrill(session)

        // ID化が成功した場合、確認メッセージを追加
        const hasMustIds = Array.isArray(session.status.must_have_ids) && session.status.must_have_ids.length > 0
        const hasNgIds = Array.isArray(session.status.ng_ids) && session.status.ng_ids.length > 0

        let confirmMessage = ""
        if (hasMustIds || hasNgIds) {
          // ID化成功：確認メッセージ
          const idNames = []
          if (hasMustIds) {
            for (const id of session.status.must_have_ids) {
              const name = TAG_NAME_BY_ID.get(Number(id))
              if (name) idNames.push(name)
            }
          }
          if (hasNgIds) {
            for (const id of session.status.ng_ids) {
              const name = TAG_NAME_BY_ID.get(Number(id))
              if (name) idNames.push(name)
            }
          }
          if (idNames.length > 0) {
            confirmMessage = `「${idNames.join("、")}」について確認できたよ！`
          }
        }

        const empathyMessage = sanitizeStep4Empathy(userText, parsed.response ?? "")
        // 共感 → 確認 → STEP5の質問を結合（重複「ありがとう」を防止）
        const combinedResponse = buildStep4BridgeMessage(empathyMessage, confirmMessage, STEP_INTRO_QUESTIONS[5])
        return {
          drill: session.drill,
          meta: { deepening_count: 0, step: session.step },
          response: combinedResponse,
          status: session.status,
        }
      }
      case 6: {
        // STEP6（Doing/Being）を即実行
        const step6Response = await handleStep6(session, "")
        const combinedResponse = [session.status.must_text, step6Response.response].filter(Boolean).join("\n\n")
        return {
          drill: step6Response.drill,
          meta: { deepening_count: 0, step: session.step },
          response: combinedResponse || step6Response.response,
          status: session.status,
        }
      }
      default: {
        // 想定外の nextStep の場合は譲れない条件を保存した旨だけ返す（余計な確認はしない）
        return {
          drill: session.drill,
          meta: { deepening_count: 0, step: session.step },
          response: session.status.must_text || "譲れない条件を受け取ったよ。",
          status: session.status,
        }
      }
    }
  }

  // 通常の会話フェーズ（empathy, candidate_extraction, direction_check, deepening など）
  if (parsed?.control?.phase) {
    let responseText = sanitizeEmpathyOutput(parsed.response ?? "")

    // 【安全装置1】empathyフェーズの場合、共感だけでなく質問も追加
    if (parsed.control.phase === "empathy") {
      // 自動ID確定後は必ず「have/ng」を聞く質問を追加
      const userInput = userText ?? ""
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ")
      const combinedText = `${userInput} ${recentTexts}`

      let question
      
      // 方向性が既に明確な場合は質問をスキップ
      const allDirectionsConfirmed = autoConfirmedIds.length > 0 && autoConfirmedIds.every((id) => {
        const key = String(id)
        const direction = autoDirectionMap[key] || session.status.direction_map?.[key]
        return direction && direction !== "pending"
      })

      // すでに方向性が確定している場合（IDも確定している場合）は方向性確認不要
      if (allDirectionsConfirmed && autoConfirmedIds.length > 0) {
        // 方向性が明確な場合は次の条件を聞く
        question = "他に『ここだけは譲れない』って思う条件があったら教えてほしいな✨"
      } else if (pendingDirectionTag) {
        // 方向性が不明なタグがある場合、方向性を確認する質問を出す
        const tagName = pendingDirectionTag.name || "それ"
        question = `${tagName}は避けたい？それとも希望する条件かな？`
      } else if (autoConfirmedIds.length > 0) {
        const needsDirection = autoConfirmedIds.some((id) => {
          const key = String(id)
          return (autoDirectionMap[key] || session.status.direction_map?.[key]) === "pending"
        })
        question = needsDirection ? "『絶対あってほしい』『絶対なしにしてほしい』のどちらかで教えてほしいな。" : "他に『ここだけは譲れない』条件が思い浮かんだら教えてほしいな✨"
      } else {
        // 通常の質問生成ロジック
        const isShortWord = userInput.length <= 10

      if (isShortWord && serverCount === 0) {
        // 初回：方向性を確認（あってほしいのか、なしにしてほしいのか）
        // 選択肢をボタン形式で提示
        if (userInput.includes("残業")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["残業なし", "多少の残業はOK"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: `${responseText ? `${responseText}\n\n` : ""}残業については、どちらが合うか教えてほしいな。`,
            status: session.status,
          }
        } else if (userInput.includes("休み") || userInput.includes("休日")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["完全週休2日", "月6日以上あればOK"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: `${responseText ? `${responseText}\n\n` : ""}休日面では、どちらが理想かな？`,
            status: session.status,
          }
        } else if (userInput.includes("給料") || userInput.includes("給与") || userInput.includes("年収") || userInput.includes("昇給") || userInput.includes("アップ")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["年収300万円以上", "年収350万円以上", "年収400万円以上", "年収450万円以上", "年収500万円以上"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: `${responseText ? `${responseText}\n\n` : ""}年収については、どのくらいを希望するか教えてほしいな。`,
            status: session.status,
          }
        } else {
            question = "その条件は『絶対あってほしい』『絶対なしにしてほしい』のどちらかで教えてほしいな。"
        }
      } else {
        // 2回目以降：方向性（have/ng）を確認する質問を優先
        if (serverCount === 1) {
          // 残業の場合
          if (combinedText.includes("残業")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["残業なし", "多少の残業はOK"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: `${responseText ? `${responseText}\n\n` : ""}残業については、どちらが合うか教えてほしいな。`,
              status: session.status,
            }
          } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["完全週休2日", "月6日以上あればOK"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: `${responseText ? `${responseText}\n\n` : ""}休日面では、どちらが理想かな？`,
              status: session.status,
            }
          } else if (combinedText.includes("給料") || combinedText.includes("給与") || combinedText.includes("年収") || combinedText.includes("昇給") || combinedText.includes("アップ")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["年収300万円以上", "年収350万円以上", "年収400万円以上", "年収450万円以上", "年収500万円以上"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: `${responseText ? `${responseText}\n\n` : ""}年収については、どのくらいを希望するか教えてほしいな。`,
              status: session.status,
            }
          } else {
            // デフォルト：方向性を確認
            question = "その条件は『絶対あってほしい』『絶対なしにしてほしい』のどちらかで教えてほしいな。"
          }
        } else {
          // 3回目以降：重要度や具体的な場面を確認
          const questions = [
              "その条件について、どんな場面で必要だと感じるか共有してくれるとうれしいな。",
              "もし叶わないとしたら、どんなところが困りそうか教えてほしいな。"
          ]
            question =
              questions[Math.min(serverCount - 2, questions.length - 1)] ||
              "その条件について、もう少し詳しく共有してくれるとうれしいな。"
          }
        }
      }

      // 質問がある場合のみ追加
      if (question) {
      responseText = responseText ? `${responseText}\n\n${question}` : question
      }
    }

    // 【安全装置2】曖昧な質問を検出して具体的な質問に置き換える
    const vaguePatterns = [
      /もう少し詳しく/,
      /もっと具体的に/,
      /詳しく教えて/,
      /もう少し話して/,
      /具体的に聞かせて/
    ]

    const isVague = vaguePatterns.some(pattern => pattern.test(responseText))

    if (isVague || (!responseText && parsed.control.phase !== "empathy")) {
      // ユーザーの発話内容を取得
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ")
      const currentText = userText ?? ""
      const combinedText = `${currentText} ${recentTexts}`

      // カウンターに応じて具体的な質問を生成（ユーザーの発話内容に基づく）
      if (serverCount === 0) {
        responseText = "例えば働き方で言うと、『リモートワークができる』『フレックスタイム』『残業なし』などの中で、どれが一番大事か教えてほしいな。"
      } else if (serverCount === 1) {
        // 方向性を確認する質問（選択肢形式）
        if (combinedText.includes("残業")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["残業なし", "多少の残業はOK"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: "残業については、どちらが合うか教えてほしいな。",
            status: session.status,
          }
        } else if (combinedText.includes("給料") || combinedText.includes("給与") || combinedText.includes("年収") || combinedText.includes("収入") || combinedText.includes("昇給")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["年収300万円以上", "年収350万円以上", "年収400万円以上", "年収450万円以上", "年収500万円以上"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: "年収については、どのくらいを希望するか教えてほしいな。",
            status: session.status,
          }
        } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
          session.drill.phase = "step4_direction_choice"
          session.drill.awaitingChoice = true
          session.drill.options = ["完全週休2日", "月6日以上あればOK"]
          return {
            drill: session.drill,
            meta: { deepening_count: serverCount, phase: "choice", step: 4 },
            response: "休日面では、どちらが理想かな？",
            status: session.status,
          }
        } else {
          responseText = "その条件は『絶対あってほしい』『絶対なしにしてほしい』のどちらかで教えてほしいな。"
        }
      } else {
        // 3回目以降：方向性が確定していない場合は方向性を確認、確定している場合は重要度を確認
        // 方向性が確定していない場合は比較質問は出さない
        let comparisonQuestion
        
        // 方向性を示すキーワードをチェック
        const hasPositiveKeywords = combinedText.includes("欲しい") || combinedText.includes("いい") || combinedText.includes("希望") || combinedText.includes("理想")
        const hasNegativeKeywords = combinedText.includes("避けたい") || combinedText.includes("嫌") || combinedText.includes("なし") || combinedText.includes("したくない")
        
        // 方向性が確定していない場合
        if (!hasPositiveKeywords && !hasNegativeKeywords) {
          // 方向性を確認する質問（選択肢形式）
          if (combinedText.includes("残業")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["残業なし", "多少の残業はOK"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: "残業については、どちらが合うか教えてほしいな。",
              status: session.status,
            }
          } else if (combinedText.includes("給料") || combinedText.includes("給与") || combinedText.includes("年収") || combinedText.includes("収入") || combinedText.includes("昇給")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["年収300万円以上", "年収350万円以上", "年収400万円以上", "年収450万円以上", "年収500万円以上"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: "年収については、どのくらいを希望するか教えてほしいな。",
              status: session.status,
            }
          } else if (combinedText.includes("休み") || combinedText.includes("休日")) {
            session.drill.phase = "step4_direction_choice"
            session.drill.awaitingChoice = true
            session.drill.options = ["完全週休2日", "月6日以上あればOK"]
            return {
              drill: session.drill,
              meta: { deepening_count: serverCount, phase: "choice", step: 4 },
              response: "休日面では、どちらが理想かな？",
              status: session.status,
            }
          } else {
            comparisonQuestion = "その条件は『絶対あってほしい』『絶対なしにしてほしい』のどちらかで教えてほしいな。"
          }
        } else {
          // 方向性が確定している場合は重要度を確認
          comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？"
        }
        if (comparisonQuestion) {
        responseText = comparisonQuestion
        }
      }
    }

    if (parsed.control.phase === "empathy") {
      responseText = sanitizeStep4Empathy(userText, responseText)
    }

    // LLMの応答が空の場合のフォールバック（origin/mainから追加）
    if (!responseText || responseText.trim() === "") {
      console.warn(`[STEP4 WARNING] Empty response from LLM (phase: ${parsed.control.phase}). Using fallback.`)
      responseText = "ありがとう。その条件について確認させてね"
    }

    return {
      drill: session.drill,
      meta: {
        deepening_count: serverCount,
        phase: parsed.control.phase,
        step: 4,
      },
      response: responseText,
      status: session.status,
    }
  }

  // 最終フォールバック（通常はここに到達しない）
  return {
    drill: session.drill,
    meta: { deepening_count: serverCount, step: 4 },
    response: "働く上で『ここだけは譲れない』って条件、他にもある？例えば働き方、職場の雰囲気、給与、休日とか。",
    status: session.status,
  }
}

async function handleStep5(session, userText) {
  // 【重要】STEP遷移時（userTextが空）は、LLMを呼ばずにintro質問を返す
  if (!userText || !userText.trim()) {
    return {
      drill: session.drill,
      meta: { step: 5 },
      response: STEP_INTRO_QUESTIONS[5],
      status: session.status,
    }
  }

  // userTextがある場合のみturnIndexをインクリメント
    session.stage.turnIndex += 1
  
  // ペイロード最適化：発話履歴ではなく生成済みテキストを送る
  const payload = {
    // 生成済みの整形テキストのみ送る（発話履歴は送らない）
    context: {
      can_text: session.status.can_text ?? "",
      must_summary: formatMustSummary(session),
      will_text: session.status.will_text ?? "",
    },
    locale: "ja",
    stage: { turn_index: session.stage.turnIndex },
    status: {
      self_text: session.status.self_text ?? "",
    },
    user_text: userText,
  }
  
  // STEP5はまずGPT-4oで試す（タイムアウト回避）
  let llm = await callLLM(5, payload, session, { model: "gpt-4o" })
  if (!llm.ok) {
    console.warn(
      `[STEP5 WARNING] GPT-4o call failed (${llm.error || "unknown error"}). Retrying with GPT-4o-mini.`
    )
    llm = await callLLM(5, payload, session, { model: "gpt-4o-mini" })
  }
  if (!llm.ok) {
    console.error(
      `[STEP5 ERROR] GPT-4o/GPT-4o-mini both failed. Returning fallback message. Error: ${llm.error || "unknown"}`
    )
    return buildSchemaError(5, session, "ちょっと処理に時間がかかってるみたい。もう一度話してみてね。", llm.error)
  }
  const parsed = llm.parsed ?? {}

  // intro フェーズ（初回質問）
  if (parsed?.control?.phase === "intro") {
    // deepening_countをリセット
    if (!session.meta) session.meta = {}
    session.meta.step5_deepening_count = 0
    return {
      drill: session.drill,
      meta: { step: 5 },
      response:
        parsed.response ||
        "自分で自分ってどんなタイプの人間だと思う？周りからこんな人って言われる、っていうのでもいいよ！",
      status: session.status,
    }
  }

  // generation フェーズ（Self確定、STEP6へ移行）
  if (parsed?.status?.self_text && typeof parsed.status.self_text === "string") {
    console.log("[STEP5 GENERATION] self_text generated:", parsed.status.self_text)
    const normalizedSelf = normalizeSelfText(parsed.status.self_text)
    session.status.self_text = polishSummaryText(normalizedSelf, 3)
    // STEP5では meta.step は 6 のみが有効
    let nextStep = Number(parsed?.meta?.step) || 6
    if (nextStep !== 6) {
      console.warn(`[STEP5 WARNING] Invalid meta.step=${nextStep} from LLM. Defaulting to 6.`)
      nextStep = 6;  // 不正な値の場合はデフォルトの6にする
    }
    session.step = nextStep
    session.stage.turnIndex = 0
    // deepening_countをリセット
    if (session.meta) session.meta.step5_deepening_count = 0

    // STEP6は次の通信で呼ばれるように、ここでは生成メッセージだけ返す
    const transitionMessage = "たくさん話してくれてありがとう！\n\n今あなたオリジナルのキャリアシートを作成しているよ。少し待ってね"
    return {
      drill: session.drill,
      meta: { step: session.step },
      response: transitionMessage,
      status: session.status,
    }
  }
  
  console.log("[STEP5 DEBUG] No generation phase detected. parsed.status:", parsed?.status)

  // empathy + deepening フェーズ（STEP2/3と同じ構造）
  const { ask_next, empathy, meta } = parsed
  if (typeof empathy === "string") {
    // サーバー側でdeepening_countを管理（フェイルセーフ）
    if (!session.meta) session.meta = {}
    if (typeof session.meta.step5_deepening_count !== "number") {
      session.meta.step5_deepening_count = 0
    }
    session.meta.step5_deepening_count += 1

    // STEP5では meta.step は 6 のみが有効（STEP6への遷移）
    // 1, 2, 3, 4, 5 などの不正な値が返ってきた場合は無視する
    let llmNextStep = Number(meta?.step) || session.step
    if (llmNextStep !== session.step && llmNextStep !== 6) {
      console.warn(`[STEP5 WARNING] Invalid meta.step=${llmNextStep} from LLM. Ignoring.`)
      llmNextStep = session.step;  // 不正な値は無視して現在のステップを維持
    }

    let nextStep = llmNextStep

    // サーバー側の暴走停止装置（フェイルセーフ）
    // LLMのdeepening_countとサーバー側のカウントの両方をチェック
    const deepeningCount = Number(meta?.deepening_count) ?? 0
    const serverCount = session.meta.step5_deepening_count ?? 0

    if (llmNextStep === session.step && (deepeningCount >= 3 || serverCount >= 3)) {
      // 3回に達したら強制的にSTEP6へ
      // ただし、self_textが生成されていない場合は先に生成する
      if (!session.status.self_text) {
        console.log(`[STEP5 FAILSAFE] Forcing self_text generation before transition to STEP6.`)
        // session.historyからSTEP5のユーザー発話を取得
        const step5Texts = session.history
          .filter(h => h.step === 5 && h.role === "user")
          .map(h => h.text)
          .filter(Boolean)

        // LLMにgenerationを依頼（強制的にself_text生成）
        const genPayload = {
          force_generation: true,
          locale: "ja",
          recent_texts: step5Texts,
          stage: { turn_index: 999 },
          status: session.status,
          user_text: step5Texts.join("。"),
        }

        // フェイルセーフでもGPT-4oを使用（タイムアウト回避）
        const genLLM = await callLLM(5, genPayload, session, { model: "gpt-4o" })

        console.log("[STEP5 FAILSAFE] genLLM.ok:", genLLM.ok)
        console.log("[STEP5 FAILSAFE] genLLM.parsed?.status?.self_text:", genLLM.parsed?.status?.self_text)

        if (genLLM.ok && genLLM.parsed?.status?.self_text) {
          session.status.self_text = genLLM.parsed.status.self_text
          console.log("[STEP5 FAILSAFE] Using LLM generated self_text:", session.status.self_text)
        } else if (step5Texts.length > 0) {
          // LLM失敗時：ユーザー発話を整形して保存
          session.status.self_text = formatSelfTextFallback(step5Texts)
          console.log("[STEP5 FAILSAFE] Using fallback self_text:", session.status.self_text)
        } else {
          session.status.self_text = "あなたらしさについて伺いました。"
          console.log("[STEP5 FAILSAFE] Using default self_text")
        }
      }
      nextStep = 6
      console.log(`[STEP5 FAILSAFE] Forcing transition to STEP6. LLM count: ${deepeningCount}, Server count: ${serverCount}`)
    }

    const cleanEmpathy = sanitizeEmpathyOutput(stripQuestionSentences(empathy ?? ""))
    const refinedAsk = refineStep5Question(session, ask_next)

    if (nextStep !== session.step) {
      // STEP6へ移行
      session.step = nextStep
      session.stage.turnIndex = 0
      // deepening_countをリセット
      session.meta.step5_deepening_count = 0

      const step6Response = await handleStep6(session, "")
      // 共感 → STEP6の初回メッセージを結合（重複「ありがとう」を避ける）
      const step6Parts = []
      if (cleanEmpathy && cleanEmpathy.trim()) {
        step6Parts.push(cleanEmpathy)
      }
      const step6Message = step6Response.response ?? ""
      if (step6Message.trim()) {
        step6Parts.push(step6Message)
      }
      const combinedResponse = step6Parts.filter(Boolean).join("\n\n")
      return {
        drill: step6Response.drill,
        meta: step6Response.meta || { step: session.step },
        response: combinedResponse || step6Response.response || "ありがとう！",
        status: session.status,
      }
    }

    // 通常の会話フェーズ（empathy と ask_next を \n\n で結合）
    const message = [cleanEmpathy, refinedAsk].filter(Boolean).join("\n\n") || cleanEmpathy || "ありがとう。もう少し教えて。"
    return {
      drill: session.drill,
      meta: { step: session.step },
      response: message,
      status: session.status,
    }
  }

  return {
    drill: session.drill,
    meta: { step: 5 },
    response: "あなた自身について、もう少し聞かせてもらえる？",
    status: session.status,
  }
}

async function handleStep6(session, userText) {
  console.log("[STEP6] ===== START =====")
  if (!session.meta) session.meta = {}

  const incomingText = typeof userText === "string" ? userText.trim() : ""
  if (session.meta.step6_user_name && incomingText) {
  session.stage.turnIndex += 1
  }

  if (!session.meta.step6_user_name) {
    if (!incomingText) {
      return {
        drill: session.drill,
        meta: { phase: "ask_name", step: 6 },
        response: "それじゃあ、分析に使うあなたの名前を教えてね！フルネームじゃなくてもOKだよ✨",
        status: session.status,
      }
    }
    const sanitizedName = incomingText.replaceAll(/\s+/g, " ").slice(0, 20)
    session.meta.step6_user_name = sanitizedName
    session.status.user_name = sanitizedName
    session.stage.turnIndex = 0
    console.log("[STEP6] Captured user name:", sanitizedName)
  }

  const displayName = session.meta.step6_user_name || "あなた"
  console.log("[STEP6] can_text:", session.status.can_text)
  console.log("[STEP6] will_text:", session.status.will_text)
  console.log("[STEP6] must_text:", session.status.must_text)
  console.log("[STEP6] self_text:", session.status.self_text)
  console.log("[STEP6] Generating Strength / Doing / Being using LLM.")

  session.step = 6
    session.stage.turnIndex = 0

  const payload = {
    can_text: session.status.can_text ?? "",
    can_texts: session.status.can_texts ?? [],
    locale: "ja",
    must_text: session.status.must_text ?? "",
    self_text: session.status.self_text ?? "",
    status: {
      can_text: session.status.can_text,
      must_text: session.status.must_text,
      self_text: session.status.self_text,
      user_name: session.meta.step6_user_name ?? "",
      will_text: session.status.will_text,
    },
    user_name: session.meta.step6_user_name ?? "",
    will_text: session.status.will_text ?? "",
    will_texts: session.status.will_texts ?? [],
  }

  const llmResult = await callLLM(6, payload, session, { model: "gpt-4o" })

  if (
    llmResult.ok &&
    llmResult.parsed?.status?.doing_text &&
    llmResult.parsed?.status?.being_text
  ) {
    session.status.doing_text = smoothAnalysisText(llmResult.parsed.status.doing_text)
    session.status.being_text = smoothAnalysisText(llmResult.parsed.status.being_text)
    console.log("[STEP6] LLM generated Doing:", session.status.doing_text)
    console.log("[STEP6] LLM generated Being:", session.status.being_text)
  } else {
    console.warn("[STEP6 WARNING] LLM generation failed. Using fallback.")
    session.status.doing_text = smoothAnalysisText(session.status.can_text || "行動・実践について伺いました。")
    session.status.being_text = smoothAnalysisText(session.status.self_text || "価値観・関わり方について伺いました。")
  }

  // 職業を決定（STEP1の資格から）
  let occupation = "専門職"
  if (Array.isArray(session.status.qual_ids) && session.status.qual_ids.length > 0) {
    // STEP2〜5で最も多く言及された資格を探す
    const step2to5History = session.history.filter(h => h.step >= 2 && h.step <= 5 && h.role === "user")
    const qualMentionCounts = new Map()
    
    for (const qualId of session.status.qual_ids) {
      const qualName = QUAL_NAME_BY_ID.get(Number(qualId))
      if (!qualName) continue
      
      let count = 0
      for (const historyItem of step2to5History) {
        if (historyItem.text && historyItem.text.includes(qualName)) {
          count++
        }
      }
      qualMentionCounts.set(qualId, count)
    }
    
    // 最も多く言及された資格を選択
    let maxCount = -1
    let selectedQualId = undefined
    for (const [qualId, count] of qualMentionCounts.entries()) {
      if (count > maxCount) {
        maxCount = count
        selectedQualId = qualId
      }
    }
    
    // 言及がない場合は最初の資格を使用
    if (selectedQualId === undefined || maxCount === 0) {
      selectedQualId = session.status.qual_ids[0]
    }
    
    const selectedQualName = QUAL_NAME_BY_ID.get(Number(selectedQualId))
    if (selectedQualName) {
      occupation = selectedQualName
    }
  }
  
  // キャッチコピーを生成
  const catchcopyPayload = {
    being_text: session.status.being_text ?? "",
    can_text: session.status.can_text ?? "",
    doing_text: session.status.doing_text ?? "",
    locale: "ja",
    must_text: session.status.must_text ?? "",
    occupation: occupation,
    self_text: session.status.self_text ?? "",
    will_text: session.status.will_text ?? "",
  }
  
  let catchcopy = `${occupation}として働く人`
  try {
    const catchcopyLLM = await callLLM(6, {
      ...catchcopyPayload,
      request_type: "generate_catchcopy"
    }, session, { model: "gpt-4o" })
    
    if (catchcopyLLM.ok && catchcopyLLM.parsed?.catchcopy) {
      catchcopy = catchcopyLLM.parsed.catchcopy
      console.log("[STEP6] Generated catchcopy:", catchcopy)
    } else {
      console.warn("[STEP6 WARNING] Catchcopy generation failed. Using fallback.")
    }
  } catch (error) {
    console.error("[STEP6 ERROR] Catchcopy generation error:", error)
      }
  
  session.status.catchcopy = catchcopy

  const hearingCards = []
    if (Array.isArray(session.status.qual_ids) && session.status.qual_ids.length > 0) {
      const qualNames = session.status.qual_ids
      .map((id) => QUAL_NAME_BY_ID.get(Number(id)))
        .filter(Boolean)
        .join("、")
      if (qualNames) {
      hearingCards.push({ body: qualNames, title: "資格" })
      }
    }

  // CAN表示：LLMが生成したcan_textを使用（経歴も含まれているため、重複を避ける）
  const canSummary = Array.isArray(session.status.can_texts) && session.status.can_texts.length > 0
    ? session.status.can_texts.join("／")
    : session.status.can_text ?? ""
  
  if (canSummary) {
    hearingCards.push({ body: canSummary, title: "Can（今できること）" })
    }

  // Will表示：整形処理を適用
  const rawWill = Array.isArray(session.status.will_texts) && session.status.will_texts.length > 0
    ? session.status.will_texts.join("／")
    : session.status.will_text ?? ""
  const willSummary = rawWill ? polishSummaryText(rawWill, 3) : ""
  if (willSummary) {
    hearingCards.push({ body: willSummary, title: "Will（やりたいこと）" })
    }

  const mustSummary = formatMustSummary(session)
  if (mustSummary) {
    hearingCards.push({ body: mustSummary, title: "Must（譲れない条件）" })
    } else if (session.status.must_text) {
    hearingCards.push({ body: session.status.must_text, title: "Must（譲れない条件）" })
    }

  // Self表示：LLMで文章を再構成
  const rawSelf = session.status.self_text ?? ""
  const selfSummary = rawSelf ? await reconstructSelfAnalysis(rawSelf) : ""

  // AI分析：strengthを削除し、Doing/Beingのみ表示
  const analysisParts = []
  if (session.status.doing_text) {
    analysisParts.push({
      label: "Doing：行動・実践",
      text: session.status.doing_text
    })
  }
  if (session.status.being_text) {
    analysisParts.push({
      label: "Being：価値観・関わり方",
      text: session.status.being_text
    })
  }

  if (analysisParts.length > 0 && session.meta.step6_user_name) {
    const first = analysisParts[0]
    if (first && first.text && !first.text.includes(displayName)) {
      first.text = `${displayName}さんは${first.text.replace(/^(さん?は|は)/, "")}`
    }
  }

  const hearingHtml = `
    <section class="summary-panel summary-panel--hearing">
      <h3>📝 ヒアリングメモ</h3>
      <p class="summary-panel__note">これまで伺った情報をそのままの言葉で整理しています。</p>
      <div class="summary-pill-grid">
        ${
          hearingCards.length > 0
            ? hearingCards
                .map(
                  (card) => `
            <article class="summary-pill">
              <span class="summary-pill__label">${escapeHtml(card.title)}</span>
              <p>${escapeHtml(card.body).replaceAll('\n', "<br />")}</p>
            </article>
          `
                )
                .join("")
            : `
        <article class="summary-pill summary-pill--empty">
          <span class="summary-pill__label">ヒアリング内容</span>
          <p>入力された内容がまだありません。</p>
        </article>
      `
        }
      </div>
    </section>
  `

  const selfHtml = `
    <section class="summary-panel summary-panel--self">
      <h3>🌱 私はこんな人（自己分析）</h3>
      <p>${selfSummary ? escapeHtml(selfSummary).replaceAll('\n', "<br />") : "未入力"}</p>
    </section>
  `

  // AI分析テキストの一部をぼかす処理（1文節目 + 2文節目の5文字まで表示、残りをぼかす）
  function blurAnalysisText(text) {
    if (!text) return ''
    
    // CTAボタンのHTML（無料で作成するボタンと同じスタイル）
    const ctaButton = `<a href="https://hoap-ai-career-sheet.vercel.app/" target="_blank" rel="noopener noreferrer" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: inline-block; background: linear-gradient(135deg, #F09433 0%, #E6683C 25%, #DC2743 50%, #CC2366 75%, #BC1888 100%); border: none; border-radius: 999px; padding: 10px 20px; font-size: 14px; font-weight: 700; color: #fff; white-space: nowrap; text-decoration: none; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3); cursor: pointer; transition: transform 0.2s ease;">続きを表示</a>`
    
    // 改行で段落分割
    const paragraphs = text.split(/\n+/).filter(p => p.trim())
    
    if (paragraphs.length > 1) {
      // 複数段落の場合：1段落目は表示、2段落目以降をぼかす
      const visible = escapeHtml(paragraphs[0])
      const blurred = paragraphs.slice(1).join('\n')
      
      return `${visible}<br /><br /><div style="position: relative;"><span style="filter: blur(8px); opacity: 0.4; user-select: none; -webkit-user-select: none;">${escapeHtml(blurred).replaceAll('\n', "<br />")}</span>${ctaButton}</div>`
    }
    
    // 1段落の場合：文章を。で分割
    const sentences = text.split(/。/).filter(s => s.trim())
    
    if (sentences.length >= 2) {
      // 1文節目全体を表示
      const firstSentence = sentences[0] + '。'
      // 2文節目の最初の5文字を表示
      const secondSentence = sentences[1]
      const secondVisible = secondSentence.slice(0, 5)
      const secondBlurred = secondSentence.slice(5)
      // 3文節目以降
      const restSentences = sentences.slice(2)
      
      let result = escapeHtml(firstSentence) + escapeHtml(secondVisible)
      
      // 2文節目の残り + 3文節目以降をぼかす
      let blurredText = secondBlurred
      if (restSentences.length > 0) {
        blurredText += '。' + restSentences.join('。') + (text.endsWith('。') ? '。' : '')
      } else if (text.split('。').length > 2 || text.endsWith('。')) {
        blurredText += '。'
      }
      
      result += `<span style="position: relative; display: inline-block;"><span style="filter: blur(8px); opacity: 0.4; user-select: none; -webkit-user-select: none;">${escapeHtml(blurredText)}</span>${ctaButton}</span>`
      
      return result
    }
    
    // 1文しかない場合：後半60%をぼかす
    const visibleLength = Math.floor(text.length * 0.4)
    const visible = escapeHtml(text.slice(0, Math.max(0, visibleLength)))
    const blurred = escapeHtml(text.slice(Math.max(0, visibleLength)))
    
    return `${visible}<span style="position: relative; display: inline-block;"><span style="filter: blur(8px); opacity: 0.4; user-select: none; -webkit-user-select: none;">${blurred}</span>${ctaButton}</span>`
  }

  // AI分析HTML：大枠の中にDoing/Beingをサブセクションとして配置
  const analysisHtml = `
    <section class="summary-panel summary-panel--ai-analysis">
      <h3>🌟 AI分析</h3>
      ${analysisParts.length > 0
        ? analysisParts.map((part) => `
          <div class="analysis-subsection">
            <div class="analysis-subtitle">${escapeHtml(part.label)}</div>
            <p>${blurAnalysisText(part.text)}</p>
      </div>
        `).join("")
        : `<p>AI分析を生成中です。</p>`
      }
    </section>
  `

  // キャッチコピーはぼかさず全文表示

  const sheetHeaderHtml = `
    <div style="text-align: center; margin-bottom: 32px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #000;">
        ${escapeHtml(displayName)}さんのキャリア分析シート
      </h2>
      <div style="position: relative; display: inline-block; text-align: left; max-width: 90%;">
        <span style="display: inline-block; background: linear-gradient(135deg, #fde2f3, #e9e7ff 50%, #e6f0ff); color: #000; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 999px; margin-bottom: 8px;">キャッチコピー</span>
        <p style="margin: 0; font-size: clamp(20px, 4.5vw, 28px); font-weight: 900; line-height: 1.5; letter-spacing: 0.02em; background: linear-gradient(135deg, #F09433 0%, #E6683C 25%, #DC2743 50%, #CC2366 75%, #BC1888 100%); -webkit-background-clip: text; background-clip: text; color: transparent; font-family: 'Klee', 'Hiragino Maru Gothic ProN', 'ヒラギノ丸ゴ ProN W4', 'HG正楷書体-PRO', 'HGP行書体', 'HG丸ｺﾞｼｯｸM-PRO', 'Segoe Print', 'Comic Sans MS', cursive, sans-serif;">
          ${escapeHtml(catchcopy)}
        </p>
      </div>
    </div>
  `

  const summaryReportHtml = `
    <div class="summary-report">
      ${sheetHeaderHtml}
      <div class="summary-report__grid">
        ${hearingHtml}
        <div class="summary-report__analysis">
          ${selfHtml}
          ${analysisHtml}
        </div>
      </div>
    </div>
  `.trim()

  const ctaHtml = `
    <div class="summary-cta" style="text-align: center; margin: 0 auto; max-width: 600px; display: flex; flex-direction: column; align-items: center;">
      <p style="color: #000; font-weight: 600; margin: 0 0 12px 0; font-size: 14px; line-height: 1.7; text-align: center; width: 100%;">
        AIによる分析を全部見たり、<br>オリジナルキャリアシートを無料作成するにはここから！
      </p>
      <a href="https://hoap-ai-career-sheet.vercel.app/" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: linear-gradient(135deg, #F09433 0%, #E6683C 25%, #DC2743 50%, #CC2366 75%, #BC1888 100%); border: none; border-radius: 999px; padding: 14px 32px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3); transition: transform 0.2s ease; text-decoration: none;">無料で作成する</a>
    </div>
  `.trim()

  // ai_analysisはDoing/Beingの組み合わせ
  const analysisTexts = analysisParts.map(part => part.text).filter(Boolean)
  session.status.ai_analysis = analysisTexts.join("\n\n").trim()

  const finalMessage = [
    `${displayName}さん、ここまでたくさん話してくれて本当にありがとう！`,
    "このあと『ヒアリング内容』と『分析』をまとめたシートを開くね。",
    "まずはあなたの言葉を振り返ってみて、次にAIからの分析もチェックしてみて！",
    "レポートを表示するまで数秒だけ待っててね✨"
  ].join("\n\n")

    return {
      drill: session.drill,
      meta: {
        cta_html: ctaHtml,
      show_summary_after_delay: 5000,
        step: session.step,
        summary_data: summaryReportHtml || "キャリアの説明書を作成しました。",
      },
      response: finalMessage,
    status: session.status,
  }
}

function initialGreeting(session) {
  return {
    drill: session.drill,
    meta: { step: session.step },
    response: "こんにちは！AIキャリアデザイナーのほーぷちゃんだよ✨\n今日はあなたのキャリア分析シートを作っていくね！\n\nまずは持っている資格を教えて欲しいな🌱\n複数ある場合は1つずつ教えてね。\n資格がない場合は「資格なし」でOKだよ！",
    status: session.status,
  }
}

// KVが利用可能かチェック
function isKVAvailable() {
  return kv !== undefined && kv !== undefined && process.env.KV_REST_API_URL
}

/**
 * テキストから方向性を判定する
 * @param {string} text - 判定対象のテキスト
 * @returns {string|undefined} "have" | "ng" | "pending" | undefined
 */
function judgeDirection(text) {
  const normalized = text.replaceAll(/\s+/g, "")

  // 否定パターン（明確にngと判断できる場合のみ）
  const negPattern = /(絶対|まったく|全然|全く|完全)\s*(なし|避け|NG|いや|いやだ|無理|したくない)/
  const negKeywords = /(なし|困る|避けたい|無理|いや|いやだ|遠慮|拒否|嫌|苦手|できない)/

  // 肯定パターン（明確にhaveと判断できる場合のみ）
  const posPattern = /(絶対|必ず|どうしても|ぜひ)\s*(ほしい|欲しい|必要|あってほしい|したい)/
  const posKeywords = /(ほしい|欲しい|必要|希望|理想|重視|大事|重要|働きたい|やりたい|興味|魅力|がいい|できる|可能|OK|いい|したい|好き)/

  // 保留パターン
  const neutralPattern = /(あれば|できれば|できたら|なくても|なくて|どちらでも)/
  const flexiblePattern = /(多少|ちょっと|少し|月\d+時間|20時間|二十時間)/

  if (negPattern.test(normalized) || negKeywords.test(normalized)) {
    return "ng"
  } else if (posPattern.test(normalized) || posKeywords.test(normalized)) {
    return "have"
  } else if (neutralPattern.test(normalized) || flexiblePattern.test(normalized)) {
    return "pending"
  }

  return undefined; // 不明な場合はLLMに委ねる
}

function normalizeSelfText(text) {
  if (!text) return ""
  return String(text)
    .replaceAll(/\s*\n\s*/g, " ")
    .replaceAll(/\s{2,}/g, " ")
    .replaceAll(/。{2,}/g, "。")
    .trim()
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return createSession()
  if (typeof session.id !== "string" || !session.id) {
    session.id = `s_${Math.random().toString(36).slice(2)}`
  }
  if (!Array.isArray(session.history)) session.history = []
  if (!session.status || typeof session.status !== "object") session.status = {}
  if (!Array.isArray(session.status.qual_ids)) session.status.qual_ids = []
  if (!Array.isArray(session.status.licenses)) session.status.licenses = []
  if (!session.drill || typeof session.drill !== "object") {
    session.drill = { awaitingChoice: false, options: [], phase: undefined }
  }
  if (!Array.isArray(session.drill.options)) session.drill.options = []
  if (typeof session.drill.awaitingChoice !== "boolean") session.drill.awaitingChoice = false
  if (!session.stage || typeof session.stage !== "object") {
    session.stage = { turnIndex: 0 }
  }
  if (typeof session.stage.turnIndex !== "number") session.stage.turnIndex = 0
  if (!session.meta || typeof session.meta !== "object") {
    session.meta = { deepening_attempt_total: 0 }
  }
  if (typeof session.meta.deepening_attempt_total !== "number") {
    session.meta.deepening_attempt_total = 0
  }
  // セッション移行：既存セッションに新しいカウンターフィールドを初期化
  if (typeof session.meta.step2_deepening_count !== "number") {
    session.meta.step2_deepening_count = 0
  }
  if (typeof session.meta.step3_deepening_count !== "number") {
    session.meta.step3_deepening_count = 0
  }
  if (typeof session.meta.step4_deepening_count !== "number") {
    session.meta.step4_deepening_count = 0
  }
  if (typeof session.meta.step5_deepening_count !== "number") {
    session.meta.step5_deepening_count = 0
  }
  // session.stepが数値でない場合のみ1に初期化（0も有効なステップとして扱う）
  if (typeof session.step !== "number" || session.step < 0 || session.step > 10) {
    console.warn(`[SESSION NORMALIZE] Invalid step detected: ${session.step}, resetting to 1`)
    session.step = 1
  }
  return session
}

function polishSummaryText(text, maxSentences = 3) {
  if (!text) return ""
  const normalized = String(text)
    .replaceAll('\r', " ")
    .replaceAll(/\s+/g, " ")
    .trim()
  if (!normalized) return ""

  let sentences = normalized
    .split(/(?<=[。！？!])/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length === 0) {
    const clauses = normalized
      .split(/、/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (clauses.length > 0) {
      const merged = []
      let buffer = []
      for (const clause of clauses) {
        buffer.push(clause)
        const joined = buffer.join("、")
        if (joined.length >= 40 || buffer.length >= 2) {
          merged.push(joined)
          buffer = []
        }
      }
      if (buffer.length > 0) {
        merged.push(buffer.join("、"))
      }
      sentences = merged
    } else {
      sentences = [normalized]
    }
  }

  const polished = []
  for (const sentence of sentences) {
    if (!sentence) continue
    polished.push(ensurePoliteEnding(sentence))
    if (polished.length >= maxSentences) break
  }
  if (polished.length === 0) {
    polished.push(ensurePoliteEnding(normalized))
  }
  return polished.join("")
}

async function reconstructSelfAnalysis(rawText) {
  if (!rawText) return ""

  // まず基本的な整形を適用
  const normalized = String(rawText)
    .replaceAll('\r', " ")
    .replaceAll(/\s+/g, " ")
    .trim()

  if (!normalized) return ""

  // 既に十分整っている文章かチェック（完全な文が3つ以上あり、不完全な語尾がない）
  const sentences = normalized.split(/(?<=[。！？])/).filter(Boolean)
  const hasIncompleteEndings = /[、とき]。/.test(normalized)
  const hasFragmentation = sentences.some(s => s.length < 15 || /^[、。]/.test(s))

  if (sentences.length >= 3 && !hasIncompleteEndings && !hasFragmentation) {
    // 既に整っているのでLLM呼び出しをスキップ
    return polishSummaryText(normalized, 5)
  }

  // LLMで文章を再構成
  const prompt = `あなたは自己分析テキストを整形する専門家です。
以下のテキストはユーザーが自分について語った内容の断片です。
これを、意味が通る自然な日本語の文章に再構成してください。

【入力テキスト】
${normalized}

【再構成ルール】
1. ユーザーの言葉と内容を変えない（事実の追加・削除禁止）
2. 不完全な文（「〜とき。」など）を完全な文に修正する
3. 断片的な発話を接続詞で繋ぎ、滑らかな文章にする
4. 180〜280字の一人称文章（「私は」「私の」）として整形
5. 語尾は全て丁寧語（「〜です」「〜ます」「〜でした」）で統一
6. 3〜4文で構成し、各文を自然に繋げる
7. 定型文（「という性格です」「という人間です」など）は使用禁止
8. 仕事の話ではなく、人としての性格・価値観を描く

【出力】
再構成した文章のみを出力してください。説明や前置きは不要です。`

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.warn("[reconstructSelfAnalysis] Missing API key, using fallback")
      return polishSummaryText(normalized, 5)
    }

    const openai = new OpenAI({ apiKey })
    const response = await openai.chat.completions.create({
      max_tokens: 500,
      messages: [
        { content: "You are a professional text editor specializing in Japanese self-analysis texts.", role: "system" },
        { content: prompt, role: "user" }
      ],
      model: "gpt-4o",
      temperature: 0.3,
    })

    const reconstructed = response.choices?.[0]?.message?.content?.trim()
    if (reconstructed && reconstructed.length >= 50) {
      console.log("[reconstructSelfAnalysis] Successfully reconstructed:", reconstructed)
      return reconstructed
    } else {
      console.warn("[reconstructSelfAnalysis] LLM returned insufficient text, using fallback")
      return polishSummaryText(normalized, 5)
    }
  } catch (error) {
    console.error("[reconstructSelfAnalysis] Error calling LLM:", error)
    return polishSummaryText(normalized, 5)
  }
}

function refineStep5Question(session, question) {
  let result = String(question ?? "").trim()
  if (!result) return result

  const hasQuestionMark = /[？?]$/.test(result)
  const lastUserText = getLatestUserText(session, 5)
  const anchor = deriveAnchorText(lastUserText)

  // 「〜と思う」「〜と思います」で終わる場合の不自然な「と感じたとき」を検出して修正
  const thinkingPatterns = /(と思う|と思います|だと思う|だと思います|と感じる|と感じます)と感じたとき/
  if (thinkingPatterns.test(result)) {
    // 「〜と思うと感じたとき」を「そう思うのはどんなときが多い？」などに置き換え
    result = result.replace(thinkingPatterns, "")
    result = anchor ? `それって、いつ頃からそう思うようになった？` : `そう思うのは、どんな場面が多い？`
  }

  // 「〜言われます」で終わる場合の不自然な「と感じたとき」を検出して修正
  const passivePatterns = /(言われます|言われる|されます|される)と感じたとき/
  if (passivePatterns.test(result)) {
    result = result.replace(passivePatterns, "")
    result = anchor ? `それって、誰に一番言われる？` : `そう言われるのは、どんなときが多い？`
  }

  const ambiguousPatterns = [
    /いつも/,
    /どんな場面/,
    /どんな感じ/,
    /どう感じる/,
    /何かある/,
    /どんなとき/,
    /^それって/,
  ]

  if (anchor && ambiguousPatterns.some((p) => p.test(result))) {
    // anchorが「〜と思う/思います」で終わる場合は「と感じたとき」を使わない
    result = /(と思う|と思います|だと思う|だと思います)$/.test(anchor) ? `それって、いつ頃からそう思うようになった？` : `${anchor}と感じたとき、具体的にどんな状況だった？`
  }

  if (!hasQuestionMark) {
    result = result.replaceAll(/[。]+$/g, "").trim()
    result = `${result}？`
  }
  return result
}

function resetDrill(session) {
  if (!session) return
  session.drill = { awaitingChoice: false, options: [], phase: undefined }
}

function sanitizeEmpathyOutput(text) {
  if (!text) return text
  let sanitized = String(text)
  sanitized = sanitized.replaceAll(/[？?]+/g, "！")
  sanitized = sanitized.replaceAll(/(教えて|聞かせて|話して)(ね|ください|ほしい|欲しい)[！。]*/g, "")
  sanitized = sanitized.replaceAll(/\s{2,}/g, " ").trim()
  return sanitized
}

function sanitizeStep4Empathy(userText, responseText) {
  if (!responseText) return responseText
  const original = String(responseText)
  const user = String(userText ?? "")
  const normalizedUser = user.normalize("NFKC")
  const neutralKeywords = ["夜勤", "残業", "深夜", "夜間", "交代", "シフト"]
  const positiveIndicators = ["好き", "やりたい", "希望", "したい", "惹かれて", "わくわく", "ワクワク", "楽しみ", "挑戦したい", "興味がある"]

  const mentionsNeutral = neutralKeywords.some((kw) => normalizedUser.includes(kw))
  if (!mentionsNeutral) return original

  const hasPositiveCue = positiveIndicators.some((kw) => normalizedUser.includes(kw))
  if (hasPositiveCue) return original

  let sanitized = original
  const patterns = [
    /[^。！？!?]*惹かれる[^。！？!?]*[。！？!?]/g,
    /[^。！？!?]*魅力[^。！？!?]*[。！？!?]/g,
  ]

  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, "")
  }

  sanitized = sanitized.trim()
  return sanitized || "教えてくれてありがとう。"
}

async function saveSession(session) {
  if (!session?.id) return

  const kvAvailable = isKVAvailable()
  console.log(`[SESSION DEBUG] Saving session ${session.id}, step: ${session.step}, KV available: ${kvAvailable}`)

  // KVが利用可能な場合
  if (kvAvailable) {
    try {
      await kv.set(`session:${session.id}`, session, { ex: SESSION_TTL })
      console.log(`[SESSION] Saved to KV: ${session.id}, step: ${session.step}`)
      // KVに保存成功した場合もメモリにバックアップ（同一インスタンス内での高速アクセス用）
      memoryStorage.set(session.id, session)
      console.log(`[SESSION] Also cached in memory: ${session.id}`)
      return
    } catch (error) {
      console.error(`[KV ERROR] Failed to save session ${session.id}:`, error)
      // KVエラー時もフォールバックとしてメモリに保存
      memoryStorage.set(session.id, session)
      console.log(`[SESSION] Fallback to memory: ${session.id}, step: ${session.step}`)
      return
    }
  }

  // メモリストレージに保存（KVが利用不可の場合）
  memoryStorage.set(session.id, session)
  console.log(`[SESSION] Saved to memory: ${session.id}, step: ${session.step}`)
  console.warn(`[SESSION WARNING] KV not available, memory storage is not persistent across serverless instances!`)
}

function smoothAnalysisText(text) {
  if (!text) return ""
  let result = String(text)
    .replaceAll(/(^|\n)この人は[、\s]*/g, "$1")
    .replaceAll('この人は', "")
    .replaceAll('のだ。', "。")
    .replaceAll('なのだ。', "。")
    .replaceAll(/\s*\n\s*/g, "\n")
    .replaceAll(/\n{2,}/g, "\n\n")
    .replaceAll(/\s{2,}/g, " ")
    .replaceAll(/(^|\n)[、\s]+/g, "$1")

  result = result.trim()
  if (!result) return result
  // 先頭が句読点で始まる場合は削除
  result = result.replace(/^[、。．．]/, "")
  return enforcePoliteTone(result.trim())
}

function stripQuestionSentences(text) {
  if (!text) return ""
  const raw = String(text)
  const sentences = raw
    .split(/(?<=[。！？!？?])/)
    .map((s) => s.trim())
    .filter(Boolean)

  const filtered = sentences.filter((sentence) => {
    if (!sentence) return false
    if (/[？?]/.test(sentence)) return false
    if (/(どんな|どの|どう|何|なに|どれ|どこ|いつ|かな|かも|かしら|教えて|聞かせて)/.test(sentence)) {
      return false
    }
    return true
  })

  if (filtered.length > 0) {
    return filtered.join("").trim()
  }

  return raw.replaceAll(/[？?]/g, "。").replaceAll(/(かな|かも|かしら)/g, "だね")
}

export default handler
