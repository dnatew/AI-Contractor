import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { LogoutButton } from "@/components/logout-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/projects" className="font-semibold text-slate-900">
            AI Invoice Maker
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/projects" className="text-sm text-slate-600 hover:text-slate-900">Projects</Link>
            <Link href="/settings" className="text-sm text-slate-600 hover:text-slate-900">Settings</Link>
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">{session.user?.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
