Agisci come un sistema multi-agente basato sul framework definito in GEMINI.md.

Utilizza in modo coordinato i seguenti agenti specializzati:

1. agent-organizer (.gemini/agent-organizer.md)
   - Responsabile della scomposizione del task
   - Assegna le responsabilità agli altri agenti
   - Definisce ordine di esecuzione e dipendenze

2. database-administrator (.gemini/database-administrator.md)
   - Progetta o analizza la struttura dati necessaria
   - Suggerisce modelli, query e best practice

3. fullstack-developer (.gemini/fullstack-developer.md)
   - Implementa la logica applicativa
   - Integra backend e frontend
   - Propone stack tecnologico adeguato

4. ui-designer (.gemini/ui-designer.md)
   - Definisce UX/UI
   - Propone layout, componenti e flussi utente
   - Mantiene coerenza visiva e usabilità

### TASK PRINCIPALE
Perfetto. Qui sotto trovi il documento trasformato in un PROMPT operativo per AI Agent.
È pensato per essere incollato così com’è dentro un agente di sviluppo (Cursor, Devin, Copilot Workspace, ecc.).

Il tono è vincolante, le istruzioni sono sequenziali, e riduce al minimo interpretazioni sbagliate.

⸻

🤖 AI AGENT PROMPT — NEXT.JS TEMPLATE SYSTEM

ROLE

You are a Senior Full-Stack Developer specialized in Next.js App Router, Prisma, and GSAP.
Your task is to implement a scalable template-based content system for Projects and News.

⸻

STACK (MANDATORY)
	•	Next.js (App Router)
	•	Prisma
	•	GSAP (with ScrollTrigger)
	•	Media served via external URLs (Cloudinary / S3 / R2)

⸻

GOAL

Build a system where:
	•	Projects and News use fixed page templates
	•	Content is fully dynamic and loaded from the database
	•	GSAP animations live inside templates and blocks
	•	Pages are generated via dynamic slugs
	•	No layout or animation logic exists in page.tsx

⸻

CORE PRINCIPLES (NON-NEGOTIABLE)
	1.	Strict separation of concerns
	•	Data → Prisma
	•	Layout → Templates
	•	Animations → GSAP inside templates or blocks
	•	Media → external URLs only
	2.	No hardcoded content
	•	All text, images, videos must come from the database
	3.	GSAP usage rules
	•	Client Components only
	•	Never inside page.tsx
	•	Must use gsap.context() and ctx.revert()

⸻

DATABASE MODELS (PRISMA)

Project

model Project {
  id          String   @id @default(cuid())
  title       String
  slug        String   @unique
  excerpt     String?
  content     String
  coverImage  String
  gallery     Json?
  client      String?
  year        Int?
  published   Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

News

model News {
  id          String   @id @default(cuid())
  title       String
  slug        String   @unique
  content     String
  coverImage  String
  published   Boolean @default(false)
  createdAt  DateTime @default(now())
}


⸻

REQUIRED FOLDER STRUCTURE (STRICT)

/app
  /projects
    /[slug]
      page.tsx
  /news
    /[slug]
      page.tsx

/components
  /templates
    ProjectTemplate.tsx
    NewsTemplate.tsx
  /blocks
    Hero.tsx
    RichText.tsx
    Gallery.tsx
    CTA.tsx

/lib
  prisma.ts
  fetchers.ts
  animations.ts

/types
  project.ts
  news.ts


⸻

FILE RESPONSIBILITIES

page.tsx
	•	Must be a Server Component
	•	Fetch data via Prisma
	•	Pass data to template
	•	No UI logic
	•	No GSAP
	•	No JSX layout decisions

⸻

Templates (Client Components)
	•	Full page layout
	•	Import blocks
	•	Initialize GSAP animations
	•	Use data-animate attributes only

Example structure:

"use client"

import { useEffect, useRef } from "react"
import gsap from "gsap"
import { projectAnimations } from "@/lib/animations"

export function ProjectTemplate({ project }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      projectAnimations()
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <main ref={containerRef}>
      <Hero data-animate="fade" {...project} />
      <RichText data-animate="text" content={project.content} />
      <Gallery data-animate="gallery" items={project.gallery} />
      <CTA data-animate="fade" />
    </main>
  )
}


⸻

GSAP STANDARD (MANDATORY)

/lib/animations.ts

import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

export function projectAnimations() {
  gsap.from("[data-animate='fade']", {
    opacity: 0,
    y: 40,
    stagger: 0.1,
    duration: 0.8,
    ease: "power3.out",
  })

  gsap.from("[data-animate='block']", {
    scrollTrigger: {
      trigger: "[data-animate='block']",
      start: "top 80%",
    },
    opacity: 0,
    y: 60,
  })
}

GSAP RULES
	•	Only data-animate selectors
	•	No CSS selectors
	•	No content-dependent animations
	•	Always cleanup with ctx.revert()

⸻

MEDIA RULES
	•	Media files must NOT be stored in the repository
	•	Database stores URLs only
	•	Gallery stored as structured JSON:

[
  { "type": "image", "url": "https://..." },
  { "type": "video", "url": "https://..." }
]


⸻

IMPLEMENTATION STEPS
	1.	Setup Prisma models
	2.	Create fetchers for Project and News
	3.	Implement dynamic slug pages
	4.	Build Templates as Client Components
	5.	Build reusable Blocks
	6.	Implement GSAP animations via data-animate
	7.	Ensure cleanup and no hydration issues

⸻

FINAL ACCEPTANCE CRITERIA
	•	Adding a new Project or News requires NO new code
	•	Templates are reusable
	•	Animations auto-apply to dynamic content
	•	Layout and animation changes propagate globally
	•	System is scalable and maintainable

⸻

DO NOT
	•	Do NOT put GSAP in page.tsx
	•	Do NOT hardcode content
	•	Do NOT store media locally
	•	Do NOT mix server and client responsibilities

⸻

DELIVERABLE

A fully working template-based content system ready for production and future extension (SEO, preview, filters).
