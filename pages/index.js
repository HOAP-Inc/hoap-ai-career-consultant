import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },
  { label: '転職理由' },
  { label: '絶対条件' },
  { label: '絶対NG' },
  { label: 'これまで' },
  { label: 'これから' },
]

export default function Home() {
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
        'こんにちは！\n担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。\n\nいくつか質問をしていくね。\n担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！\n\nまず3つ教えて！\n①求職者番号②今の職種③今どこで働いてる？',
    },
  ])
  const [currentStep, setCurrentStep] = useState(0)
  const [candidateNumber, setCandidateNumber] = useState('')
  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const listRef = useRef(null)

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onSend = async () => {
    if (!input.trim() || loading) return
    const outgoing = input.trim()
    setMessages((m) => [...m, { type: 'user', content: outgoing }])
    setInput('')
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
    } catch (e) {
      setMessages((m) => [
        ...m,
        { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

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
                  <span className='block text-red-400 text-xs mt-1'>※求職者番号必須</span>
                )}
              </div>
            </div>
          </div>
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
