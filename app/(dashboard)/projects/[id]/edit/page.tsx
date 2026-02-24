import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ProjectEditForm } from "@/components/project-edit-form";

const PROVINCES = ["ON", "BC", "AB", "QC", "SK", "MB", "NS", "NB", "NL", "PE", "NT", "NU", "YT"];

export default async function ProjectEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm text-slate-600 hover:text-slate-900 mb-1 block">
          ← Back to project
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Project</h1>
        <p className="text-slate-600">{project.address}</p>
      </div>
      <ProjectEditForm projectId={id} provinces={PROVINCES} initialData={project} />
    </div>
  );
}
