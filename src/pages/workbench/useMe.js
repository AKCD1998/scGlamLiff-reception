import { useEffect, useState } from "react";
import { getMe } from "../../utils/authClient";

export function useMe() {
  const [userLabel, setUserLabel] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [me, setMe] = useState(null);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      const result = await getMe();
      if (!alive) return;

      if (result.ok) {
        const user = result.data;
        const label = `${user.display_name || user.username} (${user.role_name || "staff"})`;
        setMe(user);
        setUserLabel(label);
      }

      setLoadingUser(false);
    };

    run();

    return () => {
      alive = false;
    };
  }, []);

  return { me, userLabel, loadingUser };
}

