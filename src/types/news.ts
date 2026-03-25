export interface NewsItem {
  id: string
  user_id?: string
  title: string
  slug: string
  content: string
  cover_image?: string
  published: boolean
  created_at: string
}
