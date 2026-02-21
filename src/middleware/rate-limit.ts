import rateLimit from "express-rate-limit";

/**
 * Strict rate limiter for public unauthenticated endpoints.
 * Prevents DoS and queue flooding.
 */
export const publicIntakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 submissions per 15 min
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: "Too many submissions from this IP, please try again later." },
});

/**
 * General API rate limiter for authenticated routes.
 * Generous limit to allow normal usage but prevent abuse.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
});
