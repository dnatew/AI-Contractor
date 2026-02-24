import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ProjectsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { photos: true } },
      scopes: { include: { _count: { select: { items: true } } } },
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex gap-4 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-slate-600">Create a project or open an existing one</p>
        </div>
        <Button asChild>
          <Link href="/projects/new">New Project</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.length === 0 ? (
          <Card className="col-span-full border-slate-200 bg-white shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-slate-600 mb-4">No projects yet</p>
              <Button asChild>
                <Link href="/projects/new">Create your first project</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-slate-300 transition-all h-full">
                <CardHeader>
                  <CardTitle className="text-slate-900">{p.address}</CardTitle>
                  <CardDescription>
                    {p.province} · {p.sqft} sqft
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{p._count.photos} photos</Badge>
                    <Badge variant="outline">
                      {p.scopes.reduce((n, s) => n + s._count.items, 0)} items
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
