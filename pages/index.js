import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },          // 0
  { label: '転職理由' },          // 1
  { label: '絶対希望（Must）' },  // 2
  { label: 'あったらいいな（Want）' }, // 3
  { label: 'これまで（Can）' },   // 4
  { label: 'これから（Will）' },  // 5
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
  const [candidateNumber, setCandidateNumber] = useState('') // サーバ互換名は維持
  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  // サマリー用セッション（APIから受領して反映）
  const [sessionData, setSessionData] = useState({
    candidateNumber: '',
    qualification: '',   // 所有資格タグに整合（未マッチは空、原文はサーバ側memoに保持）
    workplace: '',
    transferReason: '',  // タグ一致名（未マッチは空）
    mustConditions: [],  // タグ配列
    wantConditions: [],  // タグ配列
    canDo: '',           // 原文
    willDo: '',          // 原文
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
    } catch (e) {
      setMessages(m => [...m, { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' }])
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  // 表示ルール：
  // まだそのステップに到達していなければ「未入力」
  // そのステップを超えたら、値が空の場合だけ「済」
  const showStatus = (value, reached) => {
    if (!reached) return '未入力'
    if (Array.isArray(value)) return value.length ? value.join('／') : '済'
    return (value && value.trim && value.trim().length) ? value : '済'
  }

  // 各項目の到達判定
  const reached = {
    id: currentStep >= 0,
    qualification: currentStep >= 0,
    workplace: currentStep >= 0,
    transfer: currentStep >= 1,
    must: currentStep >= 2,
    want: currentStep >= 3,
    can: currentStep >= 4,
    will: currentStep >= 5,
  }

  return (
    <div className='min-h-screen gradient-bg text-slate-800'>
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </Head>

      <style jsx global>{`
        .gradient-bg { background: linear-gradient(135deg, #fdf2f8 0%, #faf5ff 50%, #eff6ff 100%); }
        .gradient-text { background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .message-enter { animation: slideIn 0.3s ease-out; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
      `}</style>

      <header className='bg-white/90 backdrop-blur-sm border-b border-pink-100 sticky top-0 z-10 shadow-sm'>
        <div className='max-w-4xl mx-auto px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div>
              <h1 className='text-2xl font-bold gradient-text'>HOAP AI エージェント</h1>
              <p className='text-slate-600 text-sm'>キャリア相談・一次ヒアリング</p>
            </div>
            <div className='text-right'>
              <div className='text-sm text-slate-500'>Step <span>{currentStep + 1}</span>/6</div>
              <div className='text-xs gradient-text font-medium'>
                <span>{steps[currentStep]?.label}</span>
                {!isNumberConfirmed && currentStep === 0 && (
                  <span className='block text-red-400 text-xs mt-1'>※求職者ID必須（メールに届いているID）</span>
                )}
              </div>
            </div>
          </div>

          {/* 進捗サマリー */}
          <div className='mt-3 text-xs text-slate-700'>
            <div className='grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1'>
              <div><span className='text-slate-500'>求職者ID：</span>{sessionData.candidateNumber || (reached.id ? '済' : '未入力')}</div>
              <div><span className='text-slate-500'>職種：</span>{showStatus(sessionData.qualification, reached.qualification)}</div>
              <div><span className='text-slate-500'>現職：</span>{showStatus(sessionData.workplace, reached.workplace)}</div>
              <div><span className='text-slate-500'>転職目的：</span>{showStatus(sessionData.transferReason, reached.transfer)}</div>
              <div><span className='text-slate-500'>Must：</span>{showStatus(sessionData.mustConditions, reached.must)}</div>
              <div><span className='text-slate-500'>Want：</span>{showStatus(sessionData.wantConditions, reached.want)}</div>
              <div><span className='text-slate-500'>Can：</span>{showStatus(sessionData.canDo, reached.can)}</div>
              <div><span className='text-slate-500'>Will：</span>{showStatus(sessionData.willDo, reached.will)}</div>
            </div>
          </div>

          {/* プログレスバー */}
          <div className='mt-4 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1'>
            <div
              className='bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500 shadow-sm'
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      <main className='max-w-4xl mx-auto px-6 py-8 pb-32'>
        <div ref={listRef} className='space-y-6'>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex max-w-xs lg:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${m.type === 'user' ? 'bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white shadow-md' : 'bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white'}`}>
                  {m.type === 'user' ? (
                    <svg width={18} height={18} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2}>
                      <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'></path>
                      <circle cx='12' cy='7' r='4'></circle>
                    </svg>
                  ) : (
                    <span className='text-xl'>🤖</span>
                  )}
                </div>
                <div className={`${m.type === 'user' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white ml-auto shadow-lg' : 'bg-white/90 backdrop-blur-sm text-slate-700 border border-pink-100/50'} rounded-2xl px-4 py-3 shadow-sm`}>
                  <div className='text-sm whitespace-pre-wrap leading-relaxed'>{m.content}</div>
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className='flex justify-start'>
              <div className='flex items-start gap-3'>
                <div className='flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white flex items-center justify-center'>
                  <span className='text-xl'>🤖</span>
                </div>
                <div className='bg-white/90 backdrop-blur-sm border border-pink-100/50 rounded-2xl px-4 py-3 shadow-sm'>
                  <div className='flex items-center gap-2 text-slate-500'>
                    <span className='animate-pulse'>●●●</span>
                    <span className='text-sm ml-2'>回答を準備中...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className='fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100/50 shadow-xl'>
        <div className='max-w-4xl mx-auto px-6 py-4'>
          <div className='flex items-end gap-3'>
            <div className='flex-1 relative'>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={!isNumberConfirmed && currentStep === 0 ? '求職者IDを入力してください（メールに届いているID）...' : 'メッセージを入力...'}
                className='w-full bg-white border border-pink-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[52px] max-h-32 shadow-sm'
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
              className='bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-600 hover:via-purple-600 hover:to-blue-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl p-3 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105'
            >
              <svg width={20} height={20} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2}>
                <line x1='22' y1='2' x2='11' y2='13'></line>
                <polygon points='22,2 15,22 11,13 2,9'></polygon>
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
