// pages/api/chat.js

// 超簡易・メモリセッション（Vercel の無状態環境では永続しませんが、重複送信抑止には十分）
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 0,
      status: {
        number: "未入力",
        job: "未入力",
        place: "未入力",
        reason: "未入力",
        must: "0件",
        want: "0件",
        can: "未入力",
        will: "未入力",
      },
      greeted: true, // index 側で初回挨拶を出している前提
    });
  }
  return sessions.get(id);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { sessionId, step, status, message } = req.body || {};
  const text = (message || "").trim();
  const sess = getSession(sessionId);

  // クライアント側の表示値も反映（最新化）
  if (status) sess.status = { ...sess.status, ...status };
  if (typeof step === "number") sess.step = step;

  // 簡易ステートマシン
  if (sess.step === 0) {
    // 求職者ID
    const m = text.match(/^\d{3,}$/);
    if (m) {
      sess.status.number = m[0];
      sess.step = 1;
      return res.json({
        response:
          "OK、求職者ID：**" +
          sess.status.number +
          "** で確認したよ！\nまず【今の職種（所有資格）】を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など",
        step: sess.step,
        status: sess.status,
      });
    }
    return res.json({
      response:
        "ごめん、数字だけで教えてほしいな。\nメールで届いている『求職者ID』を入力してね！",
      step: sess.step,
      status: sess.status,
    });
  }

  if (sess.step === 1) {
    // 職種 → 次の質問（勤務先）
    if (text.length < 2) {
      return res.json({
        response:
          "ありがと！今の【職種（所有資格）】をもう少しだけ具体的に教えてね。（例）正看護師／介護福祉士／実務者研修",
        step: sess.step,
        status: sess.status,
      });
    }
    sess.status.job = text;
    sess.step = 1.5;
    return res.json({
      response:
        "受け取ったよ！\n次に【今どこで働いてる？】を教えてね。\n（例）〇〇病院 外来／△△クリニック",
      step: sess.step,
      status: sess.status,
    });
  }

  if (sess.step === 1.5) {
    // 勤務先 → 次へ（以降は未実装のため案内）
    sess.status.place = text || "未入力";
    sess.step = 2;
    return res.json({
      response:
        "ありがとう！ここまでの内容はメモしたよ。\nこの先（転職理由やMust/Wantなど）は、別途仕様に沿って進めていくね！",
      step: sess.step,
      status: sess.status,
    });
  }

  // デフォルトフォールバック
  return res.json({
    response:
      "了解だよ！内容は受け取ったよ。続きもこのまま教えてね。必要に応じて次のステップに進めていくよ。",
    step: sess.step,
    status: sess.status,
  });
}
