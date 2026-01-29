import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopTabs from "../components/TopTabs";
import ProfileBar from "../components/ProfileBar";
import { getMe, logout } from "../utils/authClient";
import Homepage from "./Homepage";
import Bookingpage from "./Bookingpage";
import "./WorkbenchPage.css";

function normalizeRow(row = {}) {
  return {
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    lineId: row.lineId ?? "",
    treatmentItem: row.treatmentItem ?? "",
    staffName: row.staffName ?? "",
    datetime: row.datetime ?? "", // backward compatibility for sorting fallback
  };
}

function getRowTimestamp(row) {
  const combined = row.date && row.bookingTime ? `${row.date} ${row.bookingTime}` : row.datetime;
  const ts = Date.parse(combined);
  return Number.isNaN(ts) ? 0 : ts;
}

function TabPlaceholder({ title }) {
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

function StockPage() {
  return <TabPlaceholder title="เกี่ยวกับสต๊อก" />;
}

function ProductGuidePage() {
  return <TabPlaceholder title="คู่มือผลิตภัณฑ์" />;
}

export default function WorkbenchPage() {
  const [activeTab, setActiveTab] = useState("home");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [displayMonth, setDisplayMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(displayMonth.getMonth());
  const [pickerYear, setPickerYear] = useState(displayMonth.getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userLabel, setUserLabel] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [theme, setTheme] = useState("light");
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const nextTheme = stored === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.body.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE;
    if (!baseUrl) {
      setError("Missing VITE_API_BASE");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const fetchRows = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/api/appointments?limit=50`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to load appointments");
        }
        const normalized = (data.rows || []).map(normalizeRow);
        const sorted = normalized.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a));
        setRows(sorted);
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(err.message || "Error loading appointments");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRows();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const result = await getMe();
      if (!alive) return;
      if (result.ok) {
        const user = result.data;
        const label = `${user.display_name || user.username} (${user.role_name || "staff"})`;
        setUserLabel(label);
      }
      setLoadingUser(false);
    };
    run();
    return () => {
      alive = false;
    };
  }, []);

  const handleToggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.body.dataset.theme = nextTheme;
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "booking":
        return <Bookingpage />;
      case "stock":
        return <StockPage />;
      case "productGuide":
        return <ProductGuidePage />;
      case "home":
      default:
        return (
          <Homepage
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            displayMonth={displayMonth}
            setDisplayMonth={setDisplayMonth}
            isPickerOpen={isPickerOpen}
            setIsPickerOpen={setIsPickerOpen}
            pickerMonth={pickerMonth}
            setPickerMonth={setPickerMonth}
            pickerYear={pickerYear}
            setPickerYear={setPickerYear}
            rows={rows}
            loading={loading}
            error={error}
            onAddAppointment={() => setActiveTab("booking")}
          />
        );
    }
  };

  return (
    <div className="workbench-page">
      <header className="workbench-header">
        <div className="header-left">
          <h1>Workbench</h1>
          <p>Clinic operations dashboard</p>
        </div>
        <ProfileBar
          user={userLabel}
          loading={loadingUser}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onLogout={handleLogout}
        />
      </header>

      <TopTabs activeTab={activeTab} onChange={setActiveTab} />

      {renderTabContent()}
    </div>
  );
}
