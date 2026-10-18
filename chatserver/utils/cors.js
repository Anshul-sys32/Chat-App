const configuredOrigins = () => [
  ...(process.env.CLIENT_ORIGINS || "").split(","),
  process.env.CLIENT_LOCAL,
  process.env.CLIENT_URL,
]
  .map((value) => value?.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const normalizedOrigin = parsedOrigin.origin;
  const exactMatch = configuredOrigins().some((value) => {
    try {
      return new URL(value).origin === normalizedOrigin;
    } catch {
      return false;
    }
  });
  if (exactMatch) return true;
  if (process.env.NODE_ENV === "production" || parsedOrigin.protocol !== "http:") return false;

  const isVitePort = Number(parsedOrigin.port || 80) >= 5173
    && Number(parsedOrigin.port || 80) <= 5199;
  if (!isVitePort) return false;

  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
  const matchesConfiguredHost = configuredOrigins().some((value) => {
    try {
      const configured = new URL(value);
      return configured.protocol === parsedOrigin.protocol
        && configured.hostname === parsedOrigin.hostname;
    } catch {
      return false;
    }
  });
  return isLoopback || matchesConfiguredHost;
};

const corsOrigin = (origin, callback) => {
  callback(null, isAllowedOrigin(origin));
};

module.exports = { corsOrigin, isAllowedOrigin };