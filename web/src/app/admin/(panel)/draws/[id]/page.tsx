"use client";

import { use } from "react";
import { DrawWorkspace } from "@/components/admin/DrawWorkspace";

export default function AdminDrawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DrawWorkspace drawId={id} />;
}
