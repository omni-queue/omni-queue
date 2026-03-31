export type SerializedExecutionError = {
  message: string;
  name?: string;
  code?: string;
};

export function serializeExecutionError(error: unknown): SerializedExecutionError {
  if (error instanceof Error) {
    const serialized: SerializedExecutionError = {
      message: error.message,
      ...(error.name ? { name: error.name } : {}),
    };

    const errorWithCode = error as Error & { code?: string };
    if (typeof errorWithCode.code === 'string') {
      serialized.code = errorWithCode.code;
    }

    return serialized;
  }

  return {
    message: String(error),
  };
}

export function deserializeExecutionError(payload: unknown): Error {
  if (payload instanceof Error) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const value = payload as { message?: string; name?: string; code?: string };
    const error = new Error(value.message ?? 'Unknown job error');
    if (value.name) {
      error.name = value.name;
    }
    if (value.code) {
      (error as Error & { code?: string }).code = value.code;
    }
    return error;
  }

  return new Error(String(payload));
}