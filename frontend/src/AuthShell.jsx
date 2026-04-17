import { useEffect, useMemo, useState } from "react";
import App from "./App.jsx";

const AUTH_STORAGE_KEY = "floorplan-auth-token";

const emptyAuthForm = {
  name: "",
  email: "",
  password: "",
};

function AuthShell() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState(emptyAuthForm);
  const [token, setToken] = useState(() => window.localStorage.getItem(AUTH_STORAGE_KEY) || "");
  const [user, setUser] = useState(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const authHeading = useMemo(
    () => (mode === "signup" ? "Create Your Account" : "Welcome Back"),
    [mode],
  );

  useEffect(() => {
    if (!token) {
      setIsBooting(false);
      return;
    }

    const controller = new AbortController();

    const verifyToken = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.user) {
          throw new Error(payload?.error || "Session expired. Please log in again.");
        }

        setUser(payload.user);
      } catch {
        setToken("");
        setUser(null);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      } finally {
        setIsBooting(false);
      }
    };

    verifyToken();

    return () => controller.abort();
  }, [token]);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = {
        email: form.email,
        password: form.password,
      };

      if (mode === "signup") {
        body.name = form.name;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.token || !payload?.user) {
        throw new Error(payload?.error || "Authentication failed.");
      }

      window.localStorage.setItem(AUTH_STORAGE_KEY, payload.token);
      setToken(payload.token);
      setUser(payload.user);
      setForm(emptyAuthForm);
    } catch (authError) {
      setError(authError.message || "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    setUser(null);
    setError("");
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  if (isBooting) {
    return (
      <main className="auth-screen">
        <section className="auth-card auth-loading-card">
          <h1>Preparing your workspace...</h1>
          <p>Checking your saved session.</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <p className="auth-eyebrow">Floor Plan Studio</p>
          <h1>{authHeading}</h1>
          <p className="auth-subtitle">
            {mode === "signup"
              ? "Sign up once and your account data will be stored in MongoDB."
              : "Log in to continue to your floor plan editor."}
          </p>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {mode === "signup" ? (
              <label>
                Full Name
                <input
                  name="name"
                  type="text"
                  minLength={2}
                  value={form.name}
                  onChange={handleFieldChange}
                  placeholder="Your full name"
                  required
                />
              </label>
            ) : null}

            <label>
              Email
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleFieldChange}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={6}
                value={form.password}
                onChange={handleFieldChange}
                placeholder="Minimum 6 characters"
                required
              />
            </label>

            {error ? <p className="auth-error">{error}</p> : null}

            <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? "Please wait..." : mode === "signup" ? "Create Account" : "Log In"}
            </button>
          </form>

          <button
            type="button"
            className="auth-switch-btn"
            onClick={() => {
              setError("");
              setMode((current) => (current === "signup" ? "login" : "signup"));
            }}
          >
            {mode === "signup"
              ? "Already have an account? Log in"
              : "New here? Create an account"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="auth-app-shell">
      <App authToken={token} authUser={user} onAuthExpired={handleLogout} />
    </div>
  );
}

export default AuthShell;