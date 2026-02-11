import { useState } from "react";
import { createStaffUser } from "../utils/adminUsersApi";

const ROLE_OPTIONS = ["staff", "admin", "owner"];

export default function AdminUsersPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleName, setRoleName] = useState("staff");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [lastCreatedUser, setLastCreatedUser] = useState(null);

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
      const result = await createStaffUser(payload);
      setLastCreatedUser(result?.data || null);
      setPassword("");
      setMessage({ type: "success", text: "สร้างผู้ใช้สำเร็จ" });
    } catch (error) {
      const status = error?.status;
      if (status === 400) {
        setMessage({ type: "error", text: error.message || "ข้อมูลไม่ถูกต้อง" });
      } else if (status === 401) {
        setMessage({ type: "error", text: "Unauthorized กรุณาเข้าสู่ระบบใหม่" });
      } else if (status === 403) {
        setMessage({ type: "error", text: "Forbidden: เฉพาะ Admin/Owner เท่านั้น" });
      } else if (status === 409) {
        setMessage({ type: "error", text: error.message || "Username นี้มีอยู่แล้ว" });
      } else {
        setMessage({ type: "error", text: error?.message || "ไม่สามารถสร้างผู้ใช้ได้" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">
        <strong>จัดการผู้ใช้ (Admin)</strong>
      </div>
      <p>สร้างบัญชีผู้ใช้สำหรับทีมงาน</p>

      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="admin-users-username">Username</label>
          <br />
          <input
            id="admin-users-username"
            type="text"
            placeholder="เช่น staff004"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={loading}
          />
        </p>

        <p>
          <label htmlFor="admin-users-password">Password</label>
          <br />
          <input
            id="admin-users-password"
            type="password"
            placeholder="อย่างน้อย 6 ตัวอักษร"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
          />
        </p>

        <p>
          <label htmlFor="admin-users-display-name">Display name</label>
          <br />
          <input
            id="admin-users-display-name"
            type="text"
            placeholder="ชื่อที่แสดง (ไม่บังคับ)"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={loading}
          />
        </p>

        <p>
          <label htmlFor="admin-users-role">Role</label>
          <br />
          <select
            id="admin-users-role"
            value={roleName}
            onChange={(event) => setRoleName(event.target.value)}
            disabled={loading}
          >
            <option value="staff">staff</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </p>

        <p>
          <label htmlFor="admin-users-active">
            <input
              id="admin-users-active"
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              disabled={loading}
            />
            {" "}
            is_active
          </label>
        </p>

        <p>
          <button type="submit" disabled={loading}>
            {loading ? "กำลังบันทึก..." : "บันทึกผู้ใช้"}
          </button>
        </p>
        <p role="status" aria-live="polite">
          {message.text ? message.text : ""}
        </p>
      </form>

      {lastCreatedUser ? (
        <table className="booking-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Role</th>
              <th>is_active</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{lastCreatedUser.username}</td>
              <td>{lastCreatedUser.display_name}</td>
              <td>{lastCreatedUser.role_name}</td>
              <td>{String(lastCreatedUser.is_active)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
