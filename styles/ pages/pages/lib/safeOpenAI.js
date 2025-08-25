import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function chatOnce({ system, user, max_tokens = 300, temperature = 0.2 }) {
  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens,
    temperature,
  }

  const attempt = async (i) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25000)
    try {
      const r = await client.chat.completions.create(body, { signal: ctrl.signal })
      return r.choices?.[0]?.message?.content?.trim() || ''
    } catch (e) {
      if ((e.status === 429 || e.status >= 500) && i < 3) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** i))
        return attempt(i + 1)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
  return attempt(0)
}
