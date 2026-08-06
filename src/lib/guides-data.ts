export interface Guide {
  id: string
  title: string
  description: string
  type: 'videomap' | 'audiomap' | 'both'
  duration: number
  icon: string
  tags: string[]
  category: string
  city: 'napoli' | 'roma'
  thumbnail?: string
  transcript?: string
}

export const GUIDES: Guide[] = [
  {
    id: 'setup-onboarding',
    title: 'Setup & Onboarding',
    description: 'Dal primo login ai tuoi primi contatti. Video + Audio guida completa.',
    type: 'both',
    duration: 12,
    icon: '🚀',
    tags: ['setup', 'onboarding', 'video', 'audio'],
    category: 'Getting Started',
    city: 'napoli',
    transcript: `0:00 - Benvenuto in Speaqi\n2:15 - Login e first access\n4:30 - Dashboard overview\n7:00 - Primis contatti\n10:45 - First actions`,
  },
  {
    id: 'processo-vendita',
    title: 'Processo di Vendita Speaqi',
    description: 'Dalla lead qualification al deal close. Fase dopo fase, con esempi reali.',
    type: 'videomap',
    duration: 8,
    icon: '💼',
    tags: ['vendita', 'pipeline', 'video'],
    category: 'Sales Process',
    city: 'napoli',
    transcript: `0:00 - Introduzione al processo\n1:30 - Lead qualification\n3:00 - Contatto iniziale\n5:15 - Interesse e follow-up\n7:30 - Chiusura`,
  },
  {
    id: 'gmail-ai-integration',
    title: 'Gmail + AI Integration',
    description:
      'Sincronizzazione email, draft AI, scoring. Step-by-step con casi reali.',
    type: 'both',
    duration: 10,
    icon: '📧',
    tags: ['gmail', 'ai', 'email', 'video', 'audio'],
    category: 'Integrations',
    city: 'napoli',
  },
  {
    id: 'analytics-kpi',
    title: 'Analytics & KPI Dashboard',
    description: 'Dashboard, metriche, KPI. Come leggere i dati e decidere.',
    type: 'audiomap',
    duration: 7,
    icon: '📊',
    tags: ['analytics', 'kpi', 'metrics', 'audio'],
    category: 'Analytics',
    city: 'napoli',
  },
  {
    id: 'ai-decision-making',
    title: 'AI Decision Making',
    description: 'Lead scoring, predictive actions, memory update. Come funziona.',
    type: 'both',
    duration: 9,
    icon: '🤖',
    tags: ['ai', 'scoring', 'predictive', 'video', 'audio'],
    category: 'AI Features',
    city: 'napoli',
  },
  {
    id: 'advanced-techniques',
    title: 'Advanced Sales Techniques',
    description: 'Cold calling, objection handling, follow-up sequences.',
    type: 'audiomap',
    duration: 15,
    icon: '💬',
    tags: ['sales', 'technique', 'advanced', 'audio'],
    category: 'Advanced',
    city: 'napoli',
  },
  {
    id: 'kanban-pipeline',
    title: 'Kanban & Pipeline Management',
    description: 'Visualizzazione della pipeline, drag-and-drop, stages.',
    type: 'videomap',
    duration: 6,
    icon: '🎯',
    tags: ['kanban', 'pipeline', 'video'],
    category: 'Workflow',
    city: 'napoli',
  },
  {
    id: 'team-collaboration',
    title: 'Team Collaboration & Roles',
    description: 'Permessi, ruoli, filtri per collaboratori. Setup del team.',
    type: 'both',
    duration: 11,
    icon: '👥',
    tags: ['team', 'collaboration', 'admin', 'video', 'audio'],
    category: 'Team Setup',
    city: 'napoli',
  },
]

export function getGuidesByCity(city: 'napoli' | 'roma'): Guide[] {
  return GUIDES.filter((g) => g.city === city)
}

export function getGuideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.id === slug)
}

export function getCategories(city: 'napoli' | 'roma'): string[] {
  const guides = getGuidesByCity(city)
  return Array.from(new Set(guides.map((g) => g.category)))
}
