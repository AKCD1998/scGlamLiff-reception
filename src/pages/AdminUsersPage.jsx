export default function AdminUsersPage() {
  return (
    <section className="panel">
      <div className="panel-title">
        <strong>จัดการผู้ใช้ (Admin)</strong>
      </div>
      <p>ตั้งค่าบัญชีผู้ใช้สำหรับทีมงาน (โหมดตัวอย่าง)</p>

      <form>
        <p>
          <label htmlFor="admin-users-username">Username</label>
          <br />
          <input id="admin-users-username" type="text" placeholder="เช่น staff004" />
        </p>

        <p>
          <label htmlFor="admin-users-password">Password</label>
          <br />
          <input id="admin-users-password" type="password" placeholder="••••••" />
        </p>

        <p>
          <label htmlFor="admin-users-display-name">Display name</label>
          <br />
          <input id="admin-users-display-name" type="text" placeholder="ชื่อที่แสดง (ไม่บังคับ)" />
        </p>

        <p>
          <label htmlFor="admin-users-role">Role</label>
          <br />
          <select id="admin-users-role" defaultValue="staff" disabled>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </p>

        <p>
          <label htmlFor="admin-users-active">
            <input id="admin-users-active" type="checkbox" defaultChecked />
            {" "}
            is_active
          </label>
        </p>

        <p>
          <button type="button" disabled>
            บันทึกผู้ใช้
          </button>
          {" "}
          <small>Coming soon</small>
        </p>
      </form>
    </section>
  );
}
