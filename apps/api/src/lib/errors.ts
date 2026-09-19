export class ProviderUnavailableError extends Error {
  public constructor(message = 'Provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class NotFoundError extends Error {
  public constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends Error {
  public constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class PersistenceError extends Error {
  public constructor(message = 'Persistence unavailable') {
    super(message);
    this.name = 'PersistenceError';
  }
}
