export default function SkeletonRow({ columns = 4 }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: "var(--space-3) var(--space-4)" }}>
          <div className="skeleton" style={{ height: 16, width: i === 0 ? "80%" : "60%" }} />
        </td>
      ))}
    </tr>
  );
}
