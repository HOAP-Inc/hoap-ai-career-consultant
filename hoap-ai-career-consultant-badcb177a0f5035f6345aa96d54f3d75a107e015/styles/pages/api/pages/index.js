mport { useEffect, useRef, useState } from 'react'
<div className="mt-4 bg-gradient-to-r from-pink-100 to-blue-100 rounded-full h-1">
<div className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-1 rounded-full transition-all duration-500 shadow-sm" style={{ width: `${progress}%` }} />
</div>
</div>
</header>


<main className="max-w-4xl mx-auto px-6 py-8 pb-32">
<div ref={listRef} className="space-y-6">
{messages.map((m, i) => (
<div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} message-enter`}>
<div className={`flex max-w-xs lg:max-w-2xl ${m.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
<div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${m.type === 'user' ? 'bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white shadow-md' : 'bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white'}`}>
{m.type === 'user' ? (
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
) : (
<span className="text-xl">🤖</span>
)}
</div>
<div className={`${m.type === 'user' ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white ml-auto shadow-lg' : 'bg-white/90 backdrop-blur-sm text-slate-700 border border-pink-100/50'} rounded-2xl px-4 py-3 shadow-sm`}>
<div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
</div>
</div>
</div>
))}
{loading && (
<div className="flex justify-start">
<div className="flex items-start gap-3">
<div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-gray-100 to-gray-200 shadow-md border-2 border-white flex items-center justify-center">
<span className="text-xl">🤖</span>
</div>
<div className="bg-white/90 backdrop-blur-sm border border-pink-100/50 rounded-2xl px-4 py-3 shadow-sm">
<div className="flex items-center gap-2 text-slate-500">
<span className="animate-pulse">●●●</span>
<span className="text-sm ml-2">回答を準備中...</span>
</div>
</div>
</div>
</div>
)}
</div>
</main>


<footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-pink-100/50 shadow-xl">
<div className="max-w-4xl mx-auto px-6 py-4">
<div className="flex items-end gap-3">
<div className="flex-1 relative">
<textarea
value={input}
onChange={(e) => setInput(e.target.value)}
placeholder={!isNumberConfirmed && currentStep === 0 ? '求職者番号を入力してください...' : 'メッセージを入力...'}
className="w-full bg-white border border-pink-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent resize-none min-h-[52px] max-h-32 shadow-sm"
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
className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 hover:from-pink-600 hover:via-purple-600 hover:to-blue-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl p-3 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
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
