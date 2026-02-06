export default function TabPlaceholder({ title }) {
  return (
    <section className="workbench-body">
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-title">
          <span>{title}</span>
          <strong>กำลังพัฒนา</strong>
        </div>
        <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          เนื้อหาจะถูกแสดงที่นี่
        </p>
      </div>
    </section>
  );
}