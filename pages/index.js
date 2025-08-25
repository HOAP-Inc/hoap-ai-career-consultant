// pages/index.js
import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },
  { label: '転職理由' },
  { label: 'Must' },
  { label: 'Want' },
  { label: 'Can' },
  { label: 'Will' },
]

export default function Home() {
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
        'こんにちは！\n担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。\n\n最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！',
    },
  ])
  const [currentStep, setCurrentStep] = useState(0)
  const [candidateNumber, setCandidateNumber] = useState('')
  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isComposing, setIsComposing] = useState(false)

  const listRef = useRef(null)
  const textareaRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
    return () => clearTimeout(t)
  }, [messages, loading])

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = '0px'
    const h = Math.min(textareaRef.current.scrollHeight, 160)
    textareaRef.current.style.height = h + 'px'
  }, [input])

  const onSend = async () => {
    if (loading || !input.trim() || isComposing) return
    const outgoing = input.trim()
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.blur()
      textareaRef.current.style.height = '0px'
    }
    setMessages((m) => [...m, { type: 'user', content: outgoing }])
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
      setMessages((m) => {
        const next = [...m, { type: 'ai', content: data.response }]
        if (next.length >= 2) {
          const last = next[next.length - 1].content?.trim()
          const prev = next[next.length - 2].content?.trim()
          if (last && prev && last === prev) next.pop()
        }
        return next
      })
      if (typeof data.step === 'number') setCurrentStep(data.step)
      if (typeof data.candidateNumber === 'string') setCandidateNumber(data.candidateNumber)
      if (typeof data.isNumberConfirmed === 'boolean') setIsNumberConfirmed(data.isNumberConfirmed)
    } catch {
      setMessages((m) => [...m, { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' }])
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  return (
    <div className="min-h-screen gradient-bg text-slate-800">
      <Head>
        <title>ほーぷちゃん</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx global>{`
        .gradient-bg {
          background: radial-gradient(1200px 600px at 20% 0%,
              rgba(255, 192, 203, 0.25),
              transparent 60%),
            radial-gradient(1200px 600px at 80% 0%,
              rgba(173, 216, 230, 0.25),
              transparent 60%),
            #fafafa;
        }
        .gradient-text {
          background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 50%, #06b6d4 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .message-enter { animation: slideIn 0.25s ease-out; }
        @keyframes slideIn { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:translateY(0);} }
      `}</style>

      <header className="bg-white/90 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold gradient-text">ほーぷちゃん</h1>
              <span className="text-slate-500 text-sm">一次ヒアリング（番号必須・タグ厳密整合）</span>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500">Step <span>{currentStep + 1}</span>/6</div>
              <div className="text-xs gradient-text font-medium">{steps[currentStep]?.label}</div>
            </div>
          </div>
          <div className="mt-4 bg-gradient-to-r from-violet-100 via-pink-100 to-cyan-100 rounded-full h-1">
            <div className="bg-gradient-to-r from-violet-500 via-pink-500 to-cyan-500 h-1 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {[
              ['番号', candidateNumber ? '設定済' : '未入力'],
              ['職種', '未入力'],
              ['勤務先', '未入力'],
              ['転職理由', '未入力'],
              ['Must', '0件'],
              ['Want', '0件'],
              ['Can', '未入力'],
              ['Will', '未入力'],
            ].map(([k, v]) => (
              <span key={k} className="px-3 py-1 rounded-full border bg-white/80 text-slate-700">
                <b>{k}</b>：{v}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6 pb-[88px]" ref={listRef}>
        <div className="space-y-6">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex max-w-xs lg:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${m.type === 'user'
                    ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white shadow-md'
                    : 'bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white'}`}>
                  {m.type === 'user' ? <span className="text-xl">👤</span> : <span className="text-xl">🤖</span>}
                </div>
                <div className={`${m.type === 'user'
                      ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white ml-auto shadow-lg'
                      : 'bg-white/90 backdrop-blur-sm text-slate-700 border border-pink-100/50'
                    } rounded-2xl px-4 py-3`}>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              </div>
            </div>
          ))}
          {/* ローディング表示は非表示にする */}
          {loading && <div aria-hidden className="h-0" />}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-5 py-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={!isNumberConfirmed && currentStep === 0
                  ? '求職者IDを入力してください（メールに届いているID）…'
                  : 'メッセージを入力…'}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[48px] max-h-40"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
              />
            </div>
            <button
              onClick={onSend}
              disabled={loading}
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white rounded-xl p-3 shadow-md transition"
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
