export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type PgErrorLike = {
  code?: string;
  constraint?: string;
};

export function isPgErrorCode(error: unknown, code: string): error is PgErrorLike {
  return typeof error === "object" && error !== null && "code" in error && (error as PgErrorLike).code === code;
}
