import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PricingSettings } from "@/components/settings/PricingSettings";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const pricing = await prisma.userPricing.findMany({
    where: { userId: session.user.id },
    orderBy: { key: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-600">Your pricing rates and preferences</p>
      </div>
      <PricingSettings initialPricing={pricing} />
    </div>
  );
}
