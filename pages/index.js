import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const STEP_LABELS = ['基本情報', '転職理由', '絶対条件', 'あるといいな', 'いままで', 'これから']

export default function Home() {
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
        'こんにちは！\n担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。\n\nいくつか質問をしていくね。\n担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！\n\nまずはじめに「求職者番号」を教えて！',
    },
  ])
  const [currentStep, setCurrentStep] = useState(0)
  const [candidateNumber, setCandidateNumber] = useState('')
  const [qualification, setQualification] = useState('')
  const [workplace, setWorkplace] = useState('')

  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))

  const listRef = useRef(null)
  const composingRef = useRef(false)

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addAI = (content) => setMessages((m) => [...m, { type: 'ai', content }])
  const addUser = (content) => setMessages((m) => [...m, { type: 'user', content }])

  // Step0（番号→職種→勤務先）をフロントで強制制御
  const step0Guard = async (text) => {
    if (!isNumberConfirmed) {
      const m = String(text).match(/\d{3,}/)
      if (!m) {
        addAI('ごめん！最初に「求職者番号」を数字で教えてね！')
        return true
      }
      const num = m[0]
      setCandidateNumber(num)
      setIsNumberConfirmed(true)
      addAI(`求職者番号：${num} だね！\n次は ②「今の職種」を教えて！`)
      return true
    }
    if (!qualification) {
      setQualification(String(text).trim())
      addAI('OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！')
      return true
    }
    if (!workplace) {
      setWorkplace(String(text).trim())
      addAI(
        'ありがとう！基本情報の入力が完了！\n\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎'
      )
      setCurrentStep(1)
      return true
    }
    return false
  }

  const onSend = async () => {
    const outgoing = input.trim()
    if (!outgoing || loading) return
    addUser(outgoing)
    setInput('')
    setLoading(true)
    try {
      const handled = await step0Guard(outgoing)
      if (handled) return
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing,
          conversationHistory: messages,
          currentStep,
          sessionId,
          basics: { candidateNumber, qualification, workplace },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'API error')
      addAI(data.response)
      if (typeof data.step === 'number') setCurrentStep(data.step)
    } catch (e) {
      addAI('すまん！内部エラー出た。もう一回だけ送って🙏')
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#fff7fb] via-[#fbf9ff] to-[#f5f9ff] text-slate-800">
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className="bg-white/90 backdrop-blur-sm border-b border-pink-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent">
                HOAP AI エージェント
              </h1>
              <p className="text-slate-600 text-xs">キャリア相談・一次ヒアリング</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Step <span>{currentStep + 1}</span>/6</div>
              <div className="text-xs bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent font-semibold">
                {STEP_LABELS[currentStep]}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <Badge label={`番号：${candidateNumber || '未入力'}`} />
            <Badge label={`職種：${qualification || '未入力'}`} />
            <Badge label={`勤務先：${workplace || '未入力'}`} />
            <Badge label={`転職理由：${currentStep >= 1 ? '処理中' : '未設定'}`} />
            <Badge label={`Must：0件`} />
            <Badge label={`Want：0件`} />
          </div>

          <div className="mt-3 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1">
            <div
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 pb-28">
        <div ref={listRef} className="space-y-6">
          {messages.map((m, i) => (
            <Bubble key={i} type={m.type} content={m.content} />
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/90 border border-pink-100/50 rounded-2xl px-4 py-3 shadow-sm">
                <span className="text-sm text-slate-500">…考え中</span>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100/50 shadow-xl">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="メッセージを入力…"
                className="w-full bg-white border border-pink-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[52px] max-h-32 shadow-sm"
                rows={1}
                onCompositionStart={() => (composingRef.current = true)}
                onCompositionEnd={() => (composingRef.current = false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (composingRef.current) return
                    e.preventDefault()
                    onSend()
                  }
                }}
              />
            </div>
            <button
              onClick={onSend}
              disabled={loading}
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-600 hover:via-purple-600 hover:to-blue-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl p-3 transition-all duration-200 shadow-lg hover:shadow-xl"
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

function Bubble({ type, content }) {
  const mine = type === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xs lg:max-w-2xl ${mine ? 'flex-row-reverse' : ''} flex items-start gap-3`}>
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center ${
            mine ? 'bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white' : 'bg-gray-100'
          }`}
        >
          {mine ? (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          ) : (
            <span>🤖</span>
          )}
        </div>
        <div
          className={`rounded-2xl px-4 py-3 shadow-sm ${
            mine
              ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white ml-auto shadow-lg'
              : 'bg-white/90 border border-pink-100/50 text-slate-800'
          }`}
        >
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>
        </div>
      </div>
    </div>
  )
}

function Badge({ label }) {
  return (
    <span className="inline-flex items-center rounded-full border border-pink-100 bg-white/90 px-2 py-1">
      <span className="text-xs text-slate-600">{label}</span>
    </span>
  )
}
