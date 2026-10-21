'use client'

import { useEffect, useRef, useState } from 'react'
import { agencyHtml } from '@/lib/agency-deck'
import type { DeckSlide } from '@/lib/tourism-deck'

/** The Agency preview uses the same editorial layout as its HTML export. */
export default function AgencyPlayer({ slides, client, index }: { slides: DeckSlide[]; client: string; index: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setScale(el.clientWidth / 1920))
    observer.observe(el)
    setScale(el.clientWidth / 1920)
    return () => observer.disconnect()
  }, [])
  const html = agencyHtml(client, slides).replace('</style>', `
@font-face{font-family:'Bricolage Grotesque';font-weight:800;src:url('/deck/bricolage-grotesque-latin-800-normal.woff2')}
@font-face{font-family:Inter;src:url('/deck/inter-latin-400-normal.woff2')}
h1,h2,h3{font-weight:800}header img{height:58px;vertical-align:middle;margin-right:14px}
@media screen{body{overflow:hidden;background:#faf7ed}section{zoom:1;margin:0;display:none}section:nth-of-type(${Math.max(0, Math.min(slides.length - 1, index)) + 1}){display:flex}}
</style>`).replaceAll('<header>speaqi <span>Agency</span></header>', '<header><img src="/deck/logo.png" alt="Speaqi" class="on-light"><img src="/deck/logo-on-color.png" alt="Speaqi" class="on-dark"> Agency</header>').replace('</style>', '.on-dark{display:none}.dark .on-dark{display:inline}.dark .on-light{display:none}</style>')
  return <div ref={box} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', background: '#faf7ed', border: '1px solid #d8d9d4' }}>
    <iframe title={`Anteprima Agency: slide ${index + 1}`} sandbox="allow-same-origin" srcDoc={html} style={{ position: 'absolute', width: 1920, height: 1080, border: 0, top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
  </div>
}
