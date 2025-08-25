import { useState } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `こんにちは！  
担当エージェントとの面談がスムーズに進むように、HOAPのAIエージェントに少しだけ話を聞かせてね。  

最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。  
IDが確認できたら、そのあとで  
・今の職種（所有資格）  
・今どこで働いてる？  
も続けて聞いていくよ。気楽にどうぞ！`,
    },
  ]);
  const [input, setInput] = useState('');
  const [step] = useState(1);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessages = [
      ...messages,
      { role: 'user', content: input },
      { role: 'assistant', content: `OK、求職者ID：${input} で確認したよ！\nまず「今の職種（所有資格）」を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など` },
    ];
    setMessages(newMessages);
    setInput('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-purple-100 via-pink-100 to-blue-100">
      {/* ヘッダー */}
      <header className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500">
          ほーぷちゃん
        </h1>
        <p className="text-sm text-gray-500">一次ヒアリング（番号必須・タグ厳密整合）</p>
        <div className="flex flex-wrap gap-2 mt-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-gray-100">番号：未入力</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">職種：未入力</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">勤務地：未入力</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">転職理由：未入力</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">Must: 0件</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">Want: 0件</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">Can: 未入力</span>
          <span className="px-2 py-1 rounded-full bg-gray-100">Will: 未入力</span>
        </div>
        <div className="mt-2 h-1 w-full bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 rounded"></div>
        <p className="text-xs text-right text-purple-600 mt-1">Step {step}/6 基本情報</p>
      </header>

      {/* チャットエリア */}
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 flex items-center justify-center text-white mr-2">
                  🤖
                </div>
              )}
              <div
                className={`px-4 py-2 rounded-2xl shadow ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 text-white ml-auto'
                    : 'bg-white text-gray-800'
                }`}
              >
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 flex items-center justify-center text-white ml-2">
                  🧑
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* 入力エリア */}
      <form onSubmit={handleSend} className="p-4 border-t border-gray-200 flex items-center">
        <input
          type="text"
          placeholder="メッセージを入力..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        <button
          type="submit"
          className="ml-2 px-4 py-2 rounded-full text-white shadow bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 hover:opacity-90"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
