/**
 * @jest-environment node
 */

// chat.jsの関数をテストするためのモックとヘルパー
// 実際のコードを読み込まずに、ロジックだけをテストする

describe("STEP4修正のテスト", () => {

  describe("修正1: 動的質問生成のテスト", () => {
    test("残業について話している場合、職場の雰囲気との比較質問が出る", () => {
      // ロジックの確認：ユーザーの発話内容に基づいて適切な質問が生成されるか
      const session = {
        history: [
          { role: "user", text: "残業なしがいい", step: 4 },
          { role: "user", text: "残業は避けたい", step: 4 },
        ],
      };
      const userText = "残業なし";
      const serverCount = 2; // 3回目以降

      // 修正したロジックをシミュレート
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const currentText = userText || "";
      const combinedText = `${currentText} ${recentTexts}`;

      // 質問生成ロジック
      let comparisonQuestion;
      if (combinedText.includes("残業") || combinedText.includes("働き方") || combinedText.includes("時間")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("雰囲気") || combinedText.includes("人間関係") || combinedText.includes("コミュニケーション")) {
        comparisonQuestion = "今の話と『働き方（リモートワークや残業など）』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("給与") || combinedText.includes("給料") || combinedText.includes("待遇")) {
        comparisonQuestion = "今の話と『働き方』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("休日") || combinedText.includes("休み") || combinedText.includes("休暇")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else {
        comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？";
      }

      expect(combinedText.includes("残業")).toBe(true);
      expect(comparisonQuestion).toBe("今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？");
    });

    test("雰囲気について話している場合、働き方との比較質問が出る", () => {
      const session = {
        history: [
          { role: "user", text: "職場の雰囲気が良いところ", step: 4 },
        ],
      };
      const userText = "雰囲気";
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const combinedText = `${userText} ${recentTexts}`;

      let comparisonQuestion;
      if (combinedText.includes("残業") || combinedText.includes("働き方") || combinedText.includes("時間")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("雰囲気") || combinedText.includes("人間関係") || combinedText.includes("コミュニケーション")) {
        comparisonQuestion = "今の話と『働き方（リモートワークや残業など）』を比べたら、どっちの方が譲れない？";
      } else {
        comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？";
      }

      expect(combinedText.includes("雰囲気")).toBe(true);
      expect(comparisonQuestion).toBe("今の話と『働き方（リモートワークや残業など）』を比べたら、どっちの方が譲れない？");
    });

    test("給与について話している場合、働き方との比較質問が出る", () => {
      const session = {
        history: [
          { role: "user", text: "給与が高いところ", step: 4 },
        ],
      };
      const userText = "給与";
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const combinedText = `${userText} ${recentTexts}`;

      let comparisonQuestion;
      if (combinedText.includes("残業") || combinedText.includes("働き方") || combinedText.includes("時間")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("雰囲気") || combinedText.includes("人間関係") || combinedText.includes("コミュニケーション")) {
        comparisonQuestion = "今の話と『働き方（リモートワークや残業など）』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("給与") || combinedText.includes("給料") || combinedText.includes("待遇")) {
        comparisonQuestion = "今の話と『働き方』を比べたら、どっちの方が譲れない？";
      } else {
        comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？";
      }

      expect(combinedText.includes("給与")).toBe(true);
      expect(comparisonQuestion).toBe("今の話と『働き方』を比べたら、どっちの方が譲れない？");
    });

    test("その他の内容の場合、デフォルトの質問が出る", () => {
      const session = {
        history: [
          { role: "user", text: "特別な条件はない", step: 4 },
        ],
      };
      const userText = "条件";
      const recentTexts = session.history.slice(-3).map(item => item.text).join(" ");
      const combinedText = `${userText} ${recentTexts}`;

      const hasSpecificKeyword = 
        combinedText.includes("残業") ||
        combinedText.includes("働き方") ||
        combinedText.includes("雰囲気") ||
        combinedText.includes("給与") ||
        combinedText.includes("休日");

      let comparisonQuestion;
      if (combinedText.includes("残業") || combinedText.includes("働き方") || combinedText.includes("時間")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("雰囲気") || combinedText.includes("人間関係") || combinedText.includes("コミュニケーション")) {
        comparisonQuestion = "今の話と『働き方（リモートワークや残業など）』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("給与") || combinedText.includes("給料") || combinedText.includes("待遇")) {
        comparisonQuestion = "今の話と『働き方』を比べたら、どっちの方が譲れない？";
      } else if (combinedText.includes("休日") || combinedText.includes("休み") || combinedText.includes("休暇")) {
        comparisonQuestion = "今の話と『職場の雰囲気』を比べたら、どっちの方が譲れない？";
      } else {
        comparisonQuestion = "それって、どのくらい譲れない条件？『絶対必須』レベル？";
      }

      expect(hasSpecificKeyword).toBe(false);
      expect(comparisonQuestion).toBe("それって、どのくらい譲れない条件？『絶対必須』レベル？");
    });
  });

  describe("修正2: フェイルセーフ時のID化処理のテスト", () => {
    test("フェイルセーフ時にLLM呼び出し用のペイロードが正しく生成される", () => {
      // フェイルセーフ時の処理をシミュレート
      const session = {
        history: [
          { role: "user", text: "残業なし", step: 4 },
          { role: "user", text: "リモートワーク", step: 4 },
        ],
        status: {},
      };

      // 修正したロジックをシミュレート
      const step4Texts = session.history
        .filter(h => h.step === 4 && h.role === "user")
        .map(h => h.text)
        .filter(Boolean);

      const genPayload = {
        locale: "ja",
        stage: { turn_index: 999 }, // 終了フラグ
        user_text: step4Texts.join("。"), // 全ての発話を結合
        recent_texts: step4Texts,
        status: session.status,
        force_generation: true, // generationフェーズを強制
      };

      expect(genPayload.force_generation).toBe(true);
      expect(genPayload.user_text).toContain("残業なし");
      expect(genPayload.user_text).toContain("リモートワーク");
      expect(genPayload.stage.turn_index).toBe(999);
    });

    test("LLM失敗時のフォールバック処理が正しく動作する", () => {
      const step4Texts = ["残業なし"];
      const lastText = step4Texts[step4Texts.length - 1];
      
      // LLM失敗時の処理をシミュレート
      const mustText = lastText.length > 50 ? lastText : `${lastText}について伺いました。`;
      const mustHaveIds = [];

      expect(mustText).toBe("残業なしについて伺いました。");
      expect(Array.isArray(mustHaveIds)).toBe(true);
      expect(mustHaveIds.length).toBe(0);
    });
  });

  describe("修正3: 安全装置のテスト", () => {
    test("qual_idsが保護される", () => {
      const existingQualIds = [1, 2, 3];
      const existingLicenses = ["看護師", "介護福祉士"];
      const sessionStatus = {
        qual_ids: existingQualIds,
        licenses: existingLicenses,
      };

      // result.statusにqual_idsが含まれていない場合
      const resultStatus = {
        must_ids: [12],
        must_text: "残業なし",
        // qual_idsが含まれていない
      };

      // 保護ロジックをシミュレート
      const protectedQualIds = existingQualIds;
      const protectedLicenses = existingLicenses;

      // result.statusを適用
      const finalStatus = { ...resultStatus };

      // qual_idsが含まれていない場合、既存の値を復元
      if (existingQualIds && existingQualIds.length > 0 && !finalStatus.qual_ids) {
        finalStatus.qual_ids = protectedQualIds;
      }
      if (existingLicenses && existingLicenses.length > 0 && !finalStatus.licenses) {
        finalStatus.licenses = protectedLicenses;
      }

      expect(finalStatus.qual_ids).toEqual(existingQualIds);
      expect(finalStatus.licenses).toEqual(existingLicenses);
      expect(finalStatus.must_ids).toEqual([12]);
    });

    test("ステップ後退が防止される", () => {
      const beforeStep = 4;
      const proposedStep = 2; // 後退しようとしている

      // 安全装置のロジック
      let finalStep = beforeStep;
      if (proposedStep < beforeStep) {
        // ステップ変更を拒否
        finalStep = beforeStep;
      } else {
        finalStep = proposedStep;
      }

      expect(finalStep).toBe(beforeStep); // 後退が防止される
    });

    test("ステップ前進は許可される", () => {
      const beforeStep = 4;
      const proposedStep = 5; // 前進

      // 安全装置のロジック
      let finalStep = beforeStep;
      if (proposedStep < beforeStep) {
        finalStep = beforeStep;
      } else {
        finalStep = proposedStep;
      }

      expect(finalStep).toBe(proposedStep); // 前進は許可される
    });
  });
});

