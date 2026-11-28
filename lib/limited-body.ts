export async function readLimitedBody(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get('content-length'))
  if (declared > maxBytes) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        parts.push(decoder.decode())
        return parts.join('')
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }
}
