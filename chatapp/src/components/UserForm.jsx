import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { connectAndRegisterUser } from "../Socket";
import {
  FaEnvelope,
  FaLock,
  FaUser,
  FaEye,
  FaEyeSlash,
} from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
function UserForm({ onAuthenticated }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState("");
  const [notice, setNotice] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleStatus, setGoogleStatus] = useState("loading");
  const [loginQuotes, setLoginQuotes] = useState([]);
  const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
  const googleButton = useRef(null);

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    axios.get(`${API_URL}/api/login-quotes`, { timeout: 10000 })
      .then(({ data }) => {
        if (active && Array.isArray(data)) setLoginQuotes(data.filter((item) => typeof item.quote === "string" && item.quote.trim()));
      })
      .catch((requestError) => {
        console.error("Could not load login quotes:", requestError);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loginQuotes.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveQuoteIndex((index) => (index + 1) % loginQuotes.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [loginQuotes.length]);

  useEffect(() => {
    setActiveQuoteIndex(0);
  }, [loginQuotes]);

  const toggleForm = () => {
    setIsSignUp((prev) => !prev);
    setError("");
    setNotice("");
    setUsername("");
    setEmail("");
    setPassword("");
    setFocusedField("");
    setShowPass(false);
  };

  useEffect(() => {
    let active = true;
    let googleScript;
    axios.get(`${API_URL}/api/oauth/config`, { timeout: 10000 })
      .then(({ data }) => {
        if (!active) return;
        if (typeof data.googleClientId !== "string" || !data.googleClientId) {
          setGoogleStatus("unconfigured");
          return;
        }
        setGoogleClientId(data.googleClientId);
        googleScript = document.createElement("script");
        googleScript.src = "https://accounts.google.com/gsi/client";
        googleScript.async = true;
        googleScript.defer = true;
        googleScript.onload = () => {
          if (!active) return;
          if (!window.google?.accounts?.id || !googleButton.current) {
            setGoogleStatus("error");
            return;
          }
          window.google.accounts.id.initialize({
            client_id: data.googleClientId,
            callback: async ({ credential }) => {
              setLoading(true);
              setError("");
              setNotice("");
              try {
                const response = await axios.post(`${API_URL}/api/oauth/google`, { credential }, {
                  withCredentials: true,
                });
                if (!response.data.user?._id || !response.data.token) {
                  throw new Error("The server returned an incomplete sign-in response.");
                }
                localStorage.setItem("user", JSON.stringify(response.data.user));
                localStorage.setItem("token", response.data.token);
                onAuthenticated(response.data.user);
                connectAndRegisterUser(response.data.token);
                navigate("/chat", { replace: true });
              } catch (requestError) {
                setError(requestError.response?.data?.message || requestError.message || "Google sign-in failed.");
              } finally {
                setLoading(false);
              }
            },
          });
          window.google.accounts.id.renderButton(googleButton.current, {
            theme: "filled_black",
            size: "large",
            shape: "pill",
            text: "continue_with",
            width: Math.min(280, googleButton.current.clientWidth || 280),
          });
          setGoogleStatus("ready");
        };
        googleScript.onerror = () => {
          if (active) setGoogleStatus("error");
        };
        document.head.appendChild(googleScript);
      })
      .catch(() => {
        if (active) setGoogleStatus("unavailable");
      });
    return () => {
      active = false;
      googleScript?.remove();
    };
  }, [navigate, onAuthenticated]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const endpoint = isSignUp ? "/api/register" : "/api/login";
      const payload = isSignUp
        ? { username, email, password }
        : { email, password };

      const { data } = await axios.post(`${API_URL}${endpoint}`, payload, {
        withCredentials: true,
      });
      if (isSignUp) {
        setNotice(data.message || "Your account is awaiting administrator approval.");
        setIsSignUp(false);
        setPassword("");
        return;
      }
      if (!data.user?._id || !data.token) {
        throw new Error("The server returned an incomplete sign-in response.");
      }

      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("token", data.token);
      onAuthenticated(data.user);
      connectAndRegisterUser(data.token);

      navigate("/chat", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const inputWrapper = "relative w-full";
  const inputBase =
    "theme-auth-input w-full pl-10 pr-10 py-2 border rounded-md outline-none focus:ring-2 ring-offset-0 transition-all duration-200 ease-in-out";
  const inputInvalid = "border-red-500 ring-red-300";
  const labelBase =
    "theme-auth-label absolute left-10 px-1 transition-all duration-200 ease-in-out text-sm pointer-events-none";
  const floatLabel = "-top-2.5 translate-y-0 text-xs";
  const defaultLabel = "top-2.5 translate-y-0 text-gray-400";

  return (
    
    <div className="theme-auth-page flex min-h-screen items-center justify-center px-4 py-4">
      <div
        className="theme-auth-card relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-x-hidden overflow-y-auto rounded-3xl p-6 shadow-2xl backdrop-blur transition-all duration-[600ms]"
        style={{ height: isSignUp ? 550 : 600 }}
      >
        <header className="theme-auth-brand absolute inset-x-6 top-5 z-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-[0.2em] sm:text-4xl">NFaNG</h1>
          {loginQuotes.length > 0 && (
            <p key={loginQuotes[activeQuoteIndex]?._id} className="theme-auth-quote mt-2 min-h-10 text-sm italic leading-5 sm:text-base">
              “{loginQuotes[activeQuoteIndex]?.quote}”
            </p>
          )}
        </header>
        <div
          className="mt-[105px] grid h-[calc(100%-105px)] grid-cols-2 gap-4 transition-transform duration-500 ease-in-out"
          style={{
            width: "calc(200% + 1rem)",
            transform: isSignUp ? "translateX(calc(-50% - 0.5rem))" : "translateX(0)",
          }}
        >
          {/* Sign In Form */}
          <form
            onSubmit={handleSubmit}
            className="theme-auth-form flex min-w-0 flex-col justify-center space-y-4 px-3 sm:px-6"
          >
            <h2 className="theme-auth-heading text-center text-3xl font-bold underline">
              Sign In
            </h2>

            <div className={inputWrapper}>
              <FaEnvelope className="absolute top-3 left-3 text-gray-500" />
              <input
                type="email"
                className={`${inputBase} ${
                  !email && focusedField === "email"
                    ? inputInvalid
                    : "border-gray-300"
                }`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField("")}
                required
              />
              <label
                className={`${labelBase} ${
                  focusedField === "email" || email
                    ? floatLabel
                    : defaultLabel
                }`}
              >
                Email
              </label>
            </div>

            <div className={inputWrapper}>
              <FaLock className="absolute top-3 left-3 text-gray-500" />
              <input
                type={showPass ? "text" : "password"}
                className={`${inputBase} ${
                  !password && focusedField === "password"
                    ? inputInvalid
                    : "border-gray-300"
                }`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField("")}
                required
              />
              <label
                className={`${labelBase} ${
                  focusedField === "password" || password
                    ? floatLabel
                    : defaultLabel
                }`}
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPass((prev) => !prev)}
                className="absolute top-2.5 right-3 text-gray-500 hover:text-gray-700"
              >
                {showPass ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-300 text-center">{error}</p>
            )}
            {notice && <p role="status" className="text-sm text-emerald-200 text-center">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="theme-auth-submit w-40 self-center rounded-full px-4 py-2 font-medium"
            >
              {loading ? "Please wait..." : "Log In"}
            </button>

            <p className="theme-auth-copy text-center text-sm">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={toggleForm}
                className="theme-auth-link no-underline hover:underline"
              >
                Sign Up
              </button>
            </p>
            <div className="w-full">
              {googleClientId ? (
                <div ref={googleButton} className="flex min-h-10 justify-center" />
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex min-h-10 w-full items-center justify-center rounded-full border border-white/25 bg-white px-4 text-sm font-semibold text-gray-800 disabled:cursor-not-allowed disabled:opacity-90"
                >
                  Continue with Google
                </button>
              )}
              {googleStatus === "unconfigured" && (
                <p className="mt-1 text-center text-xs text-amber-100">
                  Google sign-in needs GOOGLE_CLIENT_ID configured on the server.
                </p>
              )}
              {googleStatus === "unavailable" && (
                <p className="mt-1 text-center text-xs text-amber-100">
                  Google sign-in configuration could not be loaded.
                </p>
              )}
              {googleStatus === "error" && (
                <p role="alert" className="mt-1 text-center text-xs text-rose-200">
                  Could not load Google sign-in. Check the browser’s connection and Google OAuth origin settings.
                </p>
              )}
            </div>
          </form>

          {/* Sign Up Form */}
          <form
            onSubmit={handleSubmit}
            className="theme-auth-form flex min-w-0 flex-col justify-center space-y-6 px-3 sm:px-6"
          >
            <h2 className="theme-auth-heading text-center text-3xl font-bold underline">
              Sign Up
            </h2>

            <div className={inputWrapper}>
              <FaUser className="absolute top-3 left-3 text-gray-500" />
              <input
                type="text"
                className={`${inputBase} ${
                  !username && focusedField === "username"
                    ? inputInvalid
                    : "border-gray-300"
                }`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField("")}
                required
              />
              <label
                className={`${labelBase} ${
                  focusedField === "username" || username
                    ? floatLabel
                    : defaultLabel
                }`}
              >
                Username
              </label>
            </div>

            <div className={inputWrapper}>
              <FaEnvelope className="absolute top-3 left-3 text-gray-500" />
              <input
                type="email"
                className={`${inputBase} ${
                  !email && focusedField === "email"
                    ? inputInvalid
                    : "border-gray-300"
                }`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField("")}
                required
              />
              <label
                className={`${labelBase} ${
                  focusedField === "email" || email
                    ? floatLabel
                    : defaultLabel
                }`}
              >
                Email
              </label>
            </div>

            <div className={inputWrapper}>
              <FaLock className="absolute top-3 left-3 text-gray-500" />
              <input
                type={showPass ? "text" : "password"}
                className={`${inputBase} ${
                  !password && focusedField === "password"
                    ? inputInvalid
                    : "border-gray-300"
                }`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField("")}
                required
              />
              <label
                className={`${labelBase} ${
                  focusedField === "password" || password
                    ? floatLabel
                    : defaultLabel
                }`}
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPass((prev) => !prev)}
                className="absolute top-2.5 right-3 text-gray-500 hover:text-gray-700"
              >
                {showPass ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-300 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-40 px-4 py-2 font-medium text-black bg-white rounded-full hover:bg-green-400 self-center"
            >
              {loading ? "Please wait..." : "Register"}
            </button>

            <p className="text-center text-sm text-white">
              Already have an account?{" "}
              <button
                type="button"
                onClick={toggleForm}
                className="text-purple-300 no-underline hover:underline"
              >
                Log In
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default UserForm;
