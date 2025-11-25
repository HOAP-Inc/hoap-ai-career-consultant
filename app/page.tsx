"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { StatusMeta } from "@/lib/types"
import {
  extractChoices,
  getInlineChoices,
  getStatusRowDisplay,
  HOAP_ANIMATION_IMAGES,
  IMAGES_TO_PRELOAD,
  isChoiceStep,
  MAX_STEP,
  onFocusLock,
  onFocusUnlock,
  statusStepLabel,
  uniqueByNormalized,
} from "@/lib/constants"

export default function ChatPage() {
  const [messages, setMessages] = useState<unknown[]>([])
  const [statusMeta, setStatusMeta] = useState<StatusMeta>({})
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))
  const [step, setStep] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const [aiText, setAiText] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [userEcho, setUserEcho] = useState("")
  const [choices, setChoices] = useState<string[]>([])
  const [showSummary, setShowSummary] = useState(false)
  const [summaryData, setSummaryData] = useState<string | null>(null)
  const [ctaHtml, setCtaHtml] = useState<string | null>(null)

  const cheeredIdReference = useRef(false)
  const cheeredMustReference = useRef(false)
  const cheeredSelfReference = useRef(false)
  const cheeredDoneReference = useRef(false)

  const listReference = useRef<HTMLElement>(null)
  const taReference = useRef<HTMLTextAreaElement>(null)
  const bottomReference = useRef<HTMLDivElement>(null)
  const messageTimersReference = useRef<NodeJS.Timeout[]>([])
  const [hoapSource, setHoapSource] = useState("/hoap-basic.png")
  const [isMouthOpen, setIsMouthOpen] = useState(false)
  const revertTimerReference = useRef<NodeJS.Timeout | null>(null)
  const typingAnimationTimerReference = useRef<NodeJS.Timeout | null>(null)
  const mouthIntervalReference = useRef<NodeJS.Timeout | null>(null)
  const lastAiTextReference = useRef<string>("")

  const progress = Math.min(100, Math.max(0, Math.round((Math.min(step, MAX_STEP) / MAX_STEP) * 100)))

  useEffect(() => {
    const imagesToPreload = IMAGES_TO_PRELOAD
    for (const source of imagesToPreload) {
      const img = new Image()
      img.src = source
    }
  }, [])

  useEffect(() => {
    if (step <= 1) {
      cheeredIdReference.current = false
      cheeredMustReference.current = false
      cheeredSelfReference.current = false
      cheeredDoneReference.current = false
    }
  }, [step])

  const clearMessageTimers = useCallback(() => {
    if (Array.isArray(messageTimersReference.current)) {
      for (const timerId of messageTimersReference.current) clearTimeout(timerId)
    }
    messageTimersReference.current = []
  }, [])

  const showAiSequence = useCallback((parts: string[], isInitial = false) => {
    clearMessageTimers()
    if (!Array.isArray(parts) || parts.length === 0) {
      setAiText("")
      setIsTyping(false)
      return
    }

    setAiText(parts[0] || "")
    setIsTyping(false)

    let delay = 0
    for (let index = 1; index < parts.length; index++) {
      const previous = parts[index - 1] || ""
      const previousLength = previous.length || 0
      const segmentDelay = isInitial
        ? Math.min(3000, 1000 + previousLength * 20)
        : Math.min(8000, 2600 + previousLength * 45)
      delay += segmentDelay
      const timerId = setTimeout(() => {
        setAiText(parts[index] || "")
      }, delay)
      messageTimersReference.current.push(timerId)
    }
  }, [clearMessageTimers])

  useEffect(() => {
    let aborted = false
    void (async () => {
      try {
        const res = await fetch("/api/chat", {
          body: JSON.stringify({ message: "", sessionId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
        const raw = await res.text()
        const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined
        if (aborted) return

        const responseParts = ((data?.response as string) || "").split("\n\n").filter(Boolean) as string[]
        if (responseParts.length === 0) {
          setAiText("")
        } else {
          showAiSequence(responseParts, true)
        }

        const next = ((data?.meta as Record<string, unknown>)?.step ?? 0) as number
        setStatusMeta((data?.status as StatusMeta) || {})
        setStep(next)

        const inline = extractChoices((data?.response as string) || "")
        setChoices(isChoiceStep(next) ? uniqueByNormalized(inline) : [])
      } catch {
        setMessages([{ content: "初期メッセージの取得に失敗したよ🙏", type: "ai" }])
      }
    })()
    return () => {
      aborted = true
    }
  }, [sessionId, showAiSequence, clearMessageTimers])

  useEffect(() => {
    if (isTyping) return // タイピング中はステップアニメーションを実行しない
    
    if (revertTimerReference.current) {
      clearTimeout(revertTimerReference.current)
      revertTimerReference.current = null
    }

    if (step >= 2 && !cheeredIdReference.current) {
      cheeredIdReference.current = true
      // 口パクを停止
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      setHoapSource("/hoap-up.png")
      revertTimerReference.current = setTimeout(() => {
        setHoapSource("/hoap-basic.png")
        revertTimerReference.current = null
      }, 2400)
      return
    }

    if (step >= 4 && !cheeredMustReference.current) {
      cheeredMustReference.current = true
      // 口パクを停止
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      setHoapSource("/hoap-up.png")
      revertTimerReference.current = setTimeout(() => {
        setHoapSource("/hoap-basic.png")
        revertTimerReference.current = null
      }, 2400)
      return
    }

    if (step >= 5 && !cheeredSelfReference.current) {
      cheeredSelfReference.current = true
      // 口パクを停止
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      setHoapSource("/hoap-up.png")
      revertTimerReference.current = setTimeout(() => {
        setHoapSource("/hoap-basic.png")
        revertTimerReference.current = null
      }, 2400)
      return
    }

    if (step >= 6 && !cheeredDoneReference.current) {
      cheeredDoneReference.current = true
      // 口パクを停止
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      setHoapSource("/hoap-up.png")
      revertTimerReference.current = setTimeout(() => {
        setHoapSource("/hoap-basic.png")
        revertTimerReference.current = null
      }, 2400)
    }
  }, [step, isTyping])

  // 吹き出し表示時：ベーシックポーズに設定（口パク用）
  useEffect(() => {
    if (!aiText) return
    
    // aiTextが新しい時だけ実行
    const isNewText = aiText !== lastAiTextReference.current
    if (!isNewText) return
    
    // ありがとう反応は除外
    if (aiText.includes("ありがとう") || aiText.includes("ありがと")) return
    
    // ベーシックポーズに設定（口パクが自然なため）
    setHoapSource("/hoap-basic.png")
  }, [aiText])

  // 口パクアニメーション: 吹き出し表示中かつ特定のポーズの時に口を開閉（オーバーレイの表示/非表示で制御）
  useEffect(() => {
    // aiTextが変わった時だけ実行（同じテキストなら何もしない）
    if (!aiText || aiText === lastAiTextReference.current) return
    lastAiTextReference.current = aiText
    
    // 口パク対象のポーズ（アルファベット順） - hoap-upは除外（既に口が開いているため）
    const talkingPoses = ["/hoap-basic.png", "/hoap-wide.png"]
    // 口パク対象のポーズの時のみ口パク
    const shouldAnimate = talkingPoses.includes(hoapSource)
    
    if (shouldAnimate) {
      // 既存の口パクタイマーをクリア
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      
      // 口を閉じた状態から開始
      setIsMouthOpen(false)
      
      mouthIntervalReference.current = setInterval(() => {
        setIsMouthOpen((prev) => !prev)
      }, 100) // 100msごとに口を開閉（倍速）
      
      // 1.5秒後に停止
      setTimeout(() => {
        if (mouthIntervalReference.current) {
          clearInterval(mouthIntervalReference.current)
          mouthIntervalReference.current = null
        }
        setIsMouthOpen(false)
        
        // 質問時のみ：口パク終了0.5秒後にランダムでポーズ変更
        const isQuestion = aiText.includes("？") || aiText.includes("?")
        if (isQuestion) {
          setTimeout(() => {
            if (revertTimerReference.current) {
              clearTimeout(revertTimerReference.current)
              revertTimerReference.current = null
            }
            
            const randomImage = HOAP_ANIMATION_IMAGES[Math.floor(Math.random() * HOAP_ANIMATION_IMAGES.length)]
            if (randomImage) {
              setHoapSource(randomImage)
              // 2秒後に元に戻す（停止）
              revertTimerReference.current = setTimeout(() => {
                setHoapSource("/hoap-basic.png")
                revertTimerReference.current = null
              }, 2000)
            }
          }, 500)
        }
      }, 1500)
    }
  }, [aiText, hoapSource])

  useEffect(() => {
    if (!aiText) return

    // ありがとう反応
    if (aiText.includes("ありがとう") || aiText.includes("ありがと")) {
      if (hoapSource === "/hoap-up.png") return // 既にhoap-upなら何もしない
      
      if (revertTimerReference.current) {
        clearTimeout(revertTimerReference.current)
        revertTimerReference.current = null
      }
      // 口パクを停止
      if (mouthIntervalReference.current) {
        clearInterval(mouthIntervalReference.current)
        mouthIntervalReference.current = null
      }
      setHoapSource("/hoap-up.png")
      revertTimerReference.current = setTimeout(() => {
        setHoapSource("/hoap-basic.png")
        revertTimerReference.current = null
      }, 2400)
      return
    }
  }, [aiText, hoapSource, isTyping])

  useEffect(() => {
    if (isTyping) {
      typingAnimationTimerReference.current = setTimeout(() => {
        const randomPoses = ["/hoap-skip.png", "/hoap-wide.png", "/hoap-up.png"]
        const randomPose = randomPoses[Math.floor(Math.random() * randomPoses.length)]

        if (randomPose) {
          setHoapSource(randomPose)

          setTimeout(() => {
            setHoapSource("/hoap-basic.png")
          }, 800)
        }
      }, 3000)
    } else {
      if (typingAnimationTimerReference.current) {
        clearTimeout(typingAnimationTimerReference.current)
        typingAnimationTimerReference.current = null
      }
    }

    return () => {
      if (typingAnimationTimerReference.current) {
        clearTimeout(typingAnimationTimerReference.current)
        typingAnimationTimerReference.current = null
      }
    }
  }, [isTyping])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const syncKB = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty("--kb", `${kb}px`)
    }
    syncKB()
    vv.addEventListener("resize", syncKB)
    vv.addEventListener("scroll", syncKB)
    return () => {
      vv.removeEventListener("resize", syncKB)
      vv.removeEventListener("scroll", syncKB)
    }
  }, [])

  useLayoutEffect(() => {
    const element = bottomReference.current
    if (element) element.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length, step])

  async function onSend(forcedText?: unknown) {
    if (taReference.current && window.innerWidth <= 640) {
      taReference.current.blur()
    }

    if (
      forcedText &&
      typeof forcedText === "object" &&
      ("nativeEvent" in forcedText || "preventDefault" in forcedText || "type" in forcedText)
    ) {
      forcedText = undefined
    }
    if (sending) return
    const text = forcedText === undefined ? input.trim() : (forcedText as string)
    if (!text && step !== 6) return

    setSending(true)

    const userText = text
    setUserEcho(userText)
    if (forcedText === undefined) setInput("")

    setIsTyping(true)
    clearMessageTimers()
    setAiText("")

    try {
      const res = await fetch("/api/chat", {
        body: JSON.stringify({ message: userText, sessionId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })

      const raw = await res.text()
      let data: Record<string, unknown> | undefined
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined
      } catch {
        data = undefined
      }

      if (!res.ok || !data) {
        const statusLine = `サーバ応答: ${res.status}`
        const bodyLine = raw ? `本文: ${raw.slice(0, 200)}` : "本文なし"
        showAiSequence([`${statusLine}\n${bodyLine}`])
        setIsTyping(false)
        return
      }

      const responseParts = ((data.response as string) || "").split("\n\n").filter(Boolean) as string[]

      const meta = data.meta as Record<string, unknown> | undefined
      if (meta?.show_summary_after_delay && meta?.summary_data) {
        const finalParts = ((data.response as string) || "").split("\n\n").filter(Boolean) as string[]

        if (finalParts.length > 0) {
          showAiSequence(finalParts)
          setIsTyping(false)

          let accumulatedDelay = 0
          for (let index = 1; index < finalParts.length; index++) {
            const previous = finalParts[index - 1] || ""
            const previousLength = previous.length || 0
            const segmentDelay = Math.min(8000, 2600 + previousLength * 45)
            accumulatedDelay += segmentDelay
          }
          const lastPart = finalParts.at(-1) || ""
          const lastReadTime = Math.min(9000, 3200 + (lastPart.length || 0) * 45)
          const sheetDelay = Math.max(5000, accumulatedDelay + lastReadTime)
          setTimeout(() => {
            setSummaryData((meta?.summary_data as string) || null)
            setCtaHtml((meta?.cta_html as string) || null)
            setShowSummary(true)
          }, sheetDelay)
        } else {
          showAiSequence([(data.response as string) || ""])
          setIsTyping(false)
          setTimeout(() => {
            setSummaryData((meta?.summary_data as string) || null)
            setCtaHtml((meta?.cta_html as string) || null)
            setShowSummary(true)
          }, (meta?.show_summary_after_delay as number) || 5000)
        }
      } else if (responseParts.length === 0 || !data.response || (data.response as string).trim() === "") {
        showAiSequence(["（応答を処理中...）"])
        setIsTyping(false)
        console.warn("[Frontend] Empty response received from server")
      } else if (responseParts.length === 1) {
        showAiSequence([responseParts[0]])
        setIsTyping(false)
      } else {
        showAiSequence(responseParts)
        setIsTyping(false)
      }

      const nextStep = (meta?.step !== undefined ? (meta.step as number) : step)

      setStatusMeta((data.status as StatusMeta) || {})
      setStep(nextStep)

      const drill = data.drill as Record<string, unknown> | undefined
      const serverOptions = (Array.isArray(drill?.options) ? drill.options : []) as string[]
      const inline = getInlineChoices(nextStep, (data.response as string) || "")
      const extracted = extractChoices((data.response as string) || "")
      const choiceCandidates =
        serverOptions.length > 0
          ? serverOptions
          : inline.length > 0
            ? inline
            : extracted
      setChoices(
        isChoiceStep(nextStep)
          ? uniqueByNormalized(choiceCandidates)
          : []
      )
    } catch (error) {
      console.error(error)
      showAiSequence(["通信エラーが発生したよ🙏"])
      setIsTyping(false)
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !isComposing && !e.shiftKey) {
      e.preventDefault()
      void onSend()
    }
  }

  useEffect(() => {
    return () => {
      if (revertTimerReference.current) {
        clearTimeout(revertTimerReference.current)
        revertTimerReference.current = null
      }
      clearMessageTimers()
    }
  }, [clearMessageTimers])

  const showChoices = isChoiceStep(step) && choices.length > 0 && !isTyping

  return (
    <div className="container">
      <header className="header">
        <div className="title">
          <div>AIキャリアデザイナー</div>
          <div>ほーぷちゃん</div>
        </div>
        <div className="step">
          Step {step}/{MAX_STEP} {statusStepLabel(step)}
        </div>
      </header>

      {step === 6 && showSummary ? (
        <div className="status-progress" style={{ position: "relative" }}>
          <div
            style={{
              color: "#ec4899",
              fontSize: "14px",
              fontWeight: "bold",
              left: "50%",
              position: "absolute",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1,
            }}
          >
            分析中...
          </div>
          <div
            className="status-progress__inner"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : step <= 6 ? (
        <div className="status-progress">
          <div
            className="status-progress__inner"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {!showSummary && (
        <div className="status-row">
          {[
            "資格",
            "Can",
            "Will",
            "Must",
            "私はこんな人",
            "AIの分析",
          ].map((k) => {
            const displayValue = getStatusRowDisplay(k, statusMeta)
            return (
              <span className="badge" key={k}>
                {k}：{displayValue}
              </span>
            )
          })}
        </div>
      )}

      <section className="duo-stage">
        <div className="duo-stage__bg" />
        <div className="duo-stage__wrap">
          <div className="duo-stage__hoap-container">
            {/* ベース画像（常に表示） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="ほーぷちゃん" className="duo-stage__hoap" src={hoapSource} />
            {/* 口パク用のオーバーレイ（ベーシックポーズのみ） */}
            {aiText && hoapSource === "/hoap-basic.png" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img 
                alt="" 
                className="duo-stage__hoap duo-stage__hoap-mouth" 
                src="/hoap-wide.png"
                style={{
                  clipPath: 'ellipse(5% 2.5% at 50% 42.5%)',
                  opacity: isMouthOpen ? 1 : 0,
                  transition: 'opacity 0.05s ease-in-out',
                }}
              />
            )}
          </div>
          <div className="duo-stage__bubbles-container">
            {isTyping ? (
              <div aria-live="polite" className="duo-stage__bubble typing">
                <span className="dots">
                  <span>・</span>
                  <span>・</span>
                  <span>・</span>
                </span>
              </div>
            ) : showChoices ? (
              <div aria-live="polite" className="duo-stage__bubble">
                下のボタンから選んでね！
              </div>
            ) : aiText ? (
              <div aria-live="polite" className="duo-stage__bubble">
                {aiText}
              </div>
            ) : (
              <div aria-live="polite" className="duo-stage__bubble">
                …
              </div>
            )}
          </div>
        </div>
      </section>

      {isChoiceStep(step) && choices.length > 0 && !isTyping && (
        <div className="choice-wrap">
          {choices.map((c) => (
            <button
              className="choice-btn"
              key={c}
              onClick={() => {
                void onSend(c)
                setChoices([])
              }}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {showSummary && summaryData && (
        <div
          className="summary-modal-overlay"
          style={{
            alignItems: "center",
            animation: "fadeIn 0.3s ease-out",
            backdropFilter: "blur(8px)",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            left: 0,
            overflow: "auto",
            padding: "20px",
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 1000,
          }}
        >
          <div
            className="summary-modal-container"
            style={{
              background: "linear-gradient(135deg, #fdf2f8 0%, #f5f3ff 50%, #eff6ff 100%)",
              border: "1px solid rgba(236, 72, 153, 0.1)",
              borderRadius: "24px",
              boxShadow: "0 25px 80px rgba(236, 72, 153, 0.15), 0 10px 40px rgba(0, 0, 0, 0.1)",
              maxHeight: "95vh",
              maxWidth: "1400px",
              overflow: "auto",
              padding: "clamp(20px, 4vw, 40px)",
              position: "relative",
              width: "100%",
            }}
          >
            <button
              className="summary-modal-btn"
              onClick={() => {
                setShowSummary(false)
                setSummaryData(null)
                setCtaHtml(null)
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.1) rotate(90deg)"
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(236, 72, 153, 0.4)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1) rotate(0deg)"
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(236, 72, 153, 0.3)"
              }}
              style={{
                alignItems: "center",
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                border: "none",
                borderRadius: "50%",
                boxShadow: "0 4px 12px rgba(236, 72, 153, 0.3)",
                color: "white",
                cursor: "pointer",
                display: "flex",
                fontSize: "24px",
                fontWeight: 300,
                height: "44px",
                justifyContent: "center",
                position: "absolute",
                right: "20px",
                top: "20px",
                transition: "all 0.2s ease",
                width: "44px",
                zIndex: 10,
              }}
            >
              ×
            </button>

            <div
              className="summary-modal-title"
              style={{
                marginBottom: "clamp(16px, 3vw, 24px)",
                textAlign: "center",
              }}
            >
              <h2
                style={{
                  background: "linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)",
                  backgroundClip: "text",
                  color: "transparent",
                  fontSize: "clamp(24px, 5vw, 36px)",
                  fontWeight: 900,
                  letterSpacing: "0.02em",
                  margin: 0,
                  marginBottom: "0",
                  WebkitBackgroundClip: "text",
                }}
              >
                Your Unique Career Profile
              </h2>
            </div>

            {ctaHtml && (
              <div dangerouslySetInnerHTML={{ __html: ctaHtml }} style={{ marginBottom: "clamp(24px, 4vw, 40px)", textAlign: "center" }} />
            )}

            <div className="summary-html" dangerouslySetInnerHTML={{ __html: summaryData }} />

            <div
              className="summary-modal-footer"
              style={{
                borderTop: "1px solid rgba(236, 72, 153, 0.1)",
                marginTop: "clamp(24px, 4vw, 32px)",
                paddingTop: "20px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  color: "#9ca3af",
                  fontSize: "12px",
                  fontWeight: 500,
                  margin: 0,
                }}
              >
                Created with 💛 by ほーぷちゃん
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="chat" ref={listReference} />
      <div ref={bottomReference} />

      {userEcho && (
        <div aria-live="polite" className="user-echo">
          <div className="user-echo__bubble">{userEcho}</div>
        </div>
      )}

      <footer className="input-bar">
        <div className="input-inner">
          <textarea
            autoComplete="off"
            className="textarea"
            onBlur={() => {
              setIsComposing(false)
              onFocusUnlock()
            }}
            onChange={(e) => {
              setInput(e.target.value)
            }}
            onCompositionEnd={() => setIsComposing(false)}
            onCompositionStart={() => setIsComposing(true)}
            onFocus={onFocusLock}
            onKeyDown={onKeyDown}
            placeholder={
              step === 1
                ? "お持ちの資格名を入力してください（例：正看護師、准看護師、介護福祉士…）"
                : "メッセージを入力…"
            }
            ref={taReference}
            value={input}
          />
          <button
            className="send"
            disabled={sending}
            onClick={() => void onSend()}
            type="button"
          >
            ➤
          </button>
      </div>
      </footer>
    </div>
  )
}
