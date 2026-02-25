import { getServerSession } from "next-auth";
import { authOptions, getOrCreateUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProjectWorkspace } from "@/components/project-workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = await getOrCreateUserId(session);
  if (!userId) redirect("/login");

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId },
    include: {
      photos: true,
      scopes: { include: { items: true }, orderBy: { order: "asc" } },
      estimates: {
        where: { OR: [{ status: "draft" }, { status: "sealed" }] },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 1,
        include: { lines: { include: { scopeItem: true } } },
      },
    },
  });

  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="text-sm text-slate-600 hover:text-slate-900 mb-1 block">
            ← Projects
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">{project.address}</h1>
          <p className="text-slate-600">
            {project.province} · {project.sqft} sqft
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-600">
            {project.photos.length} photos
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-600">
            {project.scopes.reduce((acc: number, s) => acc + s.items.length, 0)} scope items
          </span>
          {project.estimates[0] && (
            <span className="px-2 py-1 rounded bg-slate-100 text-slate-600">
              Estimate ready
            </span>
          )}
        </div>
      </div>
      <ProjectWorkspace project={project!} />
    </div>
  );
}
