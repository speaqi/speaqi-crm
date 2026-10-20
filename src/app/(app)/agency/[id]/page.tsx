import ProjectPage from '@/components/agency/ProjectPage'

export default async function AgencyProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectPage id={id} />
}
