/** The compact boundary every payment provider sits behind (section
 * O/P) — PaymentsService never speaks a provider's own vocabulary
 * directly. */
export interface CheckoutInitRequest {
  providerReference: string;
  email: string;
  amountMinor: number;
  currency: string;
  callbackUrl: string;
}

export interface CheckoutInitResult {
  checkoutUrl: string;
}

export type PaymentWebhookOutcome =
  | { kind: 'PAID'; providerReference: string; amountMinor: number; currency: string }
  | { kind: 'FAILED'; providerReference: string }
  | { kind: 'IGNORED' };

export interface ParsedPaymentWebhookEvent {
  externalEventId: string;
  eventType: string;
  outcome: PaymentWebhookOutcome;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  initializeCheckout(request: CheckoutInitRequest): Promise<CheckoutInitResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;
  parseWebhookEvent(rawBody: string): ParsedPaymentWebhookEvent;
}
