export function UsFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
      ))}
      <rect width="12" height={(7 * 20) / 13} fill="#3c3b6e" />
      {Array.from({ length: 15 }, (_, i) => (
        <circle key={i} cx={2 + (i % 5) * 2} cy={1.8 + Math.floor(i / 5) * 2.2} r="0.55" fill="#fff" />
      ))}
    </svg>
  );
}

export function ChileFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden>
      <rect width="30" height="20" fill="#d52b1e" />
      <rect width="30" height="10" fill="#fff" />
      <rect width="10" height="10" fill="#0039a6" />
      <polygon
        fill="#fff"
        points="5,2 5.9,4.1 8.2,4.2 6.4,5.6 7,7.9 5,6.6 3,7.9 3.6,5.6 1.8,4.2 4.1,4.1"
      />
    </svg>
  );
}
