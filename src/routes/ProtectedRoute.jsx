import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getMe } from "../utils/authClient";

export default function ProtectedRoute({ children }) {
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      const result = await getMe();
      if (!alive) return;
      setAuthorized(Boolean(result.ok));
      setChecking(false);
    };

    run();

    return () => {
      alive = false;
    };
  }, []);

  if (checking) {
    return (
      <div style={{ padding: "32px", color: "#f4eee9" }}>
        Checking session...
      </div>
    );
  }

  if (!authorized) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
