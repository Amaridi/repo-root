import { Box, Container, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * Cadre des pages publiques.
 *
 * Volontairement distinct de AppShell : aucun lien vers l espace avocat, aucun
 * bouton de deconnexion avocat, aucune mention du cabinet au-dela du nom de
 * l avocat concerne. Le client ne doit pas meme voir qu il existe une autre
 * partie de l application.
 */
export function DepositShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Box minH="100vh" bg="bg.accent" py={{ base: '8', md: '16' }}>
      <Container maxW="2xl">
        <Stack gap="8">
          <Stack gap="1">
            <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
              Depot de pieces
            </Text>
            <Heading size="lg">{title}</Heading>
            {subtitle && (
              <Text color="fg.muted" fontSize="sm">
                {subtitle}
              </Text>
            )}
          </Stack>

          {children}

          <Flex justify="center">
            <Text fontSize="xs" color="fg.subtle">
              Transmission securisee. Vos documents ne sont accessibles qu a votre avocat.
            </Text>
          </Flex>
        </Stack>
      </Container>
    </Box>
  );
}
