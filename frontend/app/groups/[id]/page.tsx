import { DetailView } from "@/components/detail/detail-view"

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DetailView id={id} />
}
