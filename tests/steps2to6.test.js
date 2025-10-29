const { callApi } = require("./test-utils");

async function progressToStep(sessionId, targetStep) {
  await callApi(sessionId, "正看護師");
  if (targetStep === 2) return;

  global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
    empathy: "ふむふむ、自然にできるんだね。",
    paraphrase: "利用者に寄り添う姿勢",
    ask_next: null,
    meta: { step: 3 },
  }));
  await callApi(sessionId, "現場で利用者に寄り添うのが得意です");
  delete global.__TEST_LLM__;
  if (targetStep === 3) return;

  global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
    status: { will_text: "訪問看護で暮らしを支えたい" },
    meta: { step: 4 },
  }));
  await callApi(sessionId, "在宅の人を支えたい");
  delete global.__TEST_LLM__;
  if (targetStep === 4) return;

  global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
    status: {
      must_ids: [12],
      ng_ids: [],
      pending_ids: [],
      direction_map: { "12": "have" },
      status_bar: "ID:12/have",
      must_text: "夜勤なしで利用者と向き合える職場が必須",
    },
    meta: { step: 5, deepening_attempt_total: 1 },
  }));
  await callApi(sessionId, "夜勤なしで利用者と向き合いたい");
  delete global.__TEST_LLM__;
  if (targetStep === 5) return;

  global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
    status: { self_text: "私は「寄り添う」瞬間を大切に動く人" },
    meta: { step: 6 },
  }));
  await callApi(sessionId, "私は「寄り添う」って言葉が似合うと言われます");
  delete global.__TEST_LLM__;
  if (targetStep === 6) return;
}

describe("STEP2〜STEP6", () => {
  afterEach(() => {
    delete global.__TEST_LLM__;
  });

  test("STEP2 正常系", async () => {
    const sessionId = "step2-ok";
    await callApi(sessionId, "正看護師");
    global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
      empathy: "あ、その感覚いいね。",
      paraphrase: "状況対応力",
      ask_next: "一番活きた場面をもう少し教えて。",
      meta: { step: 3 },
    }));
    const { body } = await callApi(sessionId, "どんな現場でも状況に合わせて動けます");
    expect(body.response).toContain("あ、その感覚いいね。");
    expect(body.response).toContain("一番活きた場面");
    expect(body.status.can_text).toBe("状況対応力");
    expect(body.meta.step).toBe(3);
  });

  test("STEP2 異常系", async () => {
    const sessionId = "step2-ng";
    await callApi(sessionId, "正看護師");
    global.__TEST_LLM__ = jest.fn(() => "not-json");
    const { body } = await callApi(sessionId, "看取りが得意です");
    expect(body.meta.step).toBe(2);
    expect(body.meta.error).toBe("schema_mismatch");
    expect(body.response).toContain("エラーが起きた");
  });

  test("STEP3 正常系", async () => {
    const sessionId = "step3-ok";
    await progressToStep(sessionId, 3);
    global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
      status: { will_text: "訪問看護で家庭の暮らしを支えたい" },
      meta: { step: 4 },
    }));
    const { body } = await callApi(sessionId, "もっと利用者の生活に踏み込みたい");
    expect(body.status.will_text).toBe("訪問看護で家庭の暮らしを支えたい");
    expect(body.meta.step).toBe(4);
  });

  test("STEP3 異常系", async () => {
    const sessionId = "step3-ng";
    await progressToStep(sessionId, 3);
    global.__TEST_LLM__ = jest.fn(() => "oops");
    const { body } = await callApi(sessionId, "訪問看護をやってみたい");
    expect(body.meta.step).toBe(3);
    expect(body.meta.error).toBe("schema_mismatch");
    expect(body.response).toContain("Willの生成でエラー");
  });

  test("STEP4 正常系", async () => {
    const sessionId = "step4-ok";
    await progressToStep(sessionId, 4);
    global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
      status: {
        must_ids: [12],
        ng_ids: [35],
        pending_ids: [],
        direction_map: { "12": "have", "35": "ng" },
        status_bar: "ID:12/have,ID:35/ng",
        must_text: "訪問看護で夜勤なしの環境が絶対条件。人手不足の現場は避けたい。",
      },
      meta: { step: 5, deepening_attempt_total: 2 },
    }));
    const { body } = await callApi(sessionId, "夜勤は避けたいし人手不足は無理");
    expect(body.status.must_have_ids).toEqual([12]);
    expect(body.status.ng_ids).toEqual([35]);
    expect(body.meta.step).toBe(5);
    expect(body.meta.deepening_attempt_total).toBe(2);
  });

  test("STEP4 異常系", async () => {
    const sessionId = "step4-ng";
    await progressToStep(sessionId, 4);
    global.__TEST_LLM__ = jest.fn(() => "error");
    const { body } = await callApi(sessionId, "夜勤は避けたい");
    expect(body.meta.step).toBe(4);
    expect(body.meta.error).toBe("schema_mismatch");
    expect(body.response).toContain("Mustの整理に失敗");
  });

  test("STEP5 正常系", async () => {
    const sessionId = "step5-ok";
    await progressToStep(sessionId, 5);
    global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
      status: { self_text: "私は「寄り添う」時間を一番大事にする人" },
      meta: { step: 6 },
    }));
    const { body } = await callApi(sessionId, "周りからは「寄り添う人」と言われます");
    expect(body.status.self_text).toBe("私は「寄り添う」時間を一番大事にする人");
    expect(body.meta.step).toBe(6);
  });

  test("STEP5 異常系", async () => {
    const sessionId = "step5-ng";
    await progressToStep(sessionId, 5);
    global.__TEST_LLM__ = jest.fn(() => "oops");
    const { body } = await callApi(sessionId, "寄り添う人って言われます");
    expect(body.meta.step).toBe(5);
    expect(body.meta.error).toBe("schema_mismatch");
    expect(body.response).toContain("Selfの生成で少しつまずいた");
  });

  test("STEP6 正常系", async () => {
    const sessionId = "step6-ok";
    await progressToStep(sessionId, 6);
    global.__TEST_LLM__ = jest.fn(() => JSON.stringify({
      status: {
        doing_text: "私は訪問の場面で利用者の暮らしを整える行動を続ける",
        being_text: "私は「寄り添う」姿勢で相手の声を聞き、安心をつくる存在でいたい",
      },
      meta: { step: 7 },
    }));
    const { body } = await callApi(sessionId, "まとめてみて");
    expect(body.status.doing_text).toContain("訪問の場面");
    expect(body.status.being_text).toContain("寄り添う");
    expect(body.meta.step).toBe(7);
  });

  test("STEP6 異常系", async () => {
    const sessionId = "step6-ng";
    await progressToStep(sessionId, 6);
    global.__TEST_LLM__ = jest.fn(() => "fail");
    const { body } = await callApi(sessionId, "お願いします");
    expect(body.meta.step).toBe(6);
    expect(body.meta.error).toBe("schema_mismatch");
    expect(body.response).toContain("Doing/Being の生成に失敗");
  });
});
