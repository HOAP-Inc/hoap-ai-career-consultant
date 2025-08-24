import { useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'

/** 固定フロー（6段） */
const steps = [
  { label: '基本情報' },              // Step0
  { label: '転職理由' },              // Step1
  { label: '絶対条件 (Must)' },       // Step2
  { label: 'あるといいな (Want)' },   // Step3
  { label: 'いままで (Can)' },        // Step4
  { label: 'これから (Will)' },       // Step5
]

function StatusChip({ label, value, ok }) {
  return (
    <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border shadow-sm select-none bg-white/80 border-pink-100 text-slate-700">
      <span className="text-slate-400">{label}：</span>
      <span className={`${ok ? 'font-medium text-slate-800' : 'text-slate-400'}`}>{value}</span>
    </div>
  )
}

export default function Home() {
  // 初期メッセージ（番号→所有資格→勤務先の順だけで進む）
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
`こんにちは！
担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。

いくつか質問をしていくね。
今日は自分の転職について改めて整理する感じで、気楽に話してね！

まずはじめに「求職者番号」を教えて！`,
    },
  ])

  // ====== 状態 ======
  const [currentStep, setCurrentStep] = useState(0) // 0..5
  const [candidateNumber, setCandidateNumber] = useState('')
  const [qualification, setQualification] = useState('')            // 所有資格（タグ確定）
  const [unknownQualification, setUnknownQualification] = useState('') // マスタ外の仮
  const [workplace, setWorkplace] = useState('')

  const [transferReason, setTransferReason] = useState('')
  const [mustCount, setMustCount] = useState(0)
  const [wantCount, setWantCount] = useState(0)
  const [canText, setCanText] = useState('')
  const [willText, setWillText] = useState('')

  const [isNumberConfirmed, setIsNumberConfirmed] = useState(false)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isComposing, setIsComposing] = useState(false) // IME中フラグ
  const [sessionId] = useState(() => Math.random().toString(36).slice(2))

  // 資格マスタ（public/tags/qualifications.json からロード）
  const [qualMaster, setQualMaster] = useState([])
  useEffect(() => {
    fetch('/tags/qualifications.json')
      .then(r => r.json())
      .then(arr => Array.isArray(arr) ? setQualMaster(arr) : setQualMaster([]))
      .catch(() => setQualMaster([]))
  }, [])

  // ====== refs ======
  const listRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const addAI = (text) => setMessages((m) => [...m, { type: 'ai', content: text }])
  const addUser = (text) => setMessages((m) => [...m, { type: 'user', content: text }])

  // 入力欄を確実に空にする
  const hardClearInput = () => {
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.value = '' // DOMも空に
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  // サジェスト（部分一致）
  const qualSuggestions = useMemo(() => {
    const t = input.replace(/\s/g, '')
    if (!t) return []
    const lower = t.toLowerCase()
    const starts = qualMaster.filter(q => String(q).toLowerCase().startsWith(lower))
    const includes = qualMaster.filter(q => !starts.includes(q) && String(q).toLowerCase().includes(lower))
    return [...starts, ...includes].slice(0, 5)
  }, [input, qualMaster])

  const pickQualTag = (text) => {
    const norm = text.replace(/\s/g, '')
    const exact = qualMaster.find(q => q === norm)
    if (exact) return { tag: exact, unknown: '' }
    const cands = qualMaster.filter(q => String(q).includes(norm))
    if (cands.length === 1) return { tag: cands[0], unknown: '' }
    return { tag: '', unknown: norm }
  }

  // 送信
  const onSend = async () => {
    const outgoing = (textareaRef.current?.value ?? input).trim()
    if (!outgoing || loading || isComposing) return

    addUser(outgoing)
    hardClearInput() // 送信直後に必ずクリア

    setLoading(true)
    try {
      // ===== Step0 はフロント強制（番号 → 所有資格 → 勤務先） =====
      if (currentStep === 0) {
        // ① 番号
        if (!isNumberConfirmed) {
          const num = (outgoing.match(/\d{3,}/) || [])[0]
          if (!num) {
            addAI('ごめん！最初に「求職者番号」を数字で教えてね。')
            setLoading(false)
            return
          }
          setCandidateNumber(num)
          setIsNumberConfirmed(true)
          addAI(`求職者番号：${num} だね！\n次は ②「所有資格」（例：正看護師／歯科衛生士／理学療法士...）を教えて！`)
          setLoading(false)
          return
        }
        // ② 所有資格（マスタ照合）
        if (!qualification && !unknownQualification) {
          const { tag, unknown } = pickQualTag(outgoing)
          if (!tag) {
            if (qualSuggestions.length > 0) {
              addAI(`候補はこのあたり？\n${qualSuggestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n番号か正式名称で答えてね。`)
            } else {
              addAI(`ごめん！資格が見つからない…\n主な例：${(qualMaster.slice(0, 10)).join(' / ')}\nこの中にある？正式名称で教えてね。`)
            }
            setUnknownQualification(unknown)
            setLoading(false)
            return
          }
          setQualification(tag)
          setUnknownQualification('')
          addAI('OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！')
          setLoading(false)
          return
        }
        // ②の候補提示後に番号で返ってきた
        if (!qualification && unknownQualification) {
          const choice = Number(outgoing)
          if (!Number.isNaN(choice) && choice >= 1 && choice <= qualSuggestions.length) {
            const chosen = qualSuggestions[choice - 1]
            setQualification(chosen)
            setUnknownQualification('')
            addAI('OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！')
            setLoading(false)
            return
          }
          const { tag } = pickQualTag(outgoing)
          if (tag) {
            setQualification(tag)
            setUnknownQualification('')
            addAI('OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！')
            setLoading(false)
            return
          }
          addAI('資格名の確認ができない…候補から番号で選ぶか、正式名称で教えて！')
          setLoading(false)
          return
        }
        // ③ 勤務先 → Step1へ
        if (!workplace) {
          setWorkplace(outgoing)
          addAI(
`ありがとう！

はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？
しんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎`
          )
          setCurrentStep(1)
          setLoading(false)
          return
        }
      }

      // ===== Step1〜5 は API（タグ付け＆進行はサーバで厳密制御） =====
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing,
          conversationHistory: messages,
          currentStep,                 // 0..5
          candidateNumber,
          isNumberConfirmed,
          sessionId,
          qualification,
          workplace,
        }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      addAI(data.response)
      if (typeof data.step === 'number') setCurrentStep(data.step)

      if (data.sessionData) {
        const s = data.sessionData
        if (s.transferReason) setTransferReason(s.transferReason)
        if (Array.isArray(s.mustConditions)) setMustCount(s.mustConditions.length)
        if (Array.isArray(s.wantConditions)) setWantCount(s.wantConditions.length)
        if (s.canDo) setCanText(s.canDo)
        if (s.willDo) setWillText(s.willDo)
      }
    } catch {
      addAI('すみません、エラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(((currentStep + 1) / steps.length) * 100, 100)

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

      {/* ヘッダー */}
      <header className='bg-white/90 backdrop-blur-sm border-b border-pink-100 sticky top-0 z-10 shadow-sm'>
        <div className='max-w-4xl mx-auto px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div>
              <h1 className='text-2xl font-bold gradient-text'>HOAP AI エージェント</h1>
              <p className='text-slate-600 text-sm'>キャリア相談・一次ヒアリング</p>
            </div>
            <div className='text-right'>
              <div className='text-sm text-slate-500'>Step <span>{currentStep + 1}</span>/{steps.length}</div>
              <div className='text-xs gradient-text font-medium'>
                <span>{steps[currentStep]?.label}</span>
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
            <StatusChip label="所有資格" value={qualification || (unknownQualification ? `未確定: ${unknownQualification}` : '未入力')} ok={!!qualification} />
            <StatusChip label="勤務先" value={workplace || '未入力'} ok={!!workplace} />
            <StatusChip label="転職理由" value={transferReason ? '設定済み' : '未設定'} ok={!!transferReason} />
            <StatusChip label="Must" value={`${mustCount}件`} ok={mustCount > 0} />
            <StatusChip label="Want" value={`${wantCount}件`} ok={wantCount > 0} />
            <StatusChip label="Can" value={canText ? '入力済' : '未入力'} ok={!!canText} />
            <StatusChip label="Will" value={willText ? '入力済' : '未入力'} ok={!!willText} />
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

      {/* 入力エリア */}
      <footer className='fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100/50 shadow-xl'>
        <div className='max-w-4xl mx-auto px-6 py-4'>
          <div className='flex items-end gap-3'>
            <div className='flex-1 relative'>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={
                  currentStep === 0 && !isNumberConfirmed
                    ? '求職者番号（数字）'
                    : currentStep === 0 && !qualification && !unknownQualification
                    ? '所有資格（例：正看護師／歯科衛生士／理学療法士 など）'
                    : currentStep === 0 && !workplace
                    ? 'いま働いてる場所（施設名や業態）'
                    : 'メッセージを入力...'
                }
                className='w-full bg-white border border-pink-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[52px] max-h-32 shadow-sm'
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // 変換中Enterは送信しない（各ブラウザ対策）
                    // @ts-ignore
                    if (isComposing || e.isComposing || (e.nativeEvent && e.nativeEvent.isComposing) || e.keyCode === 229) return
                    if (!e.shiftKey) {
                      e.preventDefault()
                      onSend()
                    }
                  }
                }}
              />
              {/* 簡易サジェスト */}
              {currentStep === 0 && isNumberConfirmed && !qualification && (qualSuggestions.length > 0) && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-pink-100 rounded-xl shadow-sm">
                  {qualSuggestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setQualification(q)
                        setUnknownQualification('')
                        setMessages((m) => [...m, { type: 'ai', content: 'OK！次は ③「いま働いてる場所」（施設名や業態）を教えて！' }])
                        hardClearInput()
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-pink-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => { if (!isComposing) onSend() }}
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
