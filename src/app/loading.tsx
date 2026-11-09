export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 rounded bg-surface-2" />
      <div className="h-32 rounded-lg bg-surface-2" />
      <div className="h-64 rounded-lg bg-surface-2" />
    </div>
  );
}
