/**
 * Cles de cache du parcours client, centralisees pour eviter qu une
 * invalidation rate sa cible a cause d une faute de frappe.
 */
export const DEPOSIT_SESSION_QUERY_KEY = ['deposit-session'] as const;
export const DEPOSIT_DOCUMENTS_QUERY_KEY = ['deposit-documents'] as const;
export const publicDepositQueryKey = (token: string) => ['public-deposit', token] as const;
