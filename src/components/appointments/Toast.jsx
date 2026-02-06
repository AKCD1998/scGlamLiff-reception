export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`table-toast ${toast.type === "error" ? "is-error" : ""}`}>
      {toast.message}
    </div>
  );
}
