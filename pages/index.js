// pages/index.js
import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

const steps = [
  { key: 'basic', label: '基本情報' },
  { key: 'reason', label: '転職理由' },
  { key: 'must', label: 'Must' },
  { key: 'want', label: 'Want' },
  { key: 'can', label: 'Can' },
  { key: 'will', label: 'Will' },
];

export default function Home() {
  // 画面状態
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content:
        'こんにちは！\n担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。\n\n最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！',
    },
  ]);
  const [currentStep, setCurrentStep] = useState(0);

  // ステータス（表示用）
  const [status, setStatus] = useState({
    number: '未入力',
    qualification: '未入力',
    workplace: '未入力',
    reason: '未入力',
    mustCount: 0,
    wantCount: 0,
    can: '未入力',
    will: '未入力',
  });

  // 入力・送信
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  // 自動スクロール
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // セッションID（簡易）
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));

  // 送信処理
  const onSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // 画面にユーザー発話を追加
    setMessages((m) => [...m, { type: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages,
          currentStep,
          candidateNumber: status.number === '未入力' ? '' : status.number,
          isNumberConfirmed: status.number !== '未入力',
          sessionId,
        }),
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      // 返信を表示
      setMessages((m) => [...m, { type: 'ai', content: data.response }]);

      // ステップ更新
      if (typeof data.step === 'number') setCurrentStep(data.step);

      // サーバから返ってきた候補者番号・フラグ等でステータス更新
      if (data.candidateNumber) {
        setStatus((s) => ({ ...s, number: data.candidateNumber }));
      }
      if (data.sessionData) {
        const sd = data.sessionData;
        setStatus((s) => ({
          ...s,
          qualification: sd.qualification || s.qualification,
          workplace: sd.workplace || s.workplace,
          reason: sd.transferReason ? '設定済' : s.reason,
          mustCount: Array.isArray(sd.mustConditions) ? sd.mustConditions.length : s.mustCount,
          wantCount: Array.isArray(sd.wantConditions) ? sd.wantConditions.length : s.wantCount,
          can: sd.canDo ? '入力済' : s.can,
          will: sd.willDo ? '入力済' : s.will,
        }));
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { type: 'ai', content: 'すみません、エラーが発生しました。もう一度お試しください。' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 進捗バー（ダミーの視覚表現）
  const progress = Math.min(((currentStep + 1) / 6) * 100, 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 via-violet-50 to-sky-50 text-slate-800">
      <Head>
        <title>ほーぷちゃん | 一次ヒアリング</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-wide">
              ほーぷちゃん
            </h1>
            <div className="text-right">
              <div className="text-sm text-slate-500">
                Step <span>{currentStep + 1}</span>/6
              </div>
              <div className="text-xs text-fuchsia-600 font-semibold">
                ※求職者ID必須（メールに届いているID）
              </div>
            </div>
          </div>

          {/* ステータス行 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Chip label="番号" value={status.number} />
            <Chip label="職種" value={status.qualification} />
            <Chip label="勤務先" value={status.workplace} />
            <Chip label="転職理由" value={status.reason} />
            <Chip label="Must" value={`${status.mustCount}件`} />
            <Chip label="Want" value={`${status.wantCount}件`} />
            <Chip label="Can" value={status.can} />
            <Chip label="Will" value={status.will} />
          </div>

          {/* 進捗 */}
          <div className="mt-2 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-1 bg-gradient-to-r from-fuchsia-500 via-purple-500 to-sky-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      {/* 本文 */}
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 pb-28">
        <div ref={listRef} className="space-y-4">
          {messages.map((m, i) => (
            <Bubble key={i} type={m.type} content={m.content} />
          ))}
          {loading && <Bubble type="ai" content="…回答を準備中…" />}
        </div>
      </main>

      {/* 入力欄 */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur border-t">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                currentStep === 0 && status.number === '未入力'
                  ? '求職者IDを入力してください（メールに届いているID）…'
                  : 'メッセージを入力…'
              }
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />
            <button
              onClick={onSend}
              disabled={loading}
              className="shrink-0 rounded-xl px-4 py-3 text-white shadow-sm disabled:opacity-50 bg-gradient-to-r from-fuchsia-500 to-sky-500"
              aria-label="send"
            >
              送信
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* --- 小物コンポーネント --- */

function Chip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 shadow-sm">
      <span className="text-slate-500">{label}：</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Bubble({ type, content }) {
  const isUser = type === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] md:max-w-[70%] rounded-2xl px-4 py-3 shadow ${
          isUser
            ? 'bg-gradient-to-r from-fuchsia-500 to-sky-500 text-white'
            : 'bg-white border border-slate-200'
        }`}
      >
        <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{content}</div>
      </div>
    </div>
  );
}
