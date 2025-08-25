import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import '../styles/globals.css';

const HeaderBadges = ({ state }) => (
  <div className="flex flex-wrap items-center gap-3 text-sm">
    <span className="badge">番号：{state.candidateNumber ? '設定済' : '未入力'}</span>
    <span className="badge">職種：{state.qualificationText ? '設定済' : '未入力'}</span>
    <span className="badge">勤務先：{state.workplaceText ? '入力' : '未入力'}</span>
    <span className="badge">転職理由：{state.step >= 1 ? '入力中' : '未入力'}</span>
    <span className="badge">Must：0件</span>
    <span className="badge">Want：0件</span>
    <span className="badge">Can：{state.step >= 4 ? '入力中' : '未入力'}</span>
    <span className="badge">Will：{state.step >= 5 ? '入力中' : '未入力'}</span>
    <style jsx>{`
      .badge {
        padding: 4px 10px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 9999px;
      }
    `}</style>
  </div>
);

export default function Home() {
  const [messages, setMessages] = useState([
    { type: 'ai', content:
`こんにちは！
担当エージェントとの面談がスムーズに進むように、**ほーぷちゃん**に少しだけ話を聞かせてね。

最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。
IDが確認できたら、そのあとで
・今の職種（所有資格）
・今どこで働いてる？
も続けて聞いていくよ。気楽にどうぞ！`
    }
  ]);
  const [state, setState] = useState({
    step: 0,
    candidateNumber: '',
    qualificationText: '',
    workplaceText: ''
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));

  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages(m => [...m, { type: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const data = await r.json();

      setMessages(m => [...m, { type: 'ai', content: data.response }]);

      setState(s => ({
        ...s,
        step: typeof data.step === 'number' ? data.step : s.step,
        candidateNumber: data.candidateNumber ?? s.candidateNumber,
        qualificationText: data.sessionData?.qualificationText ?? s.qualificationText,
        workplaceText: data.sessionData?.workplaceText ?? s.workplaceText
      }));
    } catch (e) {
      setMessages(m => [...m, { type: 'ai', content: 'ごめん、通信でエラー。もう一度送って！' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-pink-50">
      <Head><title>ほーぷちゃん｜一次ヒアリング</title></Head>

      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-purple-700">ほーぷちゃん</h1>
            <p className="text-xs text-slate-500">一次ヒアリング（番号必須・タグ厳密整合）</p>
          </div>
          <div className="text-right text-sm">
            <div>Step {Math.min(state.step + 1, 6)}/6</div>
            <div className="text-pink-500 text-xs">※求職者ID必須（メールに届いているID）</div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 pb-3">
          <HeaderBadges state={state} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6">
        <div ref={listRef} className="space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl rounded-2xl px-4 py-3 shadow ${m.type === 'user' ? 'bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white' : 'bg-white'}`}>
                <div className="whitespace-pre-wrap text-[15px] leading-7">{m.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-3xl rounded-2xl px-4 py-3 shadow bg-white text-slate-500">・・・回答を作成中</div>
            </div>
          )}
        </div>
      </main>

      <footer className="sticky bottom-0 bg-white/80 backdrop-blur border-t">
        <div className="max-w-5xl mx-auto px-5 py-4 flex gap-3">
          <input
            className="flex-1 rounded-xl border px-4 py-3 outline-none"
            placeholder="メッセージを入力してください…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button
            onClick={send}
            disabled={loading}
            className="px-4 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white disabled:opacity-50"
          >
            送信
          </button>
        </div>
      </footer>
    </div>
  );
}
