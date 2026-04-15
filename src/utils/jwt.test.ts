import { describe, expect, it } from "vitest";
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from "./jwt.js";

describe("jwt", () => {
  it("round-trips access token", () => {
    const t = signAccessToken({ sub: "42", email: "a@b.com" });
    const p = verifyAccessToken(t);
    expect(p.sub).toBe("42");
    expect(p.email).toBe("a@b.com");
  });

  it("round-trips refresh token with jti", () => {
    const t = signRefreshToken({ sub: "42", email: "a@b.com", jti: "jti-1" });
    const p = verifyRefreshToken(t);
    expect(p.sub).toBe("42");
    expect(p.email).toBe("a@b.com");
    expect(p.jti).toBe("jti-1");
    expect(p.typ).toBe("refresh");
  });
});
