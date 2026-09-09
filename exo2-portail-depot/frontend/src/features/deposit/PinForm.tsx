import { Alert, Button, PinInput, Stack, Text } from '@chakra-ui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { verifyPin } from './deposit.api';
import { describeDepositError, type DepositErrorInfo } from './deposit.errors';
import { DEPOSIT_SESSION_QUERY_KEY } from './deposit.queries';

/**
 * Saisie du code a 6 chiffres.
 *
 * Le code n est jamais conserve : il vit dans l etat local le temps de la
 * requete, puis le serveur repond par un cookie de session. Aucune trace dans
 * localStorage, aucune reutilisation possible.
 */
export function PinForm({ token, onUnavailable }: { token: string; onUnavailable: () => void }) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState<string[]>([]);
  const [failure, setFailure] = useState<DepositErrorInfo | null>(null);

  const mutation = useMutation({
    mutationFn: (code: string) => verifyPin(token, code),
    onSuccess: async () => {
      setFailure(null);
      setPin([]);
      // Le serveur a pose le cookie ; on lui redemande l etat de la demande
      // plutot que de le deviner.
      await queryClient.invalidateQueries({ queryKey: DEPOSIT_SESSION_QUERY_KEY });
    },
    onError: (error) => {
      const info = describeDepositError(error);
      setFailure(info);
      setPin([]);
      if (info.isUnavailable) {
        onUnavailable();
      }
    },
  });

  const isLocked = Boolean(failure?.retryAfterSeconds);

  return (
    <Card>
      <Stack gap="6">
        <Stack gap="1">
          <Text fontWeight="600">Saisissez le code a 6 chiffres</Text>
          <Text fontSize="sm" color="fg.muted">
            Ce code vous a ete communique separement par votre avocat.
          </Text>
        </Stack>

        <PinInput.Root
          value={pin}
          onValueChange={(event) => setPin(event.value)}
          // Validation automatique a la sixieme touche : le client n a pas a
          // chercher un bouton apres avoir tape son code.
          onValueComplete={(event) => {
            if (!isLocked) mutation.mutate(event.valueAsString);
          }}
          otp
          count={6}
          disabled={isLocked || mutation.isPending}
          invalid={Boolean(failure) && !isLocked}
        >
          <PinInput.HiddenInput />
          <PinInput.Control>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <PinInput.Input key={index} index={index} />
            ))}
          </PinInput.Control>
        </PinInput.Root>

        {failure && (
          <Alert.Root status={isLocked ? 'warning' : 'error'} borderRadius="lg">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                {failure.message}
                {failure.attemptsLeft !== undefined && failure.attemptsLeft > 0 && (
                  <>
                    {' '}
                    Il vous reste {failure.attemptsLeft}{' '}
                    {failure.attemptsLeft > 1 ? 'tentatives' : 'tentative'}.
                  </>
                )}
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        <Button
          variant="div"
          width="full"
          loading={mutation.isPending}
          disabled={pin.length < 6 || isLocked}
          onClick={() => mutation.mutate(pin.join(''))}
        >
          Acceder au depot
        </Button>
      </Stack>
    </Card>
  );
}
