export function Logo({ className = "block h-20 w-auto" }: { className?: string }) {
  return (
    <img
      src="/main.svg"
      alt="Weather Report Suite"
      width={1427}
      height={415}
      className={className}
    />
  );
}
