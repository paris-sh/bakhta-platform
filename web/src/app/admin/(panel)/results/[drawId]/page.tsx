import { redirect } from "next/navigation";

// Results are handled on the draw page; old links keep working.
export default async function AdminResultRedirect({ params }: { params: Promise<{ drawId: string }> }) {
  const { drawId } = await params;
  redirect(`/admin/draws/${drawId}`);
}
