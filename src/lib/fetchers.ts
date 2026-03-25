'use client'
import { createClient } from '@/lib/supabase'
import type { Project } from '@/types/project'
import type { NewsItem } from '@/types/news'

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function getProjects(): Promise<Project[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('[getProjects]', error); return [] }
  return (data || []) as Project[]
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()
  if (error) { console.error('[getProjectBySlug]', error); return null }
  return data as Project
}

export async function getNews(): Promise<NewsItem[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('news')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('[getNews]', error); return [] }
  return (data || []) as NewsItem[]
}

export async function getNewsBySlug(slug: string): Promise<NewsItem | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('news')
    .select('*')
    .eq('slug', slug)
    .single()
  if (error) { console.error('[getNewsBySlug]', error); return null }
  return data as NewsItem
}
