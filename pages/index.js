// pages/index.js
import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const STEPS = [
  { key: 'basic', label: '基本情報' },      // Step0 (フロント強制)
  { key: 'reason', label: '転職理由' },     // Step1 (API制御)
  { key: 'must', label: '絶対条件' },      // Step2
  { key: 'want', label: 'あるといいな' },   // Step3
  { key: 'can', label: 'いままで' },       // Step4
  { key: 'will', label: 'これから' },      // Step5
]

export default function Home() {
  // 会話ログ
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
        'こんにちは！\n担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。\n\nいくつか質問をしていくね。\n担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！\n\nまずはじめに「求職者番号」を教えて！',
    },
  ])

  // 進行管理
  const [step, setStep] = useState(0) // 0..5
  const [phase, setPhase] = useState(0) // Step0専用: 0=番号→1=職種→2=勤務先

  // Step0で集めるデータ（UIヘッダ用）
  const [candidateNumber, setCandidateNumber] = useState('')
  const [qualification, setQualification] = useState('') // =職種は所有資格に準拠（入力は自由、最終はAPI側で整合）
  const [workplace, setWorkplace] = useState('')

  // セッション
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))

  // 入力欄
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [composing, setComposing] = useState(false) // IME中Enter送信防止

  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 送信
  const send = async () => {
    if (!input.trim() || loading) return

    // Step0 はフロントで強制進行
    if (step === 0) {
      const text = input.trim()
      setMessages((m) => [...m, { type: 'user', content: text }])
      setInput('')

      if (phase === 0) {
        const num = (text.match(/\d+/) || [])[0]
        if (!num) {
          setMessages((m) => [
            ...m,
            {
              type: 'ai',
              content: 'ごめん！最初に「求職者番号」を半角数字で教えて！',
            },
          ])
          return
        }
        setCandidateNumber(num)
        setMessages((m) => [
          ...m,
          { type: 'ai', content: `求職者番号：${num} だね！\n次は ②「今の職種」を教えて！` },
        ])
        setPhase(1)
        return
      }

      if (phase === 1) {
        setQualification(text)
        setMessages((m) => [
          ...m,
          { type: 'ai', content: `OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！` },
        ])
        setPhase(2)
        return
      }

      if (phase === 2) {
        setWorkplace(text)
        // Step1へ
        setStep(1)
        setMessages((m) => [
          ...m,
          {
            type: 'ai',
            content:
              'ありがとう！\n\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎',
          },
        ])
        return
      }

      return
    }

    // Step1〜5 はAPIへ
    try {
      setLoading(true)
      const text = input.trim()
      setMessages((m) => [...m, { type: 'user', content: text }])
      setInput('')

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          currentStep: step,
          candidate: {
            candidateNumber,
            qualification,
            workplace,
          },
          message: text,
          history: messages.slice(-10), // 直近でOK
        }),
      })
      const data = await res.json()

      // 返答
      setMessages((m) => [...m, { type: 'ai', content: data.reply }])

      // 進行
      if (typeof data.nextStep === 'number') setStep(data.nextStep)
      if (data.header) {
        if (data.header.mustCount != null) {
          // 将来、ヘッダに件数を映す時に使う想定
        }
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { type: 'ai', content: 'すまん、内部エラー。もう1回だけ送って！' },
      ])
    } finally {
      setLoading(false)
    }
  }

  // Enter送信の制御（IME中は送らない）
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      send()
    }
  }

  const progress = Math.round(((step + 1) / STEPS.length) * 100)

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 to-blue-50 text-slate-800">
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-pink-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-pink-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
                HOAP AI エージェント
              </h1>
              <p className="text-xs text-slate-500">キャリア相談・一次ヒアリング</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">
                Step {step + 1}/6 <span className="ml-1">{STEPS[step].label}</span>
              </div>
              <div className="mt-1 h-1 w-52 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-1 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* ステータス行 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <Badge label={`番号：${candidateNumber || '未入力'}`} />
            <Badge label={`職種：${qualification || '未入力'}`} />
            <Badge label={`勤務先：${workplace || '未入力'}`} />
            {/* Must/Want件数はAPI返り値で増やしていける */}
          </div>
        </div>
      </header>

      {/* Chat */}
      <main className="max-w-4xl mx-auto px-4 py-6 pb-28">
        <div ref={listRef} className="space-y-5">
          {messages.map((m, i) => (
            <Bubble key={i} type={m.type} text={m.content} />
          ))}
          {loading && <Bubble type="ai" text="…考え中（1〜2秒）" />}
        </div>
      </main>

      {/* Input */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-pink-100 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex gap-2">
            <textarea
              className="flex-1 resize-none min-h-[48px] max-h-32 rounded-xl border border-pink-200 px-3 py-3 focus:outline-none focus:ring-2 focus:ring-purple-400"
              placeholder={
                step === 0
                  ? phase === 0
                    ? '求職者番号（半角数字）'
                    : phase === 1
                    ? '今の職種'
                    : 'いま働いている場所（施設名や業態）'
                  : 'メッセージを入力…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
            <button
              onClick={send}
              disabled={loading}
              className="shrink-0 rounded-xl px-4 bg-gradient-to-r from-pink-600 via-purple-600 to-blue-600 text-white shadow hover:opacity-90"
            >
              送信
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Badge({ label }) {
  return (
    <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600">
      {label}
    </span>
  )
}

function Bubble({ type, text }) {
  const isUser = type === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow ${
          isUser
            ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white'
            : 'bg-white border border-pink-100 text-slate-800'
        }`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {text}
      </div>
    </div>
  )
}
