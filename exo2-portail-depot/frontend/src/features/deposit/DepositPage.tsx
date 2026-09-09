import { Alert, Stack, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/States';
import { fetchDepositSession, resolveDeposit, type DepositSession, type PublicDeposit } from './deposit.api';
import { describeDepositError } from './deposit.errors';
import { DEPOSIT_SESSION_QUERY_KEY, publicDepositQueryKey } from './deposit.queries';
import { DepositShell } from './DepositShell';
import { DepositWorkspace } from './DepositWorkspace';
import { PinForm } from './PinForm';
import { formatDateTime } from './deposit.rules';

/**
 * Point d entree du parcours client : /d/:token
 *
 * Trois etats possibles, decides par le SERVEUR et non par ce composant :
 *  - le lien est inutilisable            -> message clair, rien d autre ;
 *  - le lien est valide, pas de session  -> saisie du code ;
 *  - une session est ouverte             -> espace de depot.
 */
export function DepositPage() {
  const { token = '' } = useParams<{ token: string }>();

  // Metadonnees d affichage. Un 404 signifie inconnu, expire, deja soumis ou
  // cloture — indistinctement, par choix du serveur.
  const deposit = useQuery({
    queryKey: publicDepositQueryKey(token),
    queryFn: () => resolveDeposit(token),
    retry: false,
    enabled: token.length > 0,
  });

  // Session eventuelle. Un echec est le cas NORMAL avant saisie du code : ce
  // n est pas une erreur a afficher.
  const session = useQuery({
    queryKey: DEPOSIT_SESSION_QUERY_KEY,
    queryFn: fetchDepositSession,
    retry: false,
  });

  if (deposit.isPending) {
    return (
      <DepositShell title="Depot de pieces">
        <LoadingState label="Verification du lien..." />
      </DepositShell>
    );
  }

  if (deposit.isError || !deposit.data) {
    return <UnavailableNotice message={describeDepositError(deposit.error).message} />;
  }

  const publicDeposit = deposit.data;

  // Cas limite reel : le navigateur porte deja une session ouverte pour une
  // AUTRE demande (deux liens ouverts a la suite). Les identifiants techniques
  // ne sont pas exposes cote public, on compare donc ce qui est affichable. En
  // cas de desaccord, on redemande le code plutot que de montrer le mauvais
  // dossier.
  const sessionMatchesLink =
    session.isSuccess && matches(session.data, publicDeposit) ? session.data : null;

  return (
    <DepositShell
      title={publicDeposit.title}
      subtitle={`Demande de ${publicDeposit.lawyerName} — a l attention de ${publicDeposit.clientName}`}
    >
      <Stack gap="6">
        {sessionMatchesLink ? (
          <DepositWorkspace
            session={sessionMatchesLink}
            onUnavailable={() => void session.refetch()}
          />
        ) : (
          <>
            {publicDeposit.instructions && (
              <Card bg="bg.accent">
                <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
                  {publicDeposit.instructions}
                </Text>
              </Card>
            )}
            <PinForm token={token} onUnavailable={() => void deposit.refetch()} />
          </>
        )}

        <Text fontSize="xs" color="fg.subtle" textAlign="center">
          Lien valable jusqu au {formatDateTime(publicDeposit.expiresAt)}.
        </Text>
      </Stack>
    </DepositShell>
  );
}

function matches(session: DepositSession, publicDeposit: PublicDeposit): boolean {
  return (
    session.title === publicDeposit.title &&
    session.clientName === publicDeposit.clientName &&
    session.expiresAt === publicDeposit.expiresAt
  );
}

function UnavailableNotice({ message }: { message: string }) {
  return (
    <DepositShell title="Lien indisponible">
      <Card>
        <Stack gap="4">
          <Alert.Root status="warning" borderRadius="lg">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Ce lien ne peut pas etre ouvert</Alert.Title>
              <Alert.Description>{message}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Text fontSize="sm" color="fg.muted">
            Aucune action n est possible depuis cette page. Votre avocat peut vous transmettre un
            nouveau lien.
          </Text>
        </Stack>
      </Card>
    </DepositShell>
  );
}
