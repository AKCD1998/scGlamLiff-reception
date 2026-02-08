import { useCallback, useEffect, useState } from "react";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "dark" ? "dark" : "light";
  } catch (_error) {
    return "light";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(() => readStoredTheme());

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const nextTheme = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", nextTheme);
      return nextTheme;
    });
  }, []);

  return { theme, toggleTheme };
}
