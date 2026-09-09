import { Box, Button, Container, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useLogout, useSession } from '../features/auth/useSession';

/**
 * Cadre de l espace avocat : en-tete, identite, deconnexion.
 *
 * Ton editorial conforme a la charte : formel, technique, phrases courtes.
 */
export function AppShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { lawyer } = useSession();
  const logout = useLogout();

  return (
    <Box minH="100vh" bg="bg">
      <Box borderBottomWidth="1px" borderColor="border" bg="bg.surface">
        <Container maxW="6xl" py="4">
          <Flex align="center" justify="space-between" gap="4">
            <RouterLink to="/demandes">
              <Heading size="md">Portail de depot de pieces</Heading>
            </RouterLink>
            <Flex align="center" gap="4">
              {lawyer && (
                <Text fontSize="sm" color="fg.muted">
                  {lawyer.displayName}
                </Text>
              )}
              <Button
                variant="divGhost"
                size="sm"
                onClick={() => logout.mutate()}
                loading={logout.isPending}
              >
                Se deconnecter
              </Button>
            </Flex>
          </Flex>
        </Container>
      </Box>

      <Container maxW="6xl" py="10">
        <Stack gap="8">
          <Flex
            align={{ base: 'flex-start', md: 'center' }}
            justify="space-between"
            gap="4"
            direction={{ base: 'column', md: 'row' }}
          >
            <Stack gap="1">
              <Heading size="lg">{title}</Heading>
              {description && (
                <Text color="fg.muted" fontSize="sm">
                  {description}
                </Text>
              )}
            </Stack>
            {action}
          </Flex>
          {children}
        </Stack>
      </Container>
    </Box>
  );
}
