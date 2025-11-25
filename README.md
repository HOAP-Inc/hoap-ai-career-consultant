# AIキャリアデザイナー ほーぷちゃん

医療・介護業界向けのAIキャリアコンサルタントアプリです。ユーザーとの対話を通じて、資格、Can（できること）、Will（やりたいこと）、Must（譲れない条件）、Self（自分らしさ）を整理し、最終的にキャリアシートを生成します。

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript
- **AI**: OpenAI GPT-4o / GPT-4o-mini
- **セッション管理**: Vercel KV
- **スタイリング**: カスタムCSS（Tailwind CSS v4ベース）

## ディレクトリ構造

```
app/
  ├── api/chat/route.ts    # チャットAPIエンドポイント
  ├── layout.tsx           # ルートレイアウト
  ├── page.tsx             # メインチャット画面
  └── globals.css          # カスタムCSS
lib/
  ├── constants.ts         # 定数とヘルパー関数
  ├── types.ts             # TypeScript型定義
  ├── legacy-chat-handler.js  # 旧APIロジック（3500行）
  ├── data/                # マスターデータ
  │   ├── qualifications.json
  │   ├── licenses.json
  │   └── tags.json
  └── prompts/             # LLMプロンプト
      ├── common_instructions.txt
      ├── llm_brake_system.txt
      ├── polarity_rulebook.txt
      └── step{1-6}_*.txt
public/
  ├── beam-bg.png          # 3D背景画像
  └── hoap-*.png           # ほーぷちゃんの画像
```

## 環境変数

| 変数 | 必須 | 説明 |
| ---- | ---- | ---- |
| `OPENAI_API_KEY` | ✅ | OpenAI APIキー |
| `KV_REST_API_URL` | ✅ | Vercel KV REST API URL |
| `KV_REST_API_TOKEN` | ✅ | Vercel KV REST API トークン |

`.env.local` を作成して設定してください。

## 開発コマンド

```bash
# 開発サーバー起動（ポート3003）
pnpm dev

# ビルド
pnpm build

# Lint
pnpm lint

# 型チェック
pnpm check-types
```

## 会話フロー

1. **STEP1: 資格入力** - 保有資格を入力
2. **STEP2: Can（できること）** - 経験と強みを整理
3. **STEP3: Will（やりたいこと）** - 今後の挑戦を整理
4. **STEP4: Must（譲れない条件）** - 労働条件を整理
5. **STEP5: Self（自分らしさ）** - 自己理解を深める
6. **STEP6: DoingBeing生成** - AIがキャリアシートを生成

## アーキテクチャ

### ハイブリッドアプローチ

- **フロントエンド**: TypeScript + React（App Router）
- **バックエンド**: 旧JavaScript APIロジックを`legacy-chat-handler.js`として保持
- **理由**: 3500行の複雑なLLMプロンプトとステート管理ロジックを安全に移行するため

### 主要コンポーネント

- `app/page.tsx`: チャットUI、アニメーション、ステート管理
- `app/api/chat/route.ts`: Next.js Route Handler（アダプター）
- `lib/legacy-chat-handler.js`: 旧APIロジック（LLM呼び出し、セッション管理、ステップ制御）

## 注意事項

- `lib/legacy-chat-handler.js`は旧Pages Router APIから移植したJavaScriptファイルです。TypeScriptへの完全移行は将来のタスクです。
- プロンプトファイル（`lib/prompts/*.txt`）とマスターデータ（`lib/data/*.json`）は本番環境で必須です。
- ほーぷちゃんの画像アニメーションは`app/page.tsx`のuseEffectで制御されています。

## トラブルシューティング

### STEP2でエラーが出る

- OpenAI APIキーが正しく設定されているか確認
- `lib/data/licenses.json`が存在するか確認

### UIが表示されない

- `app/layout.tsx`が`./globals.css`をインポートしているか確認
- `public/beam-bg.png`と`public/hoap-*.png`が存在するか確認

### セッションが保存されない

- Vercel KV環境変数（`KV_REST_API_URL`, `KV_REST_API_TOKEN`）が設定されているか確認
