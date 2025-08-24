// pages/index.js
import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

const STEP_LABELS = ['基本情報', '転職理由', '絶対条件', 'あるといいな', 'いままで', 'これから']

export default function Home() {
  // ====== 状態 ======
  const [messages, setMessages] = useState([
  {
    type: 'ai',
    content:
      'こんにちは！\n担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。\n\nいくつか質問をしていくね。\n担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！\n\nまずは①求職者番号を教えて！（登録時のLINEに書いてあるよ）',
  },
])
  // Step0（基本情報）をフロントで強制制御
  // subStep: 0=番号, 1=職種, 2=勤務先
  const [currentStep, setCurrentStep] = useState(0)
  const [subStep, setSubStep] = useState(0)

  // 基本情報
  const [candidateNumber, setCandidateNumber] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [workplace, setWorkplace] = useState('')

  // 共通
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))

  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ====== 送信処理 ======
  const onSend = async () => {
    if (loading) return
    const text = input.trim()
    if (!text) return

    // 先にクリア（「送信後も文字が残る」対策）
    setInput('')

    // 画面にユーザー発言を追加
    setMessages((m) => [...m, { type: 'user', content: text }])

    // Step0 はフロントで決定的に分岐（番号→職種→勤務先）
    if (currentStep === 0) {
      if (subStep === 0) {
        setCandidateNumber(text)
        setMessages((m) => [
          ...m,
          {
            type: 'ai',
            content: '求職者番号：' + text + ' だね！\n次は ②「今の職種」を教えて！',
          },
        ])
        setSubStep(1)
        return
      }
      if (subStep === 1) {
        setJobTitle(text)
        setMessages((m) => [
          ...m,
          {
            type: 'ai',
            content:
              'OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！',
          },
        ])
        setSubStep(2)
        return
      }
      if (subStep === 2) {
        setWorkplace(text)
        // Step0 完了 → Step1 へ
        setMessages((m) => [
          ...m,
          {
            type: 'ai',
            content:
              'なるほど、ありがとう！\nここから本題いくよ。\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎',
          },
        ])
        setSubStep(0)
        setCurrentStep(1)
        return
      }
    }

    // Step1 以降は API へ
    try {
      setLoading(true)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages,
          currentStep,
          sessionId,
          // 基本情報を毎回渡す（サーバ側で利用可能）
          context: {
            candidateNumber,
            jobTitle,
            workplace,
          },
        }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      // AI 返答
      if (data?.response) {
        setMessages((m) => [...m, { type: 'ai', content: data.response }])
      }

      // ステップ更新（サーバ側が step を返す場合に追従）
      if (typeof data?.step === 'number') {
        setCurrentStep(data.step)
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          type: 'ai',
          content:
            'すみません、エラーが発生しました。もう一度お試しください。',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  // 進捗（6分割）
  const progress = Math.min(((currentStep + 1) / 6) * 100, 100)

  // ステータスバッジ表示用
  const badge = (label, value) => (
    <div className="px-3 py-1 rounded-full text-xs bg-white/70 backdrop-blur border border-slate-200 shadow-sm">
      <span className="text-slate-500 mr-1">{label}：</span>
      <span className={value ? 'font-semibold text-slate-900' : 'text-slate-400'}>
        {value || '未入力'}
      </span>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-violet-50 to-blue-50 text-slate-800">
      <Head>
        <title>HOAP AI エージェント</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* ヘッダー（ステータスバー） */}
      <header className="bg-white/90 backdrop-blur border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 bg-clip-text text-transparent">
                HOAP AI エージェント
              </h1>
              <p className="text-xs text-slate-500">キャリア相談・一次ヒアリング</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">
                Step <span className="font-semibold">{currentStep + 1}</span>/6
              </div>
              <div className="text-xs font-medium bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 bg-clip-text text-transparent">
                {STEP_LABELS[currentStep]}
              </div>
            </div>
          </div>

          {/* 進捗 */}
          <div className="mt-3 h-1.5 rounded-full bg-gradient-to-r from-pink-100 to-blue-100">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* バッジ列 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {badge('番号', candidateNumber)}
            {badge('職種', jobTitle)}
            {badge('勤務先', workplace)}
          </div>
        </div>
      </header>

      {/* メッセージリスト */}
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 pb-28">
        <div ref={listRef} className="space-y-5">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 shadow ${
                  m.type === 'user'
                    ? 'bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 text-white'
                    : 'bg-white border border-slate-100'
                }`}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {m.content}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 bg-white border border-slate-100 shadow">
                <div className="text-slate-500 text-sm">……考え中</div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* フッター入力 */}
      <footer className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  onSend()
                }
              }}
              placeholder={
                currentStep === 0
                  ? subStep === 0
                    ? '求職者番号を入力…'
                    : subStep === 1
                    ? '今の職種を入力…'
                    : 'いま働いている場所（施設名/業態）…'
                  : 'メッセージを入力…'
              }
              rows={1}
              className="flex-1 resize-none min-h-[52px] max-h-40 bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              onClick={onSend}
              disabled={loading}
              className="shrink-0 rounded-xl p-3 bg-gradient-to-r from-pink-500 via-violet-500 to-blue-500 text-white shadow hover:shadow-md hover:opacity-95 disabled:opacity-50"
              aria-label="送信"
              title="送信"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
