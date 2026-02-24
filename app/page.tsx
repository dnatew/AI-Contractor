import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-white to-slate-100">
      <h1 className="text-4xl font-bold mb-4 text-slate-900">AI Invoice Maker</h1>
      <p className="text-slate-600 mb-8 max-w-md text-center">
        Turn job photos into professional estimates. Upload photos, get AI scope tags, refine, and seal your invoice.
      </p>
      <div className="flex gap-4">
        <Button asChild size="lg">
          <Link href="/login">Get Started</Link>
        </Button>
      </div>
    </div>
  );
}
