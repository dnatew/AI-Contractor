export default function ProjectLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-slate-200 rounded" />
      <div className="h-4 w-32 bg-slate-200 rounded" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 bg-slate-200 rounded-xl" />
        <div className="h-48 bg-slate-200 rounded-xl" />
      </div>
    </div>
  );
}
