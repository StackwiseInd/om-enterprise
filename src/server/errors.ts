import { PricingError } from "@/lib/pricing/engine";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "APPROVAL_REQUIRED"
  | "PRECONDITION"
  | "INTEGRITY"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  APPROVAL_REQUIRED: 409,
  PRECONDITION: 412,
  INTEGRITY: 409,
  INTERNAL: 500,
};

/** Expected, user-presentable failure. Message is safe to show to staff. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const forbidden = (msg = "You do not have permission to do this") => new AppError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found`);
/** The request itself can't be trusted (e.g. a payment signature that doesn't match): 400. */
export const badRequest = (msg: string, details?: Record<string, unknown>) => new AppError("BAD_REQUEST", msg, details);
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError("VALIDATION", msg, details);
export const conflict = (msg: string, details?: Record<string, unknown>) => new AppError("CONFLICT", msg, details);
export const precondition = (msg: string, details?: Record<string, unknown>) =>
  new AppError("PRECONDITION", msg, details);

interface PgError {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
}

function pgErrorOf(err: unknown): PgError | null {
  let e: unknown = err;
  // drizzle wraps driver errors in `cause`
  for (let i = 0; i < 3 && e; i++) {
    const pe = e as PgError & { cause?: unknown };
    if (typeof pe.code === "string" && /^[0-9A-Z]{5}$/.test(pe.code)) return pe;
    e = pe.cause;
  }
  return null;
}

/** Normalise any thrown value into an AppError (unknown errors become INTERNAL, details hidden). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof PricingError) return new AppError("VALIDATION", err.message, { pricingCode: err.code, line: err.lineKey });
  const pg = pgErrorOf(err);
  if (pg) {
    if (pg.code === "23001" && pg.message?.startsWith("om_integrity:")) {
      return new AppError("INTEGRITY", pg.message.replace("om_integrity: ", ""));
    }
    if (pg.code === "23505") {
      return new AppError("CONFLICT", uniqueMessage(pg.constraint), { constraint: pg.constraint });
    }
    if (pg.code === "23503") return new AppError("CONFLICT", "This record is referenced by other records");
    if (pg.code === "23514") return new AppError("VALIDATION", `Invalid value (${pg.constraint ?? "check failed"})`);
    if (pg.code === "40001" || pg.code === "40P01") {
      return new AppError("CONFLICT", "Another update happened at the same time — please retry");
    }
  }
  return new AppError("INTERNAL", "Something went wrong. Please try again.");
}

function uniqueMessage(constraint?: string): string {
  switch (constraint) {
    case "variants_sku_uq":
      return "That SKU is already used by another variant";
    case "variants_barcode_uq":
      return "That barcode is already used by another variant";
    case "users_username_lower_uq":
      return "That username is already taken";
    case "payments_reference_uq":
      return "This transaction reference (UTR) has already been used to confirm another payment";
    case "payments_provider_payment_uq":
      return "This gateway payment has already been recorded";
    case "documents_doc_number_unique":
    case "documents_series_seq_uq":
      return "Document number collision — please retry";
    default:
      return "A record with these details already exists";
  }
}
