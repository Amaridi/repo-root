import { Alert, Button, Flex, Heading, Separator, Stack, Text } from '@chakra-ui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { fetchDepositDocuments, submitDeposit, type DepositSession } from './deposit.api';
import { describeDepositError } from './deposit.errors';
import { DEPOSIT_DOCUMENTS_QUERY_KEY, DEPOSIT_SESSION_QUERY_KEY } from './deposit.queries';
import { formatDateTime, formatSize } from './deposit.rules';
import { UploadQueue } from './UploadQueue';

/**
 * Espace de depot, une fois le code valide.
 */
export function DepositWorkspace({
  session,
  onUnavailable,
}: {
  session: DepositSession;
  onUnavailable: () => void;
}) {
  const queryClient = useQueryClient();
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: DEPOSIT_DOCUMENTS_QUERY_KEY,
    queryFn: fetchDepositDocuments,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: submitDeposit,
    onSuccess: (result) => {
      // On conserve la confirmation en etat local : apres soumission, le lien
      // est ferme et toute nouvelle requete repondrait 404. Il n y a donc rien
      // a recharger.
      setSubmittedAt(result.submittedAt);
      queryClient.removeQueries({ queryKey: DEPOSIT_SESSION_QUERY_KEY });
      queryClient.removeQueries({ queryKey: DEPOSIT_DOCUMENTS_QUERY_KEY });
    },
    onError: (error) => {
      if (describeDepositError(error).isUnavailable) onUnavailable();
    },
  });

  if (submittedAt) {
    return (
      <Card>
        <Stack gap="4">
          <Alert.Root status="success" borderRadius="lg">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Depot transmis</Alert.Title>
              <Alert.Description>
                {session.lawyerName} a recu vos documents le {formatDateTime(submittedAt)}.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Text fontSize="sm" color="fg.muted">
            Ce lien n est plus utilisable. Vous pouvez fermer cette page.
          </Text>
        </Stack>
      </Card>
    );
  }

  const uploadedCount = documents.data?.length ?? session.documentsCount;

  return (
    <Stack gap="6">
      {session.instructions && (
        <Card bg="bg.accent">
          <Stack gap="2">
            <Heading size="sm">Pieces demandees</Heading>
            <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
              {session.instructions}
            </Text>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap="5">
          <Heading size="sm">Ajouter des documents</Heading>
          <UploadQueue disabled={submit.isPending} />
        </Stack>
      </Card>

      <Card>
        <Stack gap="4">
          <Flex justify="space-between" align="baseline" gap="3">
            <Heading size="sm">Documents transmis</Heading>
            <Text fontSize="sm" color="fg.muted">
              {uploadedCount} sur 10 au maximum
            </Text>
          </Flex>

          {documents.isPending && <LoadingState label="Chargement..." />}
          {documents.isError && <ErrorState message="Impossible de lister vos documents." />}

          {documents.isSuccess && documents.data.length === 0 && (
            <EmptyState
              title="Aucun document pour le moment"
              description="Utilisez le bouton ci-dessus pour ajouter vos pieces."
            />
          )}

          {documents.isSuccess && documents.data.length > 0 && (
            <Stack gap="3" separator={<Separator />}>
              {documents.data.map((document) => (
                <Flex key={document.id} justify="space-between" gap="3" align="baseline">
                  <Stack gap="0">
                    <Text fontSize="sm" fontWeight="600" wordBreak="break-all">
                      {document.originalName}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {document.confirmedAt ? formatDateTime(document.confirmedAt) : '—'}
                    </Text>
                  </Stack>
                  <Text fontSize="xs" color="fg.muted" flexShrink="0">
                    {formatSize(document.sizeBytes)}
                  </Text>
                </Flex>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="4">
          <Stack gap="1">
            <Heading size="sm">Terminer le depot</Heading>
            <Text fontSize="sm" color="fg.muted">
              Apres validation, le lien sera ferme et vous ne pourrez plus ajouter de document.
            </Text>
          </Stack>

          {submit.isError && <ErrorState message={describeDepositError(submit.error).message} />}

          <Button
            variant="div"
            onClick={() => submit.mutate()}
            loading={submit.isPending}
            disabled={uploadedCount === 0}
          >
            Valider et transmettre
          </Button>

          {uploadedCount === 0 && (
            <Text fontSize="xs" color="fg.muted">
              Ajoutez au moins un document pour pouvoir transmettre.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
