/** Every essential school notification this launch sends, and the exact
 * (subject, body) text for each — kept in one small, readable place
 * rather than scattered across every domain service that triggers one
 * (section N). Payload shapes are intentionally plain strings; this is a
 * school-operations outbox, not a templating platform. */
export type NotificationType =
  | 'ACCOUNT_REGISTERED'
  | 'PAYMENT_CONFIRMED'
  | 'SESSION_REMINDER'
  | 'SESSION_CANCELED'
  | 'SESSION_REPLACEMENT'
  | 'RECORDING_AVAILABLE';

export interface NotificationPayload {
  [key: string]: string;
}

export function renderNotification(
  type: NotificationType,
  payload: NotificationPayload,
): { subject: string; text: string } {
  switch (type) {
    case 'ACCOUNT_REGISTERED':
      return {
        subject: 'Welcome to TUBI Online School',
        text: `Hi ${payload.fullName}, your TUBI account has been created. Log in to select a subscription and start attending classes.`,
      };
    case 'PAYMENT_CONFIRMED':
      return {
        subject: 'Your TUBI subscription is active',
        text: `Your payment was confirmed and your subscription is now active. You can see your upcoming classes in your TUBI learner workspace.`,
      };
    case 'SESSION_REMINDER':
      return {
        subject: `Upcoming class: ${payload.courseTitle}`,
        text: `Your class "${payload.courseTitle}" starts at ${payload.startTime}. Join from your TUBI learner workspace when it begins.`,
      };
    case 'SESSION_CANCELED':
      return {
        subject: `Class canceled: ${payload.courseTitle}`,
        text: `Your class "${payload.courseTitle}" scheduled for ${payload.startTime} has been canceled.`,
      };
    case 'SESSION_REPLACEMENT':
      return {
        subject: `Class rescheduled: ${payload.courseTitle}`,
        text: `A replacement session for "${payload.courseTitle}" has been scheduled for ${payload.startTime}.`,
      };
    case 'RECORDING_AVAILABLE':
      return {
        subject: `Recording available: ${payload.courseTitle}`,
        text: `The recording for "${payload.courseTitle}" is now available in your TUBI learner workspace.`,
      };
    default:
      return {
        subject: 'TUBI Online School notification',
        text: 'You have a new school notification.',
      };
  }
}
