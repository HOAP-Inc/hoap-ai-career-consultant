# HOAP AI キャリアデザイナー v2 会話エンジン

本リポジトリには Next.js 製の「HOAP AI キャリアデザイナー」アプリケーションが含まれています。`/api/v2/chat` では v2 仕様の会話エンジンを提供します。

## セットアップと起動

```bash
npm install
npm run dev
```

開発モードでは `http://localhost:3000/api/v2/chat` に POST すると API を呼び出せます。

## API リクエスト形式

```json
{
  "userMessage": "string",
  "status": { /* Status 型 */ },
  "meta": { "step": 2, "phase": "intro" },
  "sessionId": "任意のセッション ID"
}
```

レスポンスは常に `{ "status": {…}, "meta": {…}, "response?": "..." }` 形式になります。`response` は会話フェーズのみ返却され、生成フェーズでは省略されます。

## LLM 呼び出しスタブの差し替え

`src/engine/flow-v2.ts` の `callLLM` 関数が LLM 呼び出しスタブです。現在は決め打ちの JSON を返す擬似実装になっています。実際の LLM を利用する際はこの関数を置き換えてください。

```ts
async function callLLM(_prompt: string, input: LLMInput): Promise<string> {
  // TODO: 外部 LLM 呼び出しに差し替え
}
```

スタブは `readPrompt(step)` で読み込んだプロンプト本文（`/prompts` 配下）を受け取り、`input` にはユーザー入力やフェーズ情報が渡されます。戻り値は JSON 文字列で返却してください。

## 旧ロジックの再利用

- STEP1 の資格 ID 変換は `src/engine/legacy/step1-adapter.ts`
- STEP4 の Must 条件 ID 寄せは `src/engine/legacy/step4-adapter.ts`

いずれも旧仕様のロジックを TypeScript へ移植したラッパーで、必要に応じて拡張できます。

## 本番環境へのデプロイ

このリポジトリは Vercel でのデプロイを想定しています。`main` ブランチへマージすると Vercel 側の自動デプロイが走る構成であれば、基本的にはそれだけで最新の変更が本番へ反映されます。

手元から直接本番デプロイを行いたい場合は Vercel CLI を利用してください。

```bash
# 1. Vercel へログイン（初回のみ）
npx vercel login

# 2. このプロジェクトと Vercel を紐付け（初回のみ）
npx vercel link

# 3. 本番用の環境変数を取得（必要なら）
npx vercel pull --environment=production

# 4. 念のためビルド確認
npm run build

# 5. 本番へ反映
npx vercel deploy --prod
```

CLI を実行した端末に Vercel のチーム／プロジェクトへのアクセス権限が必要です。`--prod` を付与することでプレビューではなく本番エイリアスへ直接公開されます。
