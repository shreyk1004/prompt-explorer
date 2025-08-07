import jwt from "jsonwebtoken";

export type VerifiedJwt = {
  sub?: string;
  [key: string]: unknown;
};

export function requireJwtFromRequest(request: Request): VerifiedJwt {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Server misconfigured: missing JWT_SECRET env var");
  }
  try {
    const payload = jwt.verify(token, secret) as VerifiedJwt;
    return payload;
  } catch {
    throw new Error("Invalid JWT");
  }
}

