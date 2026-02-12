import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

export default function LoginPage() {
  const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setMsg({ type: "", text: "" });

    if (!username.trim() || !password) {
      setMsg({
        type: "error",
        text: "กรุณากรอก username และรหัสผ่านให้ครบ",
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setMsg({ type: "error", text: data.error || "Login failed" });
        setLoading(false);
        return;
      }

      setMsg({ type: "success", text: "เข้าสู่ระบบสำเร็จ" });
      setLoading(false);
      navigate("/workbench");
    } catch (_error) {
      setMsg({ type: "error", text: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์" });
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">ยินดีต้อนรับ</h1>
        <p className="login-subtitle">กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">ชื่อผู้ใช้(Username)</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              disabled={loading}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">รหัสผ่าน(Password)</span>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className="toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                disabled={loading}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M2.3 12.3c2.6 4.2 6.3 6.4 9.7 6.4s7.1-2.2 9.7-6.4c.2-.4.2-.9 0-1.3C19.1 6.8 15.4 4.6 12 4.6S4.9 6.8 2.3 10.9c-.2.4-.2.9 0 1.4Z"
                    />
                    <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
                    <path d="M4.5 4.5 19.5 19.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M2.3 12.3c2.6 4.2 6.3 6.4 9.7 6.4s7.1-2.2 9.7-6.4c.2-.4.2-.9 0-1.3C19.1 6.8 15.4 4.6 12 4.6S4.9 6.8 2.3 10.9c-.2.4-.2.9 0 1.4Z"
                    />
                    <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <button className="login-button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Log in"}
          </button>

          <div className="status" role="status" aria-live="polite">
            {msg.text && <span className={msg.type}>{msg.text}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
