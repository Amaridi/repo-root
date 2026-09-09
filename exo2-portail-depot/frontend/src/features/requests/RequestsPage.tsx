import { Button, Table, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { fetchDepositRequests, type DepositRequest } from './requests.api';
import { formatDate, statusOf } from './request.helpers';

export function RequestsPage() {
  const navigate = useNavigate();
  const requests = useQuery({ queryKey: ['deposits'], queryFn: fetchDepositRequests });

  return (
    <AppShell
      title="Demandes de depot"
      description="Suivi des pieces sollicitees aupres des clients."
      action={
        <Button variant="div" onClick={() => navigate('/demandes/nouvelle')}>
          Nouvelle demande
        </Button>
      }
    >
      {requests.isPending && <LoadingState label="Chargement des demandes..." />}
      {requests.isError && <ErrorState />}

      {requests.isSuccess && requests.data.length === 0 && (
        <EmptyState
          title="Aucune demande"
          description="Creez une demande pour obtenir un lien de depot a transmettre a votre client."
          action={
            <Button variant="div" onClick={() => navigate('/demandes/nouvelle')}>
              Creer une demande
            </Button>
          }
        />
      )}

      {requests.isSuccess && requests.data.length > 0 && (
        <Card p="0" overflowX="auto">
          <Table.Root size="md">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Objet</Table.ColumnHeader>
                <Table.ColumnHeader>Client</Table.ColumnHeader>
                <Table.ColumnHeader>Statut</Table.ColumnHeader>
                <Table.ColumnHeader>Pieces</Table.ColumnHeader>
                <Table.ColumnHeader>Echeance</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {requests.data.map((request: DepositRequest) => (
                <Table.Row key={request.id}>
                  <Table.Cell fontWeight="600">{request.title}</Table.Cell>
                  <Table.Cell>{request.clientName}</Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={statusOf(request)} />
                  </Table.Cell>
                  <Table.Cell>{request.documentsCount}</Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm" color={request.isExpired ? 'state.dangerFg' : 'fg.muted'}>
                      {formatDate(request.expiresAt)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <RouterLink to={`/demandes/${request.id}`}>
                      <Button variant="divGhost" size="sm">
                        Consulter
                      </Button>
                    </RouterLink>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card>
      )}
    </AppShell>
  );
}
