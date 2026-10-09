export function RegionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="region-error">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
