import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { deliverOfficeNews } from '@/lib/server/office-news-delivery'

export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}) {
  return officeOwnerRoute(request,async({admin,userId})=>{
    const body=await request.text();if(body.trim()&&body.trim()!=='{}') return Response.json({error:'Nessun destinatario o workspace ammesso nel corpo'},{status:400})
    const {id}=await context.params
    if(!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({error:'Uscita non valida'},{status:400})
    return Response.json(await deliverOfficeNews(admin,userId,id))
  })
}
