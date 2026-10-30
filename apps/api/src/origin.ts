function normalizeOrigin(value: string) {
  return new URL(value).origin;
}

/** Exact allow-list only: localhost conveniences plus the configured LAN URL. */
export function allowedRequestOrigins(publicWebUrl: string, nodeEnv: string, configuredOrigins?: string) {
  const origins = new Set([normalizeOrigin(publicWebUrl)]);
  if (nodeEnv !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  for (const value of configuredOrigins?.split(",") ?? []) {
    const candidate = value.trim();
    if (candidate) origins.add(normalizeOrigin(candidate));
  }
  return origins;
}

export function isAllowedRequestOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>) {
  return !origin || allowedOrigins.has(origin);
}
