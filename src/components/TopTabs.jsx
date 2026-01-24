import "./TopTabs.css";

const tabs = [
  { id: "home", label: "หน้าหลัก" },
  { id: "staff", label: "บริการโดยพนักงาน" },
];

export default function TopTabs({ activeTab, onChange }) {
  return (
    <div className="top-tabs" role="tablist" aria-label="Workbench tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`top-tab ${activeTab === tab.id ? "active" : ""}`}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
