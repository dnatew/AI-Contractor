import { getServerSession } from "next-auth";
import { authOptions, getOrCreateUserId } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PricingSettings } from "@/components/settings/PricingSettings";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = await getOrCreateUserId(session);
  if (!userId) redirect("/login");

  const pricing = await prisma.userPricing.findMany({
    where: { userId },
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
