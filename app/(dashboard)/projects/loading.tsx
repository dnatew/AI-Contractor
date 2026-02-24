export default function ProjectsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex gap-4 justify-between">
        <div>
          <div className="h-8 w-32 bg-slate-200 rounded mb-2" />
          <div className="h-4 w-48 bg-slate-200 rounded" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-slate-200 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
