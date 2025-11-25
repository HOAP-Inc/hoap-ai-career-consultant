import type { StatusMeta } from "./types"

// 定数定義
export const MAX_STEP = 6

export const HOAP_ANIMATION_IMAGES = [
  "/hoap-wide.png",
  "/hoap-skip.png",
  "/10.png",
  "/11.png",
  "/13.png",
  "/14.png",
]

export const STEP_INTRO_QUESTIONS: Record<number, string | { first: string; second: string }> = {
  2: {
    first: "これまでどんな職場でどんなことをしてきた？あなたの経歴を簡単でいいから教えてね。",
    second: "その経験の中で、あなたが得意だなと感じていることや、これからも活かしていきたい強みってどんなこと？"
  },
  3: "次は、今後挑戦したいこと、やってみたいことを教えて！『これができたらいいな』って思うことでOKだよ✨",
  4: "次は、働きたい事業形態や労働条件を教えて！たとえば『クリニックがいい』『夜勤は避けたい』みたいなイメージでOKだよ✨",
  5: "自分で自分ってどんなタイプの人間だと思う？周りからこんな人って言われる、っていうのでもいいよ！",
}

export const IMAGES_TO_PRELOAD = [
  "/hoap-basic.png",
  "/hoap-up.png",
  "/hoap-wide.png",
  "/hoap-skip.png",
  "/10.png",
  "/11.png",
  "/13.png",
  "/14.png",
]

// ステップ番号からラベルを返す
export function statusStepLabel(step: number): string {
  const map: Record<number, string> = {
    1: "資格",
    2: "Can",
    3: "Will",
    4: "Must",
    5: "私はこんな人",
    6: "AI分析",
  }
  return map[step] ?? ""
}

// ステータスバッジの表示内容を生成
export function getStatusRowDisplay(key: string, statusMeta: StatusMeta = {}): string {
  const formatIds = (ids: number[] | undefined) =>
    Array.isArray(ids) && ids.length > 0 ? ids.map((id) => `ID:${id}`).join("、") : ""

  switch (key) {
    case "AIの分析": {
      const hasAnalysis =
        Boolean(statusMeta.ai_analysis) ||
        Boolean(statusMeta.strength_text) ||
        Boolean(statusMeta.doing_text) ||
        Boolean(statusMeta.being_text)
      return hasAnalysis ? "済" : "未出力"
    }
    case "Can": {
      const hasCan =
        (Array.isArray(statusMeta.can_texts) && statusMeta.can_texts.length > 0) ||
        Boolean(statusMeta.can_text)
      return hasCan ? "済" : "未入力"
    }
    case "Must": {
      if (typeof statusMeta.status_bar === "string" && statusMeta.status_bar.trim()) {
        return statusMeta.status_bar
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .join("、")
      }
      const ids = [
        ...(statusMeta.must_have_ids || []),
        ...(statusMeta.ng_ids || []),
        ...(statusMeta.pending_ids || []),
      ]
      const value = formatIds(ids)
      return value || "未入力"
    }
    case "Will": {
      const hasWill =
        (Array.isArray(statusMeta.will_texts) && statusMeta.will_texts.length > 0) ||
        Boolean(statusMeta.will_text)
      return hasWill ? "済" : "未入力"
    }
    case "私はこんな人": {
      return statusMeta.self_text ? "済" : "未入力"
    }
    case "資格": {
      const value = formatIds(statusMeta.qual_ids) || formatIds(statusMeta.role_ids as number[] | undefined) || ""
      return value || "未入力"
    }
    default: {
      return "未入力"
    }
  }
}

// 選択肢が必要なステップかどうか
export function isChoiceStep(n: number): boolean {
  return n === 1 || n === 4
}

// 『［A］／［B］／［C］』形式から配列を作る
export function extractChoices(text: string | undefined): string[] {
  if (!text) return []
  const m = /『([^』]+)』/.exec(text)
  if (!m?.[1]) return []

  const inner = m[1].trim()
  // eslint-disable-next-line no-useless-escape
  const bracketRe = /[［\[]([^］\]]+)[］\]]/g
  const picks: string[] = []
  let mm
  while ((mm = bracketRe.exec(inner)) !== null) {
    const s = mm[1]?.trim()
    if (s) picks.push(s)
  }

  return picks
}

// 表記ゆれ正規化（() を全角に、空白を圧縮）
const normalizeChoiceKey = (s: string) => {
  return (s || "")
    .replaceAll("(", "（")
    .replaceAll(")", "）")
    .replaceAll(/\s+/g, " ")
    .trim()
}

// 正規化キーで一意化
export function uniqueByNormalized(array: string[]): string[] {
  const map = new Map<string, string>()
  for (const item of array || []) {
    const k = normalizeChoiceKey(item)
    if (!map.has(k)) map.set(k, item) // 先勝ち
  }
  return [...map.values()]
}

// Step4 の特定質問タイミングでは固定ボタンを出す
export function getInlineChoices(step: number, responseText: string): string[] {
  if (step === 4) {
    const t = responseText || ""
    // サーバの定型質問フレーズを検出（文言は現行そのまま）
    const hit = t.includes("一番ストレスだったのは、仕事内容・人間関係・労働時間のどれに近い？")
    if (hit) {
      return ["仕事内容", "人間関係", "労働時間"]
    }
  }
  return []
}

// フォーカス時にスクロールをロック
export function onFocusLock(): void {
  window.scrollTo(0, 0)
  document.body.style.height = "100dvh"
  document.body.style.overflow = "hidden"
}

// フォーカス解除時にスクロールをアンロック
export function onFocusUnlock(): void {
  document.body.style.height = ""
  document.body.style.overflow = ""
  window.scrollTo(0, 0)
}

