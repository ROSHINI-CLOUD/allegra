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
