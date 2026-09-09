import { Button, Flex, Heading, SimpleGrid, Stack, Table, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import {
  buildDocumentDownloadUrl,
  fetchDepositDocuments,
  fetchDepositRequest,
} from './requests.api';
import { formatDateTime, formatSize, statusOf } from './request.helpers';

export function RequestDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const request = useQuery({
    queryKey: ['deposits', id],
    queryFn: () => fetchDepositRequest(id),
    enabled: id.length > 0,
  });

  // Requete separee : les pieces se rafraichissent independamment de la fiche,
  // et une erreur sur l une ne doit pas masquer l autre.
  const documents = useQuery({
    queryKey: ['deposits', id, 'documents'],
    queryFn: () => fetchDepositDocuments(id),
    enabled: request.isSuccess,
  });

  if (request.isPending) {
    return (
      <AppShell title="Demande de depot">
        <LoadingState />
      </AppShell>
    );
  }

  if (request.isError || !request.data) {
    return (
      <AppShell
        title="Demande introuvable"
        action={
          <RouterLink to="/demandes">
            <Button variant="divGhost">Retour</Button>
          </RouterLink>
        }
      >
        <ErrorState message="Cette demande n existe pas, ou ne vous appartient pas." />
      </AppShell>
    );
  }

  const data = request.data;

  return (
    <AppShell
      title={data.title}
      description={`Client : ${data.clientName}`}
      action={
        <RouterLink to="/demandes">
          <Button variant="divGhost">Retour a la liste</Button>
        </RouterLink>
      }
    >
      <Stack gap="6">
        <Card>
          <SimpleGrid columns={{ base: 1, md: 4 }} gap="6">
            <Field label="Statut">
              <StatusBadge status={statusOf(data)} />
            </Field>
            <Field label="Pieces deposees">
              <Text fontWeight="600">{data.documentsCount}</Text>
            </Field>
            <Field label="Echeance du lien">
              <Text fontWeight="600" color={data.isExpired ? 'state.dangerFg' : undefined}>
                {formatDateTime(data.expiresAt)}
              </Text>
            </Field>
            <Field label="Soumise le">
              <Text fontWeight="600">
                {data.submittedAt ? formatDateTime(data.submittedAt) : '—'}
              </Text>
            </Field>
          </SimpleGrid>
        </Card>

        {data.instructions && (
          <Card>
            <Stack gap="2">
              <Heading size="sm">Consignes transmises</Heading>
              <Text color="fg.muted" whiteSpace="pre-wrap">
                {data.instructions}
              </Text>
            </Stack>
          </Card>
        )}

        <Stack gap="3">
          <Heading size="md">Pieces deposees</Heading>

          {documents.isPending && <LoadingState label="Chargement des pieces..." />}
          {documents.isError && <ErrorState message="Impossible de charger les pieces." />}

          {documents.isSuccess && documents.data.length === 0 && (
            <EmptyState
              title="Aucune piece deposee"
              description={
                data.isExpired
                  ? 'Le lien a expire avant tout depot.'
                  : 'Le client n a encore rien transmis.'
              }
            />
          )}

          {documents.isSuccess && documents.data.length > 0 && (
            <Card p="0" overflowX="auto">
              <Table.Root size="md">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Nom du fichier</Table.ColumnHeader>
                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Taille</Table.ColumnHeader>
                    <Table.ColumnHeader>Depose le</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {documents.data.map((document) => (
                    <Table.Row key={document.id}>
                      <Table.Cell fontWeight="600" wordBreak="break-all">
                        {document.originalName}
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          {document.mimeType}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>{formatSize(document.sizeBytes)}</Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          {document.confirmedAt ? formatDateTime(document.confirmedAt) : '—'}
                        </Text>
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {/* Lien natif volontairement : l API repond par une
                            redirection 302 vers une signature de 60 s. Le
                            navigateur suit la redirection et telecharge le
                            fichier directement depuis le stockage. */}
                        <a href={buildDocumentDownloadUrl(data.id, document.id)}>
                          <Button variant="divGhost" size="sm">
                            Telecharger
                          </Button>
                        </a>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
        </Stack>
      </Stack>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap="1">
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Flex align="center">{children}</Flex>
    </Stack>
  );
}
