export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function safeError(error: unknown): { code: string; message: string } {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'Operation failed. No sensitive diagnostic data was logged.' };
}
