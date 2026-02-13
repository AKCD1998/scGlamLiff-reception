import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopTabs from "../components/TopTabs";
import ProfileBar from "../components/ProfileBar";
import { logout } from "../utils/authClient";
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



export default function WorkbenchPage() {
  const [activeTab, setActiveTab] = useState("home");
  const homePicker = useHomePickerState();
  const { rows, loading, error, hasLoadedOnce, deleteAppointment } = useAppointments({
    limit: 50,
    selectedDate: homePicker.selectedDate,
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
