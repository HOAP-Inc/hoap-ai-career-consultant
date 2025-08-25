import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },                 // 0
  { label: '転職理由' },                 // 1
  { label: '絶対希望（Must）' },         // 2
  { label: 'あったらいいな（Want）' },   // 3
  { label: 'これまで（Can）' },          // 4
  { label: 'これから（Will）' },         // 5
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

  // サマリー（API反映）
  const [sessionData, setSessionData] = useState({
    candidateNumber: '',
    qualification: '',      // 所有資格タグ
    workplace: '',          // 原文
    transferReason: '',     // タグ
    mustConditions: [],     // タグ配列
    wantConditions: [],     // タグ配列
    canDo: '',
    willDo: '',
  })

  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onSend = async () => {
    if (!input.trim() || loading) return
    const outgoing = input.trim()
    setMessages(m => [...m, { type: 'user', content: outgoing }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing,
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

      if (data.sessionData && typeof data.sessionData === 'object') {
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
      } else if (typeof data.candidateNumber === 'string' && data.candidateNumber) {
        setSessionData(prev => ({ ...prev, candidateNumber: data.candidateNumber }))
      }
    } catch {
      setMessages(m => [...m, { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' }])
    } finally {
      setLoading(false)
    }
  }

  // —— 表示ルール（右側デザインに合わせて）——
  // ・ID/職種/勤務先/転職理由は「未入力 or 設定済」
  // ・Must/Wantは「n件」
  // ・Can/Willは非空なら「設定済」、空は「未入力」
  const statusText = (val) => (typeof val === 'string' ? (val.trim() ? '設定済' : '未入力') : '未入力')
  const reached = {
    id: true,
    qualification: currentStep >= 1,
    workplace:    currentStep >= 1,
    transfer:     currentStep >= 1,
    must:         currentStep >= 2,
    want:         currentStep >= 3,
    can:          currentStep >= 4,
    will:         currentStep >= 5,
  }

  const renderPill = (label, value, reachedFlag, mode='text') => {
    let content = '未入力'
    if (mode === 'text') {
      content = reachedFlag ? statusText(value) : '未入力'
    } else if (mode === 'count') {
      const n = Array.isArray(value) ? value.length : 0
      content = `${n}件`
    }
    return (
      <div className="pill">
        <span className="badge-dot" />
        <span className="label">{label}：</span>
        <span className="value">{content}</span>
      </div>
    )
  }

  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  return (
    <div className="min-h-screen gradient-bg text-slate-800">
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* ===== Header ===== */}
      <header className="bg-white/80 backdrop-blur-md border-b border-pink-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold gradient-text tracking-tight">HOAP AI エージェント</h1>
              <p className="text-slate-600 text-sm mt-1">一次ヒアリング（番号必須・タグ厳密整合）</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500">Step <span>{currentStep + 1}</span>/6</div>
              <div className="text-xs gradient-text font-semibold">
                {steps[currentStep]?.label}
              </div>
              {!isNumberConfirmed && currentStep === 0 && (
                <div className="text-xs text-pink-500 mt-1">※求職者ID必須（メールに届いているID）</div>
              )}
            </div>
          </div>

          {/* status row */}
          <div className="mt-3 flex flex-wrap gap-2">
            {renderPill('番号', sessionData.candidateNumber || '', true)}
            {renderPill('職種', sessionData.qualification, reached.qualification)}
            {renderPill('勤務先', sessionData.workplace, reached.workplace)}
            {renderPill('転職理由', sessionData.transferReason, reached.transfer)}
            {renderPill('Must', sessionData.mustConditions, reached.must, 'count')}
            {renderPill('Want', sessionData.wantConditions, reached.want, 'count')}
          </div>

          {/* progress */}
          <div className="mt-4 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1">
            <div className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      {/* ===== Chat ===== */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-40">
        <div ref={listRef} className="space-y-5 sm:space-y-6">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex max-w-[92%] sm:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${m.type === 'user'
                  ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white shadow'
                  : 'bg-white text-slate-700 border border-pink-100 shadow'}`}>
                  {m.type === 'user' ? '👤' : '🤖'}
                </div>
                <div className={`${m.type === 'user'
                  ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white'
                  : 'card text-slate-700'} rounded-2xl px-4 py-3 shadow`}>
                  <div className="text-[13px] sm:text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white border border-pink-100 shadow flex items-center justify-center">🤖</div>
                <div className="card rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <span className="animate-pulse">●●●</span><span>回答を準備中...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== Input ===== */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-pink-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <textarea
                value={input}
                onChange={(e)=>setInput(e.target.value)}
                placeholder={!isNumberConfirmed && currentStep === 0 ? '求職者IDを入力してください（メールに届いているID）...' : 'メッセージを入力...'}
                className="w-full bg-white border border-pink-200 rounded-2xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 min-h-[50px]"
                rows={1}
                onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); onSend() } }}
              />
            </div>
            <button
              onClick={onSend}
              disabled={loading}
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white rounded-2xl p-3 shadow hover:shadow-lg transition disabled:opacity-60"
              aria-label="送信"
            >
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22,2 15,22 11,13 2,9"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
