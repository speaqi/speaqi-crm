import { getGmailConfigStatus } from '@/lib/server/gmail'

export async function GET() {
  const gmail = getGmailConfigStatus()

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      gmail: {
        configured: gmail.configured,
        env: gmail.present,
        missing: gmail.missing,
      },
    },
  })
}
