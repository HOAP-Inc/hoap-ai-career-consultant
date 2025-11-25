import { NextResponse, type NextRequest } from "next/server"

import chatHandler from "@/lib/chat-handler"

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Next.js 15のRoute Handlerでは、requestとresponseの形式が異なるため、
  // 旧ハンドラー用にアダプターを作成
  const body = await request.json()
  
  // レスポンスオブジェクトのモック（旧ハンドラーがres.status().json()を使うため）
  let responseData: Record<string, unknown> | undefined
  let statusCode = 200
  const headers: Record<string, string> = {}

  const mockRes = {
    json: (data: unknown) => {
      responseData = data as Record<string, unknown> | undefined
    },
    setHeader: (key: string, value: string) => {
      headers[key] = value
    },
    status: (code: number) => ({
      end: () => {
        statusCode = code
      },
      json: (data: unknown) => {
        statusCode = code
        responseData = data as Record<string, unknown> | undefined
      },
    }),
  }
  
  // チャットハンドラーを呼び出し
  await chatHandler(
    {
      body,
      json: async () => body,
      method: request.method,
    },
    mockRes,
  )
  
  // Next.js 15形式のレスポンスを返す
  return NextResponse.json(responseData, {
    status: statusCode,
    headers,
  })
}

export async function OPTIONS() {
  return new NextResponse(undefined, {
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    status: 204,
  })
}
