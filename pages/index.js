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
    candidateNumber: '', qualification:'', workplace:'', transferReason:'',
    mustConditions:[], wantConditions:[], canDo:'', willDo:''
  })

  const listRef = useRef(null)
  const inputRef = useRef(null)

  // ---- 常に最下部へスクロール（ウィンドウ＆リスト両方） ----
  const scrollToBottom = () => {
    try {
      listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      // 次のフレームでブラウザ全体もスクロール
      setTimeout(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
      }, 0)
    } catch {}
  }
  useEffect(() => { scrollToBottom() }, [messages])

  const onSend = async () => {
    if (!input.trim() || loading || isComposing) return
    const outgoing = input.trim()

    // 先にUI更新
    setMessages((m) => [...m, { type: 'user', content: outgoing }])
    setInput('')
    if (inputRef.current) inputRef.current.value = '' // テキストエリア強制クリア
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

      setMessages((m) => [...m, { type: 'ai', content: data.response }])

      if (typeof data.step === 'number') setCurrentStep(data.step)
      if (typeof data.candidateNumber === 'string') setCandidateNumber(data.candidateNumber)
      if (typeof data.isNumberConfirmed === 'boolean') setIsNumberConfirmed(data.isNumberConfirmed)
      if (data.sessionData) {
        setSessionData((prev) => ({
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
    } catch (e) {
      setMessages((m) => [
        ...m,
        { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' },
      ])
    } finally {
      setLoading(false)
      setInput('')
      if (inputRef.current) inputRef.current.value = ''
      scrollToBottom()
    }
  }

  const statusText = (v) => (typeof v === 'string' ? (v.trim() ? '設定済' : '未入力') : '未入力')
  const reached = {
    id: true,
    qualification: currentStep >= 1,
    workplace: currentStep >= 1,
    transfer: currentStep >= 1,
    must: currentStep >= 2,
    want: currentStep >= 3,
    can: currentStep >= 4,
    will: currentStep >= 5,
  }
  const pill = (label, val, flag, mode='text') => {
    const txt = mode==='count' ? `${Array.isArray(val)?val.length:0}件` : (flag?statusText(val):'未入力')
    return (
      <div className="pill">
        <span className="badge-dot"/>
        <span className="label">{label}：</span>
        <span>{txt}</span>
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

      <style jsx global>{`
        .gradient-bg { background: linear-gradient(135deg, #fdf2f8 0%, #faf5ff 50%, #eff6ff 100%); }
        .gradient-text { background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .card { background: rgba(255,255,255,.9); border: 1px solid rgba(236,72,153,.15); backdrop-filter: blur(8px); }
        .pill { display:inline-flex; align-items:center; gap:.25rem; padding:.25rem .5rem; border-radius:9999px; background:#fff; border:1px solid rgba(236,72,153,.2); box-shadow:0 1px 2px rgba(0,0,0,.04)}
        .badge-dot { width:.4rem; height:.4rem; border-radius:9999px; background:#a78bfa }
        .message-enter { animation: slideIn .25s ease-out; }
        @keyframes slideIn { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }
        html, body { height: auto; overflow-y: auto; }
      `}</style>

      <header className="bg-white/80 backdrop-blur-md border-b border-pink-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold gradient-text tracking-tight">HOAP AI エージェント</h1>
              <p className="text-slate-600 text-sm mt-1">一次ヒアリング（番号必須・タグ厳密整合）</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500">Step <span>{currentStep + 1}</span>/6</div>
              <div className="text-xs font-semibold gradient-text">{steps[currentStep]?.label}</div>
              {!isNumberConfirmed && currentStep === 0 && (
                <div className="text-xs text-pink-500 mt-1">※求職者ID必須（メールに届いているID）</div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {pill('番号', sessionData.candidateNumber || '', true)}
            {pill('職種', sessionData.qualification, reached.qualification)}
            {pill('勤務先', sessionData.workplace, reached.workplace)}
            {pill('転職理由', sessionData.transferReason, reached.transfer)}
            {pill('Must', sessionData.mustConditions, reached.must, 'count')}
            {pill('Want', sessionData.wantConditions, reached.want, 'count')}
          </div>

          <div className="mt-4 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1">
            <div className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      {/* フッターと被らないように pb-56 で余白を確保 */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-56">
        <div ref={listRef} className="space-y-5 sm:space-y-6">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex max-w-[92%] sm:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${m.type === 'user' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white shadow' : 'bg-white text-slate-700 border border-pink-100 shadow'}`}>{m.type === 'user' ? '👤' : '🤖'}</div>
                <div className={`${m.type === 'user' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white' : 'card text-slate-700'} rounded-2xl px-4 py-3 shadow`}>
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
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><span className="animate-pulse">●●●</span><span>回答を準備中...</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-pink-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={!isNumberConfirmed && currentStep === 0 ? '求職者IDを入力してください（メールに届いているID）...' : 'メッセージを入力...'}
                className="w-full bg-white border border-pink-200 rounded-2xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 min-h-[50px]"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                    e.preventDefault()
                    onSend()
                  }
                }}
              />
            </div>
            <button
              onClick={onSend}
              disabled={loading}
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white rounded-2xl p-3 shadow hover:shadow-lg transition disabled:opacity-60"
              aria-label="送信"
            >
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22,2 15,22 11,13 2,9"></polygon></svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
