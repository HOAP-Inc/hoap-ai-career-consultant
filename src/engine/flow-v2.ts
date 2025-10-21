import type { Meta, Phase, Status } from "../models/state";
import { readPrompt } from "./prompt-loader";
import {
  validateConversationOutput,
  validateGenerationOutput,
  type ConversationValidationResult,
  type GenerationValidationResult,
} from "./validator";
import { runStep4Adapter } from "./legacy/step4-adapter";

const MAX_CYCLES = 3;

type InternalPhase = Phase | "generation";

type SessionState = {
  step: number;
  phase: InternalPhase;
  cycles: number;
  history: string[];
};

const sessions = new Map<string, SessionState>();

export type RouteStepArgs = {
  sessionId: string;
  status: Status;
  meta: Meta;
  userMessage: string;
};

export type RouteStepResult = {
  status: Status;
  meta: Meta;
  response?: string;
};

function getSessionState(sessionId: string, step: number): SessionState {
  const current = sessions.get(sessionId);
  if (!current || current.step !== step) {
    const fresh: SessionState = { step, phase: "intro", cycles: 0, history: [] };
    sessions.set(sessionId, fresh);
    return fresh;
  }
  return current;
}

function parseLLMResponse(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }
  return null;
}

function shouldEnterGeneration(response: string, cycles: number): boolean {
  if (!response) return false;
  const markers = ["十分な具体性あり", "GENERATION_READY", "具体性は十分" ];
  if (markers.some((m) => response.includes(m))) {
    return true;
  }
  return cycles >= MAX_CYCLES;
}

function mergeStatus(base: Status, patch: Partial<Status>): Status {
  const next: Status = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<[keyof Status, Status[keyof Status]]>) {
    if (value !== undefined) {
      (next as Record<keyof Status, Status[keyof Status]>)[key] = value;
    }
  }
  return next;
}

async function runConversationPhase(params: {
  step: number;
  phase: Phase;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
  history: string[];
}): Promise<ConversationValidationResult> {
  const prompt = readPrompt(params.step);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callLLM(prompt, {
        step: params.step,
        phase: params.phase,
        status: params.status,
        meta: params.meta,
        userMessage: params.userMessage,
        cycleCount: params.cycleCount,
        mode: "conversation",
        history: params.history,
      });
      const parsed = parseLLMResponse(raw);
      const validation = validateConversationOutput(params.phase, parsed);
      if (validation.ok) {
        return validation;
      }
    } catch {
      // ignore and retry
    }
  }
  return { ok: true, response: "" };
}

async function runGenerationPhase(params: {
  step: number;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
  history: string[];
}): Promise<GenerationValidationResult> {
  const prompt = readPrompt(params.step);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await callLLM(prompt, {
        step: params.step,
        phase: "generation",
        status: params.status,
        meta: params.meta,
        userMessage: params.userMessage,
        cycleCount: params.cycleCount,
        mode: "generation",
        history: params.history,
      });
      const parsed = parseLLMResponse(raw);
      const validation = validateGenerationOutput(params.step, parsed, attempt);
      if (validation.ok) {
        return validation;
      }
    } catch {
      // ignore and retry
    }
  }
  // Final fallback (validator should have produced fallback values on second attempt)
  return validateGenerationOutput(params.step, {}, 2);
}

export async function routeStep({ sessionId, status, meta, userMessage }: RouteStepArgs): Promise<RouteStepResult> {
  const step = Number(meta?.step ?? 0);
  if (!Number.isFinite(step) || step < 2 || step > 6) {
    throw new Error(`Unsupported step: ${meta?.step}`);
  }

  const session = getSessionState(sessionId, step);

  const trimmedMessage = userMessage.trim();
  if (trimmedMessage) {
    session.history.push(trimmedMessage);
  }

  if (session.phase === "intro") {
    const validation = await runConversationPhase({
      step,
      phase: "intro",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
      history: session.history,
    });
    session.phase = "empathy";
    return {
      status,
      meta: { step, phase: "intro" },
      response: validation.response,
    };
  }

  if (session.phase === "empathy") {
    const validation = await runConversationPhase({
      step,
      phase: "empathy",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
      history: session.history,
    });
    session.phase = "deepening";
    return {
      status,
      meta: { step, phase: "empathy" },
      response: validation.response,
    };
  }

  if (session.phase === "deepening") {
    const validation = await runConversationPhase({
      step,
      phase: "deepening",
      status,
      meta,
      userMessage,
      cycleCount: session.cycles,
      history: session.history,
    });
    session.cycles += 1;
    if (shouldEnterGeneration(validation.response, session.cycles)) {
      session.phase = "generation";
    } else if (session.cycles >= MAX_CYCLES) {
      session.phase = "generation";
    } else {
      session.phase = "empathy";
    }
    return {
      status,
      meta: { step, phase: "deepening" },
      response: validation.response,
    };
  }

  // generation phase
  const generation = await runGenerationPhase({
    step,
    status,
    meta,
    userMessage,
    cycleCount: session.cycles,
    history: session.history,
  });

  let patchedStatus = generation.status;

  if (step === 4) {
    const adapter = runStep4Adapter(userMessage);
    patchedStatus = { ...patchedStatus, must_have_ids: adapter.status.must_have_ids };
  }

  const merged = mergeStatus(status, patchedStatus);

  const nextStep = step === 6 ? 7 : step + 1;
  sessions.delete(sessionId);

  return {
    status: merged,
    meta: { step: nextStep },
  };
}

type LLMInput = {
  step: number;
  phase: string;
  status: Status;
  meta: Meta;
  userMessage: string;
  cycleCount: number;
  mode: "conversation" | "generation";
  history: string[];
};

async function callLLM(prompt: string, input: LLMInput): Promise<string> {
  // Stub implementation that emulates deterministic LLM behaviour.
  if (input.mode === "generation") {
    return JSON.stringify({ status: buildGenerationPayload(input.step, input.history, input.status) });
  }
  return JSON.stringify({
    control: { phase: input.phase },
    response: buildConversationResponse(input.step, input.phase as Phase, input, prompt),
  });
}

function buildConversationResponse(step: number, phase: Phase, input: LLMInput, prompt: string): string {
  const scripted = extractScriptedResponse(prompt, phase);
  if (scripted) {
    return scripted;
  }
  const summary = summariseUserMessage(input.userMessage);
  if (phase === "intro") {
    const topic = summary ? `今の「${summary}」という状況` : "今のご状況";
    return `こんにちは。${topic}について、無理のない範囲で教えてもらえるかな？`;
  }
  if (phase === "empathy") {
    return buildEmpathyResponse(step, summary, input.cycleCount, detectSentiment(summary || input.userMessage));
  }
  if (phase === "deepening") {
    return buildDeepeningPrompt(step, summary, input.cycleCount);
  }
  return "";
}

function summariseUserMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "";
  const segments = trimmed
    .split(/[。！？!\?\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return trimmed.slice(-20);
  }
  const candidate = segments[segments.length - 1] || segments[0];
  return candidate.length > 24 ? candidate.slice(0, 24) : candidate;
}

function extractScriptedResponse(prompt: string, phase: Phase): string | null {
  if (!prompt.trim()) return null;
  const labelMap: Record<Phase, string[]> = {
    intro: ["Phase 1：intro", "Phase1：intro"],
    empathy: ["Phase 2：empathy", "Phase2：empathy"],
    deepening: ["Phase 3：deepening", "Phase3：deepening"],
    generation: [],
  };

  const labels = labelMap[phase];
  if (!labels.length) return null;

  const lines = prompt.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (startIndex === -1) {
    return null;
  }

  const collected: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (/^Phase\s+\d/.test(line) || line.startsWith("---")) {
      break;
    }
    if (line.startsWith("出力：") || line.startsWith("例：") || line.startsWith("禁止語検出")) {
      break;
    }
    if (/^\{/.test(line)) {
      break;
    }
    collected.push(line);
  }

  if (collected.length === 0) {
    // As a fallback, try to capture the response string inside the example JSON block.
    const snippet = lines.slice(startIndex).join("\n");
    const match = snippet.match(/"response"\s*:\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
    return null;
  }

  const text = collected.join(" ");
  if (phase === "intro") {
    return text;
  }

  if (phase === "empathy" || phase === "deepening") {
    if (text.includes("自然な共感メッセージ") || text.includes("質問")) {
      return null;
    }
    return text;
  }

  return null;
}

type Sentiment = "positive" | "negative" | "uncertain";

type StepConversationConfig = {
  topic: string;
  empathy: Record<Sentiment, string[]>;
  deepening: {
    prompts: string[];
    finalCue: string;
  };
};

const STEP_CONVERSATION: Record<number, StepConversationConfig> = {
  2: {
    topic: "これまで発揮してきた強み",
    empathy: {
      positive: [
        "{topic}を聞いて、現場で頼られてきた様子が伝わってきたよ。その強みが光った瞬間を一緒に整理してみよう。",
        "{topic}に込めた工夫がとても前向きで素敵だね。どんな成果につながったのかもう少し教えてほしいな。",
        "{topic}に取り組む姿勢から、周囲を支える頼もしさを感じたよ。活かせた場面を一緒に思い出してみよう。",
      ],
      negative: [
        "{topic}に向き合いながらも力を尽くしてきたのが伝わってきたよ。踏ん張った瞬間を一緒にたどってみよう。",
        "{topic}を守ろうとする姿勢に誠実さを感じたよ。大変だったときに支えになった行動を振り返ってみよう。",
        "{topic}について丁寧に共有してくれてありがとう。その中で保ち続けた強みを一緒に探してみよう。",
      ],
      uncertain: [
        "{topic}について率直に話してくれてありがとう。どんな背景があるのか一緒に紐解いていこう。",
        "{topic}を整理しようとしているところが伝わってきたよ。どの場面で強みが表れたのか一緒に確かめてみよう。",
        "{topic}に向き合う気持ちが伝わってきたよ。丁寧に一歩ずつ掘り下げていこう。",
      ],
    },
    deepening: {
      prompts: [
        "{context}で特に手応えを感じた出来事はある？その時の様子を教えてほしいな。",
        "{context}を支えるために心掛けていた工夫や、周囲との連携で意識していたことはある？",
        "{context}から得た学びを、今後どんな場面で活かしたいと思っている？",
      ],
      finalCue: "話してくれた内容から強みが明確になったよ。次に進もう。",
    },
  },
  3: {
    topic: "これから挑戦したいこと",
    empathy: {
      positive: [
        "{topic}に向かう想いがワクワク伝わってきたよ。実現したい背景を一緒に描いてみよう。",
        "{topic}のビジョンを聞いて頼もしさを感じたよ。どんな未来を描いているのか詳しく教えてほしいな。",
        "{topic}に向けた準備が進んでいるのが伝わってきたよ。その熱量を支えるエピソードを掘り下げよう。",
      ],
      negative: [
        "{topic}を目指す中で迷いも抱えているんだね。その気持ちを尊重しながら、叶えたい姿を一緒に整理しよう。",
        "{topic}を考えるときに感じる不安も大事なヒントだよ。どこから取り組むと進みそうか一緒に探そう。",
        "{topic}に向けた葛藤を共有してくれてありがとう。大切にしたい芯の部分を言葉にしてみよう。",
      ],
      uncertain: [
        "{topic}を模索しているところなんだね。心が動く場面を一緒に思い出して方向性を探ろう。",
        "{topic}についてまだ考え始めたばかりでも大丈夫。一歩目になりそうな手がかりを整理しよう。",
        "{topic}に向けたヒントを探していこう。印象に残る出来事を思い出しながら確かめてみよう。",
      ],
    },
    deepening: {
      prompts: [
        "{context}を挑戦したいと思ったきっかけや場面を教えてもらえる？",
        "{context}を進めるために既に動き始めていることや準備していることはある？",
        "{context}が実現したとき、周囲や自分にどんな変化をもたらしたい？",
      ],
      finalCue: "描いている挑戦の輪郭が見えてきたよ。次に進もう。",
    },
  },
  4: {
    topic: "Must（必要条件）",
    empathy: {
      positive: [
        "{topic}に向けて整理している視点が的確だね。どうしてその条件が重要だと思ったのか深掘りしてみよう。",
        "{topic}を押さえようとしている姿勢から、仕事への真剣さが伝わってきたよ。根拠になった経験も聞かせてね。",
        "{topic}を大切にする理由に納得感があるね。判断材料になった出来事を一緒に振り返ろう。",
      ],
      negative: [
        "{topic}を考えるときに難しさもあるんだね。その感覚を尊重しながら必要な条件を整理してみよう。",
        "{topic}に迷いがあるからこそ丁寧に見極めたいよね。判断に悩んだ場面を一緒にたどってみよう。",
        "{topic}で抱えている不安も大切なサインだよ。大事にしたい線引きを言葉にしてみよう。",
      ],
      uncertain: [
        "{topic}をこれから整えていくところなんだね。判断の手がかりになりそうな出来事を探してみよう。",
        "{topic}を考えるヒントがまだ揃っていなくても大丈夫。一緒に必要な視点を洗い出していこう。",
        "{topic}について考え始めた段階なんだね。迷いが出た瞬間をたどりながら条件を描いてみよう。",
      ],
    },
    deepening: {
      prompts: [
        "{context}を重視するようになったきっかけや背景を教えてもらえる？",
        "{context}を満たしたとき、現場や働き方にどんな良い変化がありそう？",
        "{context}が守られなかったときに起きた困りごとがあれば共有してもらえる？",
      ],
      finalCue: "必要な条件が整理できたよ。次に進もう。",
    },
  },
  5: {
    topic: "あなた自身の姿",
    empathy: {
      positive: [
        "{topic}を語る言葉から、日々を丁寧に積み重ねている姿が伝わってきたよ。その背景を一緒に深めよう。",
        "{topic}を通じて大切にしている価値観が輝いているね。象徴的な出来事を教えてほしいな。",
        "{topic}の語り口から温かさが伝わってきたよ。自分らしさを感じた場面を一緒に思い出そう。",
      ],
      negative: [
        "{topic}を言葉にするのが難しい時期なんだね。感じている揺らぎも含めて丁寧に整理してみよう。",
        "{topic}で迷いがあることを打ち明けてくれてありがとう。自分を支えた行動を一緒に探していこう。",
        "{topic}に自信が持てない瞬間も大切な気づきだよ。どんな時に自分らしさを感じたか紐解いてみよう。",
      ],
      uncertain: [
        "{topic}をこれから言葉にしていくところなんだね。印象に残る日常の場面からヒントを拾ってみよう。",
        "{topic}について考え始めた段階だとしても大丈夫。一緒に小さなエピソードを積み上げてみよう。",
        "{topic}の輪郭を探していこう。心が動いた出来事を一緒に振り返ってみよう。",
      ],
    },
    deepening: {
      prompts: [
        "{context}が表れた日常のシーンや関わり方を教えてもらえる？",
        "{context}を大切にするときに意識している言葉や習慣はある？",
        "{context}を通じて周囲にどんな影響を届けたいと思っている？",
      ],
      finalCue: "あなたらしさが描けてきたよ。次に進もう。",
    },
  },
  6: {
    topic: "日々の実践と大事にしたいあり方",
    empathy: {
      positive: [
        "{topic}を聞いて、現場での丁寧な関わりが浮かんできたよ。どんな行動が支えになっているのか深掘りしよう。",
        "{topic}の語り口から、仲間と創る未来が見えてきたよ。印象的な実践を教えてほしいな。",
        "{topic}を通して積み重ねている姿勢がとても頼もしいね。大切にしているあり方を一緒に言葉にしよう。",
      ],
      negative: [
        "{topic}に向き合う中で葛藤もあったんだね。その中で守り抜いた行動や想いを振り返ってみよう。",
        "{topic}で感じた難しさを打ち明けてくれてありがとう。支えになった考え方を探してみよう。",
        "{topic}について悩む瞬間も大切な経験だよ。そこから得た視点を一緒に整理しよう。",
      ],
      uncertain: [
        "{topic}をこれから形にしていく段階なんだね。印象に残る日々のシーンを一緒に拾ってみよう。",
        "{topic}のヒントになりそうな出来事を、時間をかけて探していこう。",
        "{topic}の輪郭をつかむために、心が動いた瞬間を少しずつ振り返ってみよう。",
      ],
    },
    deepening: {
      prompts: [
        "{context}で最近実践した具体的なエピソードを教えてもらえる？",
        "{context}を続けるために意識しているチームとの関わり方や工夫はある？",
        "{context}を通じて利用者さんや仲間に届けたい変化はどんなもの？",
      ],
      finalCue: "積み上げてきた実践とあり方が整理できたよ。次に進もう。",
    },
  },
};

function detectSentiment(text: string): Sentiment {
  const message = text.trim();
  if (!message) return "uncertain";
  const negativeWords = ["大変", "つら", "辛", "悩", "困", "疲", "難し", "不安", "しんど", "泣", "怒", "失敗", "迷惑"];
  const positiveWords = ["嬉", "楽", "うまく", "できた", "感謝", "良か", "助か", "喜", "充実", "誇り", "前向き", "成長"];
  const uncertainWords = ["わから", "迷", "どうすれ", "未定", "模索", "考え中"];

  if (uncertainWords.some((word) => message.includes(word))) {
    return "uncertain";
  }
  if (negativeWords.some((word) => message.includes(word))) {
    return "negative";
  }
  if (positiveWords.some((word) => message.includes(word))) {
    return "positive";
  }
  return "uncertain";
}

function buildEmpathyResponse(step: number, summary: string, cycleCount: number, sentiment: Sentiment): string {
  const config = STEP_CONVERSATION[step];
  const topic = summary ? `「${summary}」の話` : config?.topic ?? "話してくれた内容";
  const bank = config?.empathy?.[sentiment] ?? config?.empathy?.uncertain ?? [];
  const fallback = [
    `${topic}を丁寧に共有してくれてありがとう。感じていることを大事にしながら一緒に整理していこう。`,
    `${topic}からあなたの想いが伝わってきたよ。もう少し背景を深掘りしてみよう。`,
  ];
  const pool = bank.length ? bank : fallback;
  const index = Math.min(cycleCount, pool.length - 1);
  const template = pool[index] ?? pool[0];
  return template.replace("{topic}", topic);
}

function buildDeepeningPrompt(step: number, summary: string, cycleCount: number): string {
  const config = STEP_CONVERSATION[step];
  const context = summary ? `「${summary}」という経験` : config?.topic ?? "その経験";
  if (!config) {
    if (cycleCount >= MAX_CYCLES - 1) {
      return "共有してくれた内容で十分な具体性ありと判断できたよ。次に進もう。";
    }
    const generic = [
      `${context}で印象的だった場面を教えてくれる？`,
      `${context}のときに意識していたことはある？`,
      `${context}から得た学びを聞かせてほしいな。`,
    ];
    return generic[Math.min(cycleCount, generic.length - 1)];
  }
  if (cycleCount >= MAX_CYCLES - 1) {
    return config.deepening.finalCue;
  }
  const prompts = config.deepening.prompts;
  const index = Math.min(cycleCount, prompts.length - 1);
  return prompts[index].replace("{context}", context).replace("{summary}", summary || config.topic);
}

function buildGenerationPayload(step: number, history: string[], status: Status): Partial<Status> {
  const cleanHistory = normaliseHistory(history);
  if (step === 2) {
    return { can_text: composeCanText(cleanHistory) };
  }
  if (step === 3) {
    return { will_text: composeWillText(cleanHistory) };
  }
  if (step === 4) {
    return { must_have_text: composeMustText(cleanHistory, status.must_have_ids) };
  }
  if (step === 5) {
    return { self_text: composeSelfText(cleanHistory) };
  }
  if (step === 6) {
    const { doing, being } = composeDoingBeingTexts(cleanHistory);
    return { doing_text: doing, being_text: being };
  }
  return {};
}

function normaliseHistory(history: string[]): string[] {
  return history.map((entry) => entry.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function extractKeyPhrases(history: string[], limit: number): string[] {
  const phrases: string[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const summary = summariseUserMessage(history[i]).replace(/[。]/g, "").trim();
    if (summary && !phrases.includes(summary)) {
      phrases.unshift(summary);
    }
    if (phrases.length >= limit) break;
  }
  return phrases.slice(-limit);
}

function clampNarrative(text: string, min: number, max: number, pad: string): string {
  let result = text.trim();
  if (!result.endsWith("。")) {
    result += "。";
  }
  while (result.length < min) {
    result += pad;
  }
  if (result.length > max) {
    const truncated = result.slice(0, max);
    const lastPeriod = truncated.lastIndexOf("。");
    result = lastPeriod > min / 2 ? truncated.slice(0, lastPeriod + 1) : truncated;
  }
  return result;
}

function composeCanText(history: string[]): string {
  const phrases = extractKeyPhrases(history, 2);
  const highlight = phrases[phrases.length - 1] || "利用者さんの小さな変化に気づく力";
  const detail = phrases.length > 1 ? phrases[0] : "現場で積み重ねてきた丁寧な気づき";
  const base = `私は${highlight}を強みに、${detail}を通じて信頼を築いてきました。`;
  const closing = "これからも周囲と連携しながら価値を届けていきたい。";
  return clampNarrative(`${base}${closing}`, 60, 90, "仲間と協力しながら成長を続けていきたい。");
}

function composeWillText(history: string[]): string {
  const phrases = extractKeyPhrases(history, 3);
  const aspiration = phrases[phrases.length - 1] || "地域の生活を支える挑戦";
  const trigger = phrases.length > 1 ? phrases[phrases.length - 2] : "日々の支援で感じた変化";
  const base = `これからは${aspiration}に挑みたいと考えています。きっかけは${trigger}で、もっと力を活かしたいからです。`;
  const closing = "学び続けながら関わる人の選択肢を広げていきます。";
  return clampNarrative(`${base}${closing}`, 60, 90, "小さな前進も大切に歩んでいきます。");
}

function composeMustText(history: string[], ids: number[] | undefined): string {
  const phrases = extractKeyPhrases(history, 2);
  const reason = phrases.pop() || "利用者さんの安心を守るため";
  const detail = phrases.pop() || "現場との密な連携";
  const idText = Array.isArray(ids) && ids.length ? `（ID:${ids.join(",")})` : "";
  const base = `働くうえで欠かせないのは${detail}と制度を整えた環境です${idText}。`;
  const closing = `${reason}ことが、安心して支援するための条件だと考えています。`;
  return clampNarrative(`${base}${closing}`, 60, 90, "互いに信頼し合える体制を重視しています。");
}

function composeSelfText(history: string[]): string {
  const phrases = extractKeyPhrases(history, 4);
  const intro = phrases.shift() || "相手の声に耳を傾ける姿勢";
  const scene = phrases.shift() || "小さな変化を見逃さず支えた経験";
  const learning = phrases.shift() || "チームと一緒に答えを探す粘り強さ";
  const closing = phrases.shift() || "感謝を循環させる関わり";
  const base = `私は${intro}を大切にする人です。${scene}から、どんな状況でも寄り添う視点を学びました。`;
  const middle = `${learning}を軸に、関わる人の選択肢を広げたいと考えています。`;
  const tail = `これからも${closing}を意識しながら、自分らしく歩み続けます。`;
  return clampNarrative(`${base}${middle}${tail}`, 100, 280, "相手のペースを尊重する姿勢を忘れずにいたいです。" );
}

function composeDoingBeingTexts(history: string[]): { doing: string; being: string } {
  const phrases = extractKeyPhrases(history, 5);
  const doingFocus = phrases.slice(-3);
  const action = doingFocus[doingFocus.length - 1] || "利用者さんの表情や声色を丁寧に観察すること";
  const teamwork = doingFocus[doingFocus.length - 2] || "チームで情報を共有し迅速に動くこと";
  const improvement = doingFocus[doingFocus.length - 3] || "日々の振り返りから改善を積み重ねること";
  const doingParagraphs = [
    `私は現場で${action}を心掛け、変化の兆しを逃さないようにしています。`,
    `${teamwork}、${improvement}を通じてサービスの質を高め続けています。`
      + "これからも学びを取り入れ、支援の幅を広げていきます。",
  ];
  const beingFocus = phrases.slice(0, 3);
  const value1 = beingFocus[0] || "誰もが安心して想いを語れる空気をつくること";
  const value2 = beingFocus[1] || "相手の選択を尊重し寄り添う姿勢";
  const value3 = beingFocus[2] || "感謝を循環させる対話";
  const beingParagraphs = [
    `私は${value1}を目指し、${value2}を軸に関わりたいと考えています。`,
    `${value3}を大切にしながら、一緒に未来を描ける伴走者であり続けます。`
      + "これからも安心と挑戦が両立する場を育んでいきます。",
  ];

  const doing = clampLongNarrative(doingParagraphs, 300, 20);
  const being = clampLongNarrative(beingParagraphs, 300, 20);
  return { doing, being };
}

function clampLongNarrative(paragraphs: string[], target: number, tolerance: number): string {
  const pad = "現場の声を受け止めながら前進していきます。";
  let result = paragraphs.join("\n");
  while (result.length < target - tolerance) {
    result = `${result} ${pad}`.trim();
  }
  if (result.length > target + tolerance) {
    const maxLength = target + tolerance;
    const truncated = result.slice(0, maxLength);
    const lastPeriod = truncated.lastIndexOf("。");
    const lastNewline = truncated.lastIndexOf("\n");
    let cutoff = Math.max(lastPeriod, lastNewline);
    if (cutoff <= 0) {
      cutoff = maxLength;
    }
    result = truncated.slice(0, cutoff + 1);
  }
  const newlineCount = (result.match(/\n/g) || []).length;
  if (newlineCount > 2) {
    const collapsed = result.replace(/\n/g, " ");
    return clampNarrative(collapsed, target - tolerance, target + tolerance, pad);
  }
  return result.trimEnd();
}
