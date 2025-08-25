// pages/api/chat.js
// ───────────────────────────────────────────────────────────
// ほーぷちゃん API（Step0〜1の重複ガード付きミニFSM）
// ───────────────────────────────────────────────────────────

/**
 * メモリ内セッション
 *  - 本番では KV / DB 等に置き換え
 */
const SESSIONS = new Map();

/** 既存 or 新規セッションを取得 */
function getSession(sessionId) {
  if (!SESSIONS.has(sessionId)) {
    SESSIONS.set(sessionId, {
      sessionId,
      createdAt: Date.now(),
      // 状態
      candidateNumber: '',
      idConfirmed: false,
      asked: {
        id: false,          // 「最初に求職者IDを〜」を出したか
        profession: false,  // 職種（所有資格）を聞いたか
        workplace: false,   // どこで働いてる？を聞いたか
      },
      // 収集データ
      profession: '',       // 所有資格（タグ確定は別ステップで実施）
      workplace: '',
      step: 0,              // 0:基本情報, 1:転職理由, 2:Must, 3:Want, 4:Can, 5:Will
      memo: [],             // 原文メモ
    });
  }
  return SESSIONS.get(sessionId);
}

/** 返答ヘルパ */
function reply(res, payload) {
  return res.status(200).json(payload);
}

/** 数字っぽいIDか簡易チェック */
function looksLikeId(text) {
  return /^[0-9]{3,}$/.test(String(text || '').trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      message = '',
      sessionId,
      // フロントから送られてくる現状（あってもなくても良い）
      currentStep,
      candidateNumber,
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const session = getSession(sessionId);
    const userMsg = String(message || '').trim();

    // フロントの state が進んでいても、サーバ側を真にする
    if (typeof currentStep === 'number' && currentStep > session.step) {
      session.step = currentStep;
    }
    if (typeof candidateNumber === 'string' && candidateNumber && !session.candidateNumber) {
      session.candidateNumber = candidateNumber;
      session.idConfirmed = true;
    }

    // ─────────────────────────────────────────
    // Step0: 基本情報（ID → 職種 → 現在の勤務先）
    // ─────────────────────────────────────────
    if (session.step === 0) {
      // 1) まだID未確認 → IDの案内 or 入力を処理
      if (!session.idConfirmed) {
        if (!session.asked.id) {
          session.asked.id = true;
          return reply(res, {
            response:
              '最初に【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）。\nIDが確認できたら、そのあとで\n・今の職種（所有資格）\n・今どこで働いてる？\nも続けて聞いていくよ。気楽にどうぞ！',
            step: 0,
            candidateNumber: '',
            isNumberConfirmed: false,
            sessionData: session,
          });
        }

        // ユーザーの今回メッセージがIDなら確定
        if (looksLikeId(userMsg)) {
          session.candidateNumber = userMsg;
          session.idConfirmed = true;
          // 次の問い（職種）へ。以降、同じ案内は再出さない
          session.asked.profession = true;
          return reply(res, {
            response:
              `OK、求職者ID：${userMsg} で確認したよ！\nまず「今の職種（所有資格）」を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など`,
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          });
        }

        // IDじゃない発話は保留メモに入れて、重複案内は出さない
        if (userMsg) session.memo.push({ k: 'before_id', v: userMsg });
        return reply(res, {
          response:
            'ごめんね、まずは【求職者ID】を教えてね。※IDは「メール」で届いているやつ（LINEじゃないよ）',
          step: 0,
          candidateNumber: '',
          isNumberConfirmed: false,
          sessionData: session,
        });
      }

      // 2) IDは確認済み。職種を聞く（未質問なら出す・一度だけ）
      if (!session.profession) {
        if (!session.asked.profession) {
          session.asked.profession = true;
          return reply(res, {
            response:
              'まず「今の職種（所有資格）」を教えてね。\n（例）正看護師／介護福祉士／初任者研修 など',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          });
        }

        // 今回の発話を職種として保持（タグ確定は後続ステップ）
        if (userMsg) {
          session.profession = userMsg;
          // 次：勤務先を質問
          session.asked.workplace = true;
          return reply(res, {
            response: 'ありがとう！次は「今どこで働いてる？」を教えてね。',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          });
        }

        // 空メッセージ時は促す（繰り返し文は短く）
        return reply(res, {
          response: '今の職種（所有資格）を教えてね。',
          step: 0,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        });
      }

      // 3) 勤務先を聞く
      if (!session.workplace) {
        if (!session.asked.workplace) {
          session.asked.workplace = true;
          return reply(res, {
            response: '次は「今どこで働いてる？」を教えてね。',
            step: 0,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          });
        }

        if (userMsg) {
          session.workplace = userMsg;
          // 基本情報そろった → Step1へ遷移
          session.step = 1;
          return reply(res, {
            response:
              'はじめに、今回の転職理由を教えてほしいな。きっかけってどんなことだった？\nしんどいと思ったこと、これはもう無理って思ったこと、逆にこういうことに挑戦したい！って思ったこと、何でもOKだよ◎',
            step: 1,
            candidateNumber: session.candidateNumber,
            isNumberConfirmed: true,
            sessionData: session,
          });
        }

        return reply(res, {
          response: '今どこで働いてる？を教えてね。',
          step: 0,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        });
      }
    }

    // ─────────────────────────────────────────
    // Step1（転職理由）：ここからは別ロジックに委譲想定
    // ※ ここで重複させないガードだけ置いておく
    // ─────────────────────────────────────────
    if (session.step === 1) {
      // まだユーザーの最初の転職理由を受け取っていない場合
      if (userMsg) {
        session.memo.push({ k: 'reason_raw', v: userMsg });
        // 次のステップ（Must へ）に進ませるのは既存ロジック側でOK
        // ここでは一旦、次に進む旨だけ返しておく
        session.step = 2; // 以降の詳細ヒアリングは既存実装に任せる
        return reply(res, {
          response: 'ありがとう！次は「譲れない条件（Must）」を一緒に整理していこう。',
          step: 2,
          candidateNumber: session.candidateNumber,
          isNumberConfirmed: true,
          sessionData: session,
        });
      }

      // 空なら、同じ質問を「一度だけ」返す
      return reply(res, {
        response:
          '今回の転職理由を教えてほしいな。しんどかったこと・無理だと思ったこと・挑戦したいこと、何でもOKだよ◎',
        step: 1,
        candidateNumber: session.candidateNumber,
        isNumberConfirmed: true,
        sessionData: session,
      });
    }

    // それ以外（Step2+）は既存の処理に繋げる前提。暫定で応答。
    return reply(res, {
      response: '続けよう！この先のステップは既存ロジックに合わせて進めるね。',
      step: session.step,
      candidateNumber: session.candidateNumber,
      isNumberConfirmed: !!session.candidateNumber,
      sessionData: session,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
