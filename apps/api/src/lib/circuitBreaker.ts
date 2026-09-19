export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  public constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000
  ) {}

  public get isOpen(): boolean {
    return this.openUntil > Date.now();
  }

  public success(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  public failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }
}
