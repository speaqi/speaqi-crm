import DeckEditor from '@/components/tourism/deck/DeckEditor'

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DeckEditor id={id} />
}
