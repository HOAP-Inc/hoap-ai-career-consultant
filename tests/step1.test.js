const { callApi } = require("./test-utils");

describe("STEP1 資格判定", () => {
  afterEach(() => {
    delete global.__TEST_LLM__;
  });

  test("TC1: 正看護師は即時ID化", async () => {
    const { body, statusCode } = await callApi("tc1", "正看護師");
    expect(statusCode).toBe(200);
    expect(body.status.qual_ids).toEqual([1]);
    expect(body.meta.step).toBe(2);
  });

  test("TC2: ナースはaliasで自動ID化", async () => {
    const { body } = await callApi("tc2", "ナース");
    expect(body.status.qual_ids).toEqual([1]);
    expect(body.meta.step).toBe(2);
  });

  test("TC3: 看護は選択肢提示", async () => {
    const { body } = await callApi("tc3", "看護");
    expect(body.drill.awaitingChoice).toBe(true);
    expect(body.drill.options).toEqual(expect.arrayContaining(["正看護師", "准看護師"]));
    expect(body.response).toContain("［正看護師］／［准看護師］");
    expect(body.meta.step).toBe(1);
  });

  test("TC4: 未検出は再入力促し", async () => {
    const { body } = await callApi("tc4", "xyz資格");
    expect(body.meta.step).toBe(1);
    expect(body.response).toContain("正式名称で教えてみて");
  });

  test("TC5: 選択肢から准看護師を選ぶ", async () => {
    const sessionId = "tc5";
    const first = await callApi(sessionId, "看護");
    expect(first.body.drill.awaitingChoice).toBe(true);
    const second = await callApi(sessionId, "准看護師");
    expect(second.body.status.qual_ids).toEqual([2]);
    expect(second.body.meta.step).toBe(2);
  });
});
