import PresentationStudio from '@/components/agency/PresentationStudio'

export default async function AgencyPresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PresentationStudio id={id} />
}
