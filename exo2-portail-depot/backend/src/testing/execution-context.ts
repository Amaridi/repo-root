import type { ExecutionContext } from '@nestjs/common';

/**
 * ExecutionContext minimal porteur de cookies.
 *
 * Les gardes ne lisent qu une chose du contexte : la requete HTTP et ses
 * cookies. Reconstruire un contexte complet n apporterait rien ; en revanche
 * la requete rendue est un VRAI objet, muté par la garde, ce qui permet de
 * verifier ce qu elle y injecte.
 */
export function contextWithCookies(cookies: Record<string, string> | undefined): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { cookies };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}
