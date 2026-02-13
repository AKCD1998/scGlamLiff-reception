import { useCallback, useEffect, useState } from "react";
import { createStaffUser, listStaffUsers, patchStaffUser } from "../utils/adminUsersApi";
import "./AdminUsersPage.css";

const ROLE_OPTIONS = ["staff", "admin", "owner"];

export default function AdminUsersPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleName, setRoleName] = useState("staff");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [rowBusyMap, setRowBusyMap] = useState({});
  const [message, setMessage] = useState({ type: "", text: "" });
  const [users, setUsers] = useState([]);

  const handleApiError = useCallback((error, fallbackMessage) => {
    const status = error?.status;
    if (status === 400) {
      setMessage({ type: "error", text: error.message || "ข้อมูลไม่ถูกต้อง" });
      return;
    }
    if (status === 401) {
      setMessage({ type: "error", text: "Unauthorized กรุณาเข้าสู่ระบบใหม่" });
      return;
    }
    if (status === 403) {
      setMessage({ type: "error", text: "Forbidden: เฉพาะ Admin/Owner เท่านั้น" });
      return;
    }
    if (status === 404) {
      setMessage({ type: "error", text: error.message || "ไม่พบผู้ใช้" });
      return;
    }
    if (status === 409) {
      setMessage({ type: "error", text: error.message || "Username นี้มีอยู่แล้ว" });
      return;
    }
    setMessage({ type: "error", text: error?.message || fallbackMessage });
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await listStaffUsers();
      setUsers(Array.isArray(result?.rows) ? result.rows : []);
    } catch (error) {
      handleApiError(error, "ไม่สามารถโหลดรายชื่อผู้ใช้ได้");
    } finally {
      setLoadingList(false);
    }
  }, [handleApiError]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    const cleanUsername = username.trim();
    const cleanDisplayName = displayName.trim();
    const cleanRoleName = String(roleName || "staff").trim().toLowerCase() || "staff";

    if (!cleanUsername) {
      setMessage({ type: "error", text: "กรุณากรอก Username" });
      return;
    }

    if (!password) {
      setMessage({ type: "error", text: "กรุณากรอก Password" });
      return;
    }

    if (password.length < 6) {
      setMessage({ type: "error", text: "Password ต้องมีอย่างน้อย 6 ตัวอักษร" });
      return;
    }

    if (!ROLE_OPTIONS.includes(cleanRoleName)) {
      setMessage({ type: "error", text: "Role ไม่ถูกต้อง" });
      return;
    }

    const payload = {
      username: cleanUsername,
      password,
      role_name: cleanRoleName,
      is_active: isActive,
    };
    if (cleanDisplayName) {
      payload.display_name = cleanDisplayName;
    }

    setLoading(true);
    setMessage({ type: "", text: "" });
    try {
      await createStaffUser(payload);
      setPassword("");
      setMessage({ type: "success", text: "สร้างผู้ใช้สำเร็จ" });
      await loadUsers();
    } catch (error) {
      handleApiError(error, "ไม่สามารถสร้างผู้ใช้ได้");
    } finally {
      setLoading(false);
    }
  };

  const setRowBusy = useCallback((userId, busy) => {
    setRowBusyMap((prev) => {
      const next = { ...prev };
      if (busy) {
        next[userId] = true;
      } else {
        delete next[userId];
      }
      return next;
    });
  }, []);

  const handleToggleActive = useCallback(async (user) => {
    if (!user?.id) return;
    const nextValue = user.is_active !== true;
    setRowBusy(user.id, true);
    setMessage({ type: "", text: "" });
    try {
      const result = await patchStaffUser(user.id, { is_active: nextValue });
      const updated = result?.data || {};
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? { ...item, ...updated } : item))
      );
      setMessage({ type: "success", text: "อัปเดตสถานะผู้ใช้สำเร็จ" });
    } catch (error) {
      handleApiError(error, "ไม่สามารถอัปเดตสถานะผู้ใช้ได้");
    } finally {
      setRowBusy(user.id, false);
    }
  }, [handleApiError, setRowBusy]);

  const handleResetPassword = useCallback(async (user) => {
    if (!user?.id) return;
    const nextPassword = window.prompt("กรอกรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)");
    if (nextPassword === null) return;
    if (nextPassword.length < 6) {
      setMessage({ type: "error", text: "Password ต้องมีอย่างน้อย 6 ตัวอักษร" });
      return;
    }
    const confirmed = window.confirm(`ยืนยันรีเซ็ตรหัสผ่านของ ${user.username}?`);
    if (!confirmed) return;

    setRowBusy(user.id, true);
    setMessage({ type: "", text: "" });
    try {
      await patchStaffUser(user.id, { password: nextPassword });
      setMessage({ type: "success", text: `รีเซ็ตรหัสผ่านของ ${user.username} สำเร็จ` });
    } catch (error) {
      handleApiError(error, "ไม่สามารถรีเซ็ตรหัสผ่านได้");
    } finally {
      setRowBusy(user.id, false);
    }
  }, [handleApiError, setRowBusy]);

  return (
    <section className="panel admin-users-page">
      <div className="panel-title">
        <strong>จัดการผู้ใช้ (Admin)</strong>
      </div>
      <div className="admin-users-page__content">
        <p className="admin-users-page__intro">สร้างบัญชีผู้ใช้สำหรับทีมงาน</p>

        <form className="admin-users-form" onSubmit={handleSubmit}>
          <div className="admin-users-form__grid">
            <div className="admin-users-field">
              <label htmlFor="admin-users-username">Username</label>
              <input
                id="admin-users-username"
                className="admin-users-input"
                type="text"
                placeholder="เช่น staff004"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading}
              />
            </div>

            <div className="admin-users-field">
              <label htmlFor="admin-users-password">Password</label>
              <input
                id="admin-users-password"
                className="admin-users-input"
                type="password"
                placeholder="อย่างน้อย 6 ตัวอักษร"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
              />
            </div>

            <div className="admin-users-field">
              <label htmlFor="admin-users-display-name">Display name</label>
              <input
                id="admin-users-display-name"
                className="admin-users-input"
                type="text"
                placeholder="ชื่อที่แสดง (ไม่บังคับ)"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={loading}
              />
            </div>

            <div className="admin-users-field">
              <label htmlFor="admin-users-role">Role</label>
              <select
                id="admin-users-role"
                className="admin-users-select"
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                disabled={loading}
              >
                <option value="staff">staff</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </div>
          </div>

          <label className="admin-users-check" htmlFor="admin-users-active">
            <input
              id="admin-users-active"
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              disabled={loading}
            />
            <span>is_active</span>
          </label>

          <div className="admin-users-form__actions">
            <button
              type="submit"
              className="admin-users-btn admin-users-btn--brown"
              disabled={loading}
            >
              {loading ? "กำลังบันทึก..." : "บันทึกผู้ใช้"}
            </button>
          </div>

          {message.text ? (
            <p
              role="status"
              aria-live="polite"
              className={`admin-users-message ${
                message.type === "success"
                  ? "admin-users-message--success"
                  : "admin-users-message--error"
              }`}
            >
              {message.text}
            </p>
          ) : null}
        </form>

        <h3 className="admin-users-list-title">รายชื่อผู้ใช้</h3>
        {loadingList ? (
          <p className="admin-users-list-state">กำลังโหลด...</p>
        ) : (
          <div className="admin-users-table-wrap">
            <table className="booking-table admin-users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Display name</th>
                  <th>Role</th>
                  <th>is_active</th>
                  <th>Created at</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan="6">ไม่มีข้อมูล</td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const rowBusy = rowBusyMap[user.id] === true;
                    return (
                      <tr key={user.id || user.username}>
                        <td>{user.username}</td>
                        <td>{user.display_name}</td>
                        <td>{user.role_name}</td>
                        <td>
                          <label className="admin-users-row-check">
                            <input
                              type="checkbox"
                              checked={user.is_active === true}
                              disabled={rowBusy}
                              onChange={() => handleToggleActive(user)}
                            />
                            <span>{user.is_active === true ? "active" : "inactive"}</span>
                          </label>
                        </td>
                        <td>
                          {user.created_at ? new Date(user.created_at).toLocaleString() : "-"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="admin-users-btn admin-users-btn--brown admin-users-btn--compact"
                            disabled={rowBusy}
                            onClick={() => handleResetPassword(user)}
                          >
                            Reset Password
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
