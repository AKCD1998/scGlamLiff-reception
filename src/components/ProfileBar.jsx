import "./ProfileBar.css";

export default function ProfileBar({ user, loading, theme, onToggleTheme, onLogout }) {
  return (
    <div className="profile-bar">
      <div className="profile-info">
        <span className="profile-label">ผู้ใช้งาน</span>
        <span className="profile-user">
          {loading ? "Loading..." : user}
        </span>
      </div>

      <label className="theme-toggle" aria-label="Toggle dark mode">
        <input
          type="checkbox"
          checked={theme === "dark"}
          onChange={onToggleTheme}
        />
        <span className="toggle-track" />
        <span className="toggle-text">{theme === "dark" ? "Dark" : "Light"}</span>
      </label>

      <button type="button" className="logout-btn" onClick={onLogout}>
        ออกจากระบบ
      </button>
    </div>
  );
}
