export type RetryDecisionAction = 'retry' | 'fail' | 'deadletter';

export interface RetryDecisionContext {
  attempt: number;
  maxAttempts: number;
  queueName: string;
  jobId: string;
  isTimeout: boolean;
  errorName?: string;
  errorCode?: string;
  errorMessage: string;
}

export interface RetryDecision {
  action: RetryDecisionAction;
  backoffMs?: number;
  maxAttempts?: number;
}

export interface QueueRetryPolicyRuleMatch {
  name?: string;
  code?: string;
  messageIncludes?: string;
  timeout?: boolean;
}

export interface QueueRetryPolicyRule extends RetryDecision {
  when: QueueRetryPolicyRuleMatch;
}