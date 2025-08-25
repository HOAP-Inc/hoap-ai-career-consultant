import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },
  { label: '転職理由' },
  { label: '絶対希望（Must）' },
  { label: 'あったらいいな（Want）' },
  { label: 'これまで（Can）' },
  { label: 'これから（Will）' },
]

export default function Home() {
  const [messages, setMessages] = useState([{
    type: 'ai',
    content:
`こんにちは！
担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。

最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。
IDが確認できたら、そのあとで
・今の職種（所有資格）
・今どこで働いてる？
も続けて聞いていくよ。気楽にどうぞ！`,
  }])

  const [currentStep, setCurrentStep] = useState(0)
  const [candidateNumber, setCandidateNumber] = useState('')
  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isComposing, setIsComposing] = useState(false)

  const [sessionData, setSessionData] = useState({
    candidateNumber: '',
    qualification: '',
    workplace: '',
    transferReason: '',
    mustConditions: [],
    wantConditions: [],
    canDo: '',
    willDo: '',
  })

  const scrollAreaRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    scrollAreaRef.current?.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' })
  }
  useEffect(() => { scrollToBottom() }, [messages, loading])

  const onSend = async () => {
    if (!input.trim() || loading || isComposing) return
    const outgoing = input.trim()
    setMessages(m => [...m, { type: 'user', content: outgoing }])
    setInput('')
    inputRef.current && (inputRef.current.value = '')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing,
          conversationHistory: messages,
          currentStep,
          candidateNumber,
          isNumberConfirmed,
          sessionId,
        }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      setMessages(m => [...m, { type: 'ai', content: data.response }])
      if (typeof data.step === 'number') setCurrentStep(data.step)
      if (typeof data.candidateNumber === 'string') setCandidateNumber(data.candidateNumber)
      if (typeof data.isNumberConfirmed === 'boolean') setIsNumberConfirmed(data.isNumberConfirmed)

      if (data.sessionData) {
        setSessionData(prev => ({
          ...prev,
          ...data.sessionData,
          mustConditions: Array.isArray(data.sessionData.mustConditions)
            ? Array.from(new Set(data.sessionData.mustConditions))
            : prev.mustConditions,
          wantConditions: Array.isArray(data.sessionData.wantConditions)
            ? Array.from(new Set(data.sessionData.wantConditions))
            : prev.wantConditions,
        }))
      }
    } catch {
      setMessages(m => [...m, { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' }])
    } finally {
      setLoading(false)
      setInput('')
      inputRef.current && (inputRef.current.value = '')
      scrollToBottom()
    }
  }

  const valStr = v => (typeof v === 'string' ? v.trim() : '')
  const badgeText = v => (valStr(v) ? '設定済' : '未入力')
  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  return (
    <div className="root">
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className="header">
        <div className="header-row">
          <div className="title">
            <div className="title-main">HOAP AI エージェント</div>
            <div className="title-sub">一次ヒアリング（番号必須・タグ厳密整合）</div>
          </div>
          <div className="step">
            <div className="step-line">Step <b>{currentStep + 1}</b>/6</div>
            <div className="step-label">{steps[currentStep]?.label}</div>
            {!isNumberConfirmed && currentStep === 0 &&
              <div className="step-note">※求職者ID必須（メールに届いているID）</div>}
          </div>
        </div>

        <div className="status">
          <div className="chip"><span className="dot"/>番号：{badgeText(sessionData.candidateNumber || candidateNumber)}</div>
          <div className="chip"><span className="dot"/>職種：{badgeText(sessionData.qualification)}</div>
          <div className="chip"><span className="dot"/>勤務先：{badgeText(sessionData.workplace)}</div>
          <div className="chip"><span className="dot"/>転職理由：{badgeText(sessionData.transferReason)}</div>
          <div className="chip"><span className="dot"/>Must：{Array.isArray(sessionData.mustConditions) ? sessionData.mustConditions.length : 0}件</div>
          <div className="chip"><span className="dot"/>Want：{Array.isArray(sessionData.wantConditions) ? sessionData.wantConditions.length : 0}件</div>
        </div>

        <div className="progress"><div className="bar" style={{ width: `${progress}%` }}/></div>
      </header>

      <main ref={scrollAreaRef} className="scroll">
        <div className="msg-wrap">
          {messages.map((m, i) => (
            <div key={i} className={`row ${m.type === 'user' ? 'right' : 'left'}`}>
              {m.type !== 'user' ? (
                <div className="avatar ai">🤖</div>
              ) : (
                <div className="avatar user">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
              )}
              <div className={`bubble ${m.type}`}>
                <div className="text">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="row left">
              <div className="avatar ai">🤖</div>
              <div className="bubble ai"><div className="text">●●● 回答を準備中…</div></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="footer">
        <div className="input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={!isNumberConfirmed && currentStep === 0
              ? '求職者IDを入力してください（メールに届いているID） ...'
              : 'メッセージを入力...'}
            className="textbox"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isComposing) { e.preventDefault(); onSend() }
            }}
          />
          <button className="send" onClick={onSend} disabled={loading} aria-label="送信">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9"></polygon>
            </svg>
          </button>
        </div>
      </footer>

      <style jsx>{`
        .root { height: 100vh; display: flex; flex-direction: column; }
        .header { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,.86); border-bottom: 1px solid rgba(236,72,153,.15); backdrop-filter: blur(8px); }
        .header-row { max-width: 1100px; margin: 0 auto; padding: 12px 16px 6px; display: flex; justify-content: space-between; gap: 12px; }
        .title-main { font-weight: 800; font-size: 24px; background: linear-gradient(135deg,#6366f1 0%,#a855f7 50%,#ec4899 100%); -webkit-background-clip: text; color: transparent; }
        .title-sub { font-size: 12px; color: #475569; margin-top: 2px; }
        .step { text-align: right; }
        .step-line { font-size: 12px; color: #64748b; }
        .step-label { font-size: 12px; font-weight: 700; background: linear-gradient(135deg,#6366f1 0%,#a855f7 50%,#ec4899 100%); -webkit-background-clip: text; color: transparent; }
        .step-note { color: #ec4899; font-size: 11px; margin-top: 2px; }
        .status { max-width: 1100px; margin: 0 auto; padding: 0 16px 10px; display: flex; flex-wrap: wrap; gap: 8px; }
        .chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: #fff; border: 1px solid rgba(236,72,153,.2); box-shadow: 0 1px 2px rgba(0,0,0,.04); font-size: 12px; color: #0f172a; }
        .dot { width: 6px; height: 6px; border-radius: 999px; background: #a78bfa; }
        .progress { max-width: 1100px; margin: 0 auto 6px; height: 6px; background: linear-gradient(90deg,#ffe4e6,#e0e7ff); border-radius: 999px; overflow: hidden; }
        .bar { height: 100%; background: linear-gradient(90deg,#ec4899,#a855f7,#3b82f6); }
        .scroll { flex: 1 1 auto; height: calc(100vh - 210px); overflow-y: auto; }
        .msg-wrap { max-width: 920px; margin: 14px auto; padding: 0 16px 12px; display: flex; flex-direction: column; gap: 14px; }
        .row { display: grid; grid-template-columns: 40px 1fr; align-items: start; gap: 10px; }
        .row.right { grid-template-columns: 1fr 40px; }
        .row.right .avatar { order: 2; }
        .row.right .bubble { order: 1; justify-self: end; }
        .avatar { width: 36px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
        .avatar.ai { background: linear-gradient(135deg,#f1f5f9,#e2e8f0); border: 1px solid #fff; }
        .avatar.user { background: linear-gradient(135deg,#ec4899,#a855f7,#3b82f6); color: #fff; box-shadow: 0 3px 10px rgba(0,0,0,.12); }
        .bubble { max-width: 92%; border-radius: 16px; padding: 12px 14px; box-shadow: 0 2px 8px rgba(0,0,0,.04); border: 1px solid rgba(236,72,153,.15); background: #fff; }
        .bubble.user { background: linear-gradient(135deg,#ffffff,#f8fafc); border: 1px solid rgba(59,130,246,.20); }
        .text { white-space: pre-wrap; line-height: 1.7; font-size: 14px; color: #0f172a; }
        .footer { position: sticky; bottom: 0; background: rgba(255,255,255,.92); border-top: 1px solid rgba(236,72,153,.15); backdrop-filter: blur(8px); }
        .input-row { max-width: 920px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: flex-end; gap: 10px; }
        .textbox { flex: 1 1 auto; resize: none; border: 1px solid #fecdd3; border-radius: 14px; padding: 12px 14px; font-size: 14px; outline: none; color: #0f172a; }
        .textbox:focus { border-color: #a78bfa; box-shadow: 0 0 0 2px #ddd6fe; }
        .send { border: 0; border-radius: 14px; padding: 10px 12px; background: linear-gradient(135deg,#ec4899,#a855f7,#3b82f6); color: #fff; box-shadow: 0 4px 10px rgba(0,0,0,.08); cursor: pointer; }
        .send:disabled { opacity: .6; cursor: not-allowed; }
        @media (max-width: 640px) {
          .scroll { height: calc(100vh - 220px); }
          .bubble { max-width: 100%; }
        }
      `}</style>
    </div>
  )
}
