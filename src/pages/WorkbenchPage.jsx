import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopTabs from "../components/TopTabs";
import ProfileBar from "../components/ProfileBar";
import { getMe, logout } from "../utils/authClient";
import "./WorkbenchPage.css";

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const mockRows = [
  {
    datetime: "08/01/2026 10:00",
    service: "Deep Clean",
    lineId: "line_001",
    scrub: "Yes",
    facialMask: "Yes",
    misting: "No",
    extra: "150",
    note: "Follow up in 2 weeks",
  },
  {
    datetime: "09/01/2026 13:30",
    service: "Brightening",
    lineId: "line_014",
    scrub: "No",
    facialMask: "Yes",
    misting: "Yes",
    extra: "0",
    note: "Sensitive skin",
  },
  {
    datetime: "10/01/2026 09:15",
    service: "Hydration",
    lineId: "line_027",
    scrub: "Yes",
    facialMask: "No",
    misting: "Yes",
    extra: "300",
    note: "-",
  },
];

function startOfWeek(date) {
  const base = new Date(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
}

export default function WorkbenchPage() {
  const [activeTab, setActiveTab] = useState("home");
  const [selectedDate, setSelectedDate] = useState(new Date());
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

  const weekDates = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const next = new Date(start);
      next.setDate(start.getDate() + i);
      return next;
    });
  }, [selectedDate]);

  const monthLabel = useMemo(() => {
    return selectedDate.toLocaleString("th-TH", { month: "long", year: "numeric" });
  }, [selectedDate]);

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

      <section className="workbench-body">
        <div className="panel date-panel">
          <div className="panel-title">
            <span>Schedule</span>
            <strong>{monthLabel}</strong>
          </div>
          <div className="week-header">
            {weekDays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="week-grid">
            {weekDates.map((date) => {
              const isSelected =
                date.toDateString() === selectedDate.toDateString();
              return (
                <button
                  type="button"
                  key={date.toISOString()}
                  className={`day-cell ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel table-panel">
          <div className="panel-title">
            <span>Appointments</span>
            <strong>ล่าสุด</strong>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่ เวลา นัดหมาย</th>
                  <th>ชื่อบริการ</th>
                  <th>LineID</th>
                  <th>scrub</th>
                  <th>Facial mask</th>
                  <th>misting</th>
                  <th>ราคาเพิ่มเติม</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {mockRows.map((row) => (
                  <tr key={`${row.datetime}-${row.lineId}`}>
                    <td>{row.datetime}</td>
                    <td>{row.service}</td>
                    <td>{row.lineId}</td>
                    <td>{row.scrub}</td>
                    <td>{row.facialMask}</td>
                    <td>{row.misting}</td>
                    <td>{row.extra}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
