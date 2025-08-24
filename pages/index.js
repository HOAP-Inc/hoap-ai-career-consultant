import { useEffect, useState, useRef } from 'react'
import Head from 'next/head'

const steps = [
  { label: '基本情報' },
  { label: '転職理由' },
  { label: '絶対条件' },
  { label: '絶対NG' },
  { label: 'これまで' },
  { label: 'これから' },
]

// ステータス用チップ
function StatusChip({ label, value, ok }) {
  return (
    <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border shadow-sm select-none
      bg-white/80 border-pink-100 text-slate-700">
      <span className="text-slate-400">{label}：</span>
      <span className={`${ok ? 'font-medium text-slate-800' : 'text-slate-400'}`}>{value}</span>
    </div>
  )
}

export default function Home() {
  // ====== 会話・UI状態 ======
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
`こんにちは！
担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。

いくつか質問をしていくね。
担当エージェントとの面談でしっかりヒアリングするから、今日は自分の転職について改めて整理する感じで、気楽に話してね！

まずはじめに「求職者番号」を教えて！`,
    },
  ])
  const [currentStep, setCurrentStep] = useState(0) // 0=基本情報（フロント固定制御）
  const [candidateNumber, setCandidateNumber] = useState('')
  const [qualification, setQualification] = useState('')   // ②今の職種
  const [workplace, setWorkplace] = useState('')           // ③今どこで働いてる？
  const [transferReason, setTransferReason] = useState('')
  const [mustCount, setMustCount] = useState(0)
  const [wantCount, setWantCount] = useState(0)

  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)
  const [input, setInput] = useState('')   // ← state 管理に統一
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))

  // ====== スクロール追従 ======
  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // ====== ユーティリティ ======
  const addAI = (text) => setMessages((m) => [...m, { type: 'ai', content: text }])
  const addUser = (text) => setMessages((m) => [...m, { type: 'user', content: text }])

  // ====== 送信 ======
  const onSend = async () => {
    const outgoing = input.trim()
    if (!outgoing || loading) return

    addUser(outgoing)
    setInput('')        // ← クリアはこれだけ
    setLoading(true)

    try {
      // ---- Step0 はフロントで厳密制御（1個ずつ） ----
      if (currentStep === 0) {
        // ①求職者番号 未確定
        if (!isNumberConfirmed) {
          const num = (outgoing.match(/\d+/) || [])[0]
          if (!num) {
            addAI(`ごめん！最初に「求職者番号」を数字で教えてね。`)
            setLoading(false)
            return
          }
          setCandidateNumber(num)
          setIsNumberConfirmed(true)
          addAI(`求職者番号：${num} だね！\n次は ②「今の職種」を教えて！`)
          setLoading(false)
          return
        }

        // ②今の職種 未入力
        if (!qualification) {
          setQualification(outgoing)
          addAI(`OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！`)
          setLoading(false)
          return
        }

        // ③今どこで働いてる？ 未入力
        if (!workplace) {
          setWorkplace(outgoing)

          // 未入力があればブロック（保険）
          if (!candidateNumber || !qualification || !outgoing) {
            addAI(`まだ未入力があるよ。番号・職種・勤務先の3つを順番に埋めよう！`)
            setLoading(false)
            return
          }

          // ここで初めてサーバーへ（Step1開始）
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: '基本情報の入力が完了しました。',
              conversationHistory: messages.concat({ type: 'user', content: outgoing }),
              currentStep: 0,
              candidateNumber,
              isNumberConfirmed: true,
              sessionId,
            }),
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          addAI(
            data.response ||
            `ありがとう！\nはじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？`
          )
          if (typeof data.step === 'number') setCurrentStep(data.step) // 通常は1に遷移

          // 以降の画面用にセッション受け取り
          if (data.sessionData) {
            const s = data.sessionData
            if (Array.isArray(s.mustConditions)) setMustCount(s.mustConditions.length)
            if (Array.isArray(s.wantConditions)) setWantCount(s.wantConditions.length)
          }
          setLoading(false)
          return
        }

        setLoading(false)
        return
      }

      // ---- Step1以降はサーバー制御 ----
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

      addAI(data.response)

      if (typeof data.step === 'number') setCurrentStep(data.step)

      if (data.sessionData) {
        const s = data.sessionData
        if (s.candidateNumber) { setCandidateNumber(s.candidateNumber); setIsNumberConfirmed(true) }
        if (s.qualification) setQualification(s.qualification)
        if (s.workplace) setWorkplace(s.workplace)
        if (s.transferReason) setTransferReason(s.transferReason)
        if (Array.isArray(s.mustConditions)) setMustCount(s.mustConditions.length)
        if (Array.isArray(s.wantConditions)) setWantCount(s.wantConditions.length)
      }

      // サーバー未実装時の保険：自由文の転職理由を軽く保持
      if (currentStep === 1 && !transferReason) {
        setTransferReason(outgoing.length > 120 ? outgoing.slice(0, 120) + '…' : outgoing)
      }
    } catch {
      addAI('すみません、エラーが発生しました。もう一度お試しください。')
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

      {/* ちょいデザイン */}
      <style jsx global>{`
        .gradient-bg { background: linear-gradient(135deg, #fdf2f8 0%, #faf5ff 50%, #eff6ff 100%); }
        .gradient-text { background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .message-enter { animation: slideIn 0.3s ease-out; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
      `}</style>

      {/* ヘッダー */}
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

          {/* 進捗バー */}
          <div className='mt-4 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1'>
            <div
              className='bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500 shadow-sm'
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* ステータス行 */}
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusChip label="番号" value={candidateNumber || '未入力'} ok={!!candidateNumber} />
            <StatusChip label="職種" value={qualification || '未入力'} ok={!!qualification} />
            <StatusChip label="勤務先" value={workplace || '未入力'} ok={!!workplace} />
            <StatusChip label="転職理由" value={transferReason ? '設定済み' : '未設定'} ok={!!transferReason} />
            <StatusChip label="Must" value={`${mustCount}件`} ok={mustCount > 0} />
            <StatusChip label="Want" value={`${wantCount}件`} ok={wantCount > 0} />
          </div>
        </div>
      </header>

      {/* メッセージリスト */}
      <main className='max-w-4xl mx-auto px-6 py-8 pb-32'>
        <div ref={listRef} className='space-y-6'>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
              <div className={`flex max-w-xs lg:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${m.type === 'user' ? 'bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white shadow-md' : 'bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white'}`}>
                  {m.type === 'user'
                    ? (<svg width={18} height={18} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2}><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'></path><circle cx='12' cy='7' r='4'></circle></svg>)
                    : (<span className='text-xl'>🤖</span>)
                  }
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

      {/* 入力欄 */}
      <footer className='fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100/50 shadow-xl'>
        <div className='max-w-4xl mx-auto px-6 py-4'>
          <div className='flex items-end gap-3'>
            <div className='flex-1 relative'>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={!isNumberConfirmed && currentStep === 0 ? '求職者番号を入力してください...' : 'メッセージを入力...'}
                className='w-full bg-white border border-pink-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[52px] max-h-32 shadow-sm'
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
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
