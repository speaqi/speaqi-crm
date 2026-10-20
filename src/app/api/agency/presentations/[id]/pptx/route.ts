import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { agencyRoute, getSettings, loadPresentation, loadProject } from '@/lib/server/agency'
import { AGENCY_BUCKET } from '@/lib/server/agency-assets'
import { buildPptx } from '@/lib/server/agency-pptx'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { fileStem, normalizeClientBrand, normalizeSlides, normalizeTheme, quoteSummary } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** pptxgenjs vuole "image/jpeg;base64,…", senza il prefisso "data:". */
async function imageData(buffer: Buffer, kind: 'photo' | 'logo') {
  try {
    const { default: sharp } = await import('sharp')
    if (kind === 'logo') return `image/png;base64,${(await sharp(buffer).resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64')}`
    return `image/jpeg;base64,${(await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`
  } catch {
    return null
  }
}

async function speaqiLogos() {
  try {
    const dir = path.join(process.cwd(), 'public', 'deck')
    const [light, dark] = await Promise.all([readFile(path.join(dir, 'logo.png')), readFile(path.join(dir, 'logo-on-color.png'))])
    return { light: `image/png;base64,${light.toString('base64')}`, dark: `image/png;base64,${dark.toString('base64')}` }
  } catch {
    return null
  }
}

/** PowerPoint modificabile: testi in caselle vere, grafico nativo, foto sostituibili. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const project = await loadProject(auth.supabase, auth.user.id, row.project_id)
    const service = createServiceRoleClient()
    const slides = normalizeSlides(row.slides)
    const theme = normalizeTheme(row.theme)
    const brand = normalizeClientBrand(project.client_brand)
    const wanted = new Set(slides.map((s) => s.image_asset_id).filter(Boolean) as string[])
    if (theme.client_logo && brand.logo_asset_id) wanted.add(brand.logo_asset_id)
    const images: Record<string, string> = {}
    let clientLogo: string | null = null
    for (const asset of project.assets.filter((a) => wanted.has(a.id))) {
      const file = await service.storage.from(AGENCY_BUCKET).download(asset.path)
      if (file.error || !file.data) continue
      const data = await imageData(Buffer.from(await file.data.arrayBuffer()), asset.id === brand.logo_asset_id ? 'logo' : 'photo')
      if (!data) continue
      if (asset.id === brand.logo_asset_id) clientLogo = data
      else images[asset.id] = data
    }
    const quote = row.quote_id
      ? quoteSummary((await auth.supabase.from('quotes').select('*').eq('user_id', row.user_id).eq('id', row.quote_id).maybeSingle()).data)
      : null
    const settings = await getSettings(auth.supabase, row.user_id)
    const file = await buildPptx({
      title: row.title,
      slides,
      theme,
      clientName: project.client_name,
      agencyName: settings.name,
      agencySignature: settings.signature,
      quote,
      images,
      clientLogo,
      speaqiLogo: await speaqiLogos()
    })
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fileStem(row.title)}.pptx"`,
        'Cache-Control': 'private, no-store'
      }
    })
  })
}
