import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopTabs from "../components/TopTabs";
import ProfileBar from "../components/ProfileBar";
import { logout } from "../utils/authClient";
import { getCalendarDays } from "../utils/appointmentsApi";
import { buildCalendarDaySet } from "../utils/appointmentCalendarUtils";
import { formatDateKey } from "../utils/dateFormat";
import Homepage from "./Homepage";
import Bookingpage from "./Bookingpage";
import AdminBackdate from "./AdminBackdate";
import AdminEditAppointment from "./AdminEditAppointment";
import AdminUsersPage from "./AdminUsersPage";
import "./WorkbenchPage.css";
import TabPlaceholder from "../components/TabPlaceholder";
import { useAppointments } from "./workbench/useAppointments";
import { useHomePickerState } from "./workbench/useHomePickerState";
import { useTheme } from "./workbench/useTheme";
import { useMe } from "./workbench/useMe";
import { runAppointmentConsistencyDebug } from "../utils/appointmentConsistencyDebug";



export default function WorkbenchPage() {
  const [activeTab, setActiveTab] = useState("home");
  const homePicker = useHomePickerState();
  const [glowDays, setGlowDays] = useState(() => new Set());
  const [glowError, setGlowError] = useState("");
  const glowRequestIdRef = useRef(0);
  const debugConsistencyRanRef = useRef(false);

  const monthRange = useMemo(() => {
    const month = homePicker.displayMonth;
    if (!(month instanceof Date) || Number.isNaN(month.getTime())) {
      return { from: "", to: "" };
    }
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return { from: formatDateKey(start), to: formatDateKey(end) };
  }, [homePicker.displayMonth]);

  const refreshGlow = useCallback(async () => {
    const { from, to } = monthRange;
    if (!from || !to) return;

    const requestId = glowRequestIdRef.current + 1;
    glowRequestIdRef.current = requestId;
    setGlowError("");

    try {
      const data = await getCalendarDays({ from, to });
      if (requestId !== glowRequestIdRef.current) return;

      const days = data?.days || [];
      setGlowDays(buildCalendarDaySet(days));
    } catch (err) {
      if (requestId !== glowRequestIdRef.current) return;
      setGlowError(err?.message || "โหลดวันนัดหมายไม่สำเร็จ");
      setGlowDays(new Set());
    }
  }, [monthRange]);

  const { rows, loading, error, hasLoadedOnce, deleteAppointment, refetch } = useAppointments({
    limit: 50,
    selectedDate: homePicker.selectedDate,
    onAfterMutation: refreshGlow,
  });
  const { theme, toggleTheme } = useTheme();
  const { me, userLabel, loadingUser } = useMe();
  const canManageTestRecords = useMemo(() => {
    const role = String(me?.role_name || "").toLowerCase();
    return role === "admin" || role === "owner";
  }, [me?.role_name]);
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleDeleteAppointment = async (id, reason) => {
    await deleteAppointment(id, reason);
  };

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "home", label: "หน้าหลัก" },
      { id: "booking", label: "ระบบการจองคิว" },
      { id: "stock", label: "เกี่ยวกับสต๊อก" },
      { id: "productGuide", label: "คู่มือผลิตภัณฑ์" },
    ];
    const role = String(me?.role_name || "").toLowerCase();
    const isAdmin = role === "admin" || role === "owner";
    if (isAdmin) {
      baseTabs.push({ id: "adminBackdate", label: "จองย้อนหลัง (Admin)" });
      baseTabs.push({ id: "adminEditAppointment", label: "แก้ไขนัดหมาย (Admin)" });
      baseTabs.push({ id: "adminUsers", label: "จัดการผู้ใช้ (Admin)" });
    }
    return baseTabs;
  }, [me]);

  const isAdminTabAvailable = useMemo(
    () => tabs.some((t) => t.id === "adminBackdate"),
    [tabs]
  );

  useEffect(() => {
    if (activeTab !== "home") return;
    void refetch();
  }, [activeTab, refetch]);

  useEffect(() => {
    if (activeTab !== "home") return;
    void refreshGlow();
  }, [activeTab, refreshGlow]);

  useEffect(() => {
    if (debugConsistencyRanRef.current) return undefined;
    debugConsistencyRanRef.current = true;
    const controller = new AbortController();
    void runAppointmentConsistencyDebug({ signal: controller.signal });
    return () => controller.abort();
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case "booking":
        return <Bookingpage />;
      case "adminBackdate":
        if (!isAdminTabAvailable) {
          return <TabPlaceholder title="จองย้อนหลัง (Admin)" />;
        }
        return <AdminBackdate currentUser={me} />;
      case "adminEditAppointment":
        if (!isAdminTabAvailable) {
          return <TabPlaceholder title="แก้ไขนัดหมาย (Admin)" />;
        }
        return <AdminEditAppointment currentUser={me} />;
      case "adminUsers":
        if (!isAdminTabAvailable) {
          return <TabPlaceholder title="จัดการผู้ใช้ (Admin)" />;
        }
        return <AdminUsersPage />;
      case "stock":
        return <TabPlaceholder title="เกี่ยวกับสต๊อก" />;
      case "productGuide":
        return <TabPlaceholder title="คู่มือผลิตภัณฑ์" />;

      case "home":
      default:
        return (
          <Homepage
            {...homePicker}
            rows={rows}
            loading={loading}
            error={error}
            hasLoadedOnce={hasLoadedOnce}
            onAddAppointment={() => setActiveTab("booking")}
            onDeleteAppointment={handleDeleteAppointment}
            canManageTestRecords={canManageTestRecords}
            glowDays={glowDays}
            glowError={glowError}
          />
        );
    }
  };

  return (
    <div className="workbench-page">
      <header className="workbench-header">
        <div className="header-left">
          <h1>หน้าแรก</h1>
          <p>แดชบอร์ดการดำเนินงาน</p>
        </div>
        <ProfileBar
          user={userLabel}
          loading={loadingUser}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      </header>

      <TopTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />

      {renderTabContent()}
    </div>
  );
}
