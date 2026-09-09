import { Alert, Box, Center, Spinner, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * Les trois etats que toute vue de donnees doit savoir afficher.
 *
 * Factorises ici pour qu ils soient identiques partout : un chargement qui ne
 * ressemble pas au precedent donne l impression que l application est cassee.
 * Aucune couleur en dur — uniquement des tokens de la charte.
 */

export function LoadingState({ label = 'Chargement...' }: { label?: string }) {
  return (
    <Center py="12">
      <Stack align="center" gap="3">
        <Spinner size="lg" color="fg.accent" />
        <Text fontSize="sm" color="fg.muted">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <Alert.Root status="error" borderRadius="lg">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Une erreur est survenue</Alert.Title>
        <Alert.Description>
          {message ?? 'Impossible de recuperer les donnees. Reessayez dans un instant.'}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="bg.accent"
      py="12"
      px="6"
      textAlign="center"
    >
      <Stack gap="3" align="center">
        <Text fontWeight="600">{title}</Text>
        {description && (
          <Text fontSize="sm" color="fg.muted" maxW="md">
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </Box>
  );
}
