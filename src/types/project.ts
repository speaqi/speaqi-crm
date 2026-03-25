export interface Project {
  id: string
  user_id?: string
  title: string
  slug: string
  excerpt?: string
  content: string
  cover_image?: string
  gallery?: GalleryItem[]
  client?: string
  year?: number
  published: boolean
  created_at: string
  updated_at: string
}

export interface GalleryItem {
  type: 'image' | 'video'
  url: string
  caption?: string
}
