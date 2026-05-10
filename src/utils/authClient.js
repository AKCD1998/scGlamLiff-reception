import { getApiUrl } from "./runtimeEnv";

export async function getMe() {
  const res = await fetch(getApiUrl("/api/auth/me"), {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) {
    return { ok: false };
  }

  return res.json();
}

export async function logout() {
  const res = await fetch(getApiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    return { ok: false };
  }

  return res.json();
}
