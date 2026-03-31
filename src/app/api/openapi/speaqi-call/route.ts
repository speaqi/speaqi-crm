import { createSpeaqiCallOpenApi } from '@/lib/openapi/speaqi-call'

export async function GET(request: Request) {
  const url = new URL(request.url)
  return Response.json(createSpeaqiCallOpenApi(url.origin))
}
