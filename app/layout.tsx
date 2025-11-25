import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "AIキャリアデザイナー ほーぷちゃん",
  description: "AIがあなたのキャリアをサポートします",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
