import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  const useCdn = process.env.NEXT_PUBLIC_TW_CDN === '1' // 必要なときだけON
  return (
    <Html lang="ja">
      <Head>
        {/* Tailwind CDN フォールバック（必要時のみ有効化） */}
        {useCdn && (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script src="https://cdn.tailwindcss.com"></script>
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
