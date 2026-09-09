import { BrowserRouter, Link as RouterLink, Route, Routes } from 'react-router-dom';
import { Box, Button, Container, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { Card } from './components/ui/Card';
import { StatusBadge } from './components/ui/StatusBadge';

/**
 * Bloc 1 — squelette. Les ecrans reels (connexion avocat, liste des demandes,
 * page de depot client) arrivent au bloc 7.
 *
 * La route /_charte est conservee volontairement : elle sert de reference
 * visuelle a la charte DIV et de test de fumee du systeme de design.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Box minH="100vh" bg="bg">
      <Box borderBottomWidth="1px" borderColor="border">
        <Container maxW="6xl" py="4">
          <Flex align="center" justify="space-between">
            <Heading size="md">Portail de depot de pieces</Heading>
            <Text fontSize="sm" color="fg.muted">
              DIV Protocol
            </Text>
          </Flex>
        </Container>
      </Box>
      <Container maxW="6xl" py="10">
        {children}
      </Container>
    </Box>
  );
}

function HomePage() {
  // Verifie de bout en bout que le proxy /api atteint le backend et que la
  // base de donnees repond.
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get('/health/ready')).data as { status: string },
  });

  return (
    <Shell>
      <Stack gap="6">
        <Card>
          <Stack gap="3">
            <Heading size="lg">Socle technique</Heading>
            <Text color="fg.muted">
              Backend NestJS, PostgreSQL, MinIO. Les ecrans fonctionnels sont en cours.
            </Text>
            <Flex align="center" gap="3">
              <Text fontSize="sm" color="fg.muted">
                Etat de l'API :
              </Text>
              {health.isPending && <Text fontSize="sm">verification...</Text>}
              {health.isSuccess && <StatusBadge status="SUBMITTED" />}
              {health.isError && <StatusBadge status="EXPIRED" />}
            </Flex>
          </Stack>
        </Card>
        <RouterLink to="/_charte">
          <Button variant="div">Voir la charte graphique</Button>
        </RouterLink>
      </Stack>
    </Shell>
  );
}

function CharterPage() {
  const colors = [
    ['primary', 'brand.primary', '#5100FF'],
    ['secondary', 'brand.secondary', '#916ED8'],
    ['texte', 'brand.text', '#000000'],
    ['gris', 'brand.grey', '#585858'],
    ['gris clair', 'brand.greyLight', '#CECECE'],
    ['bordure', 'brand.border', '#E9E9E9'],
    ['fond accent', 'brand.accentBg', '#F7F6FF'],
    ['accent doux', 'brand.accentSoft', '#DBCDFF'],
  ];

  return (
    <Shell>
      <Stack gap="8">
        <Heading size="lg">Charte graphique</Heading>

        <Card>
          <Heading size="sm" mb="4">
            Couleurs
          </Heading>
          <Flex wrap="wrap" gap="4">
            {colors.map(([label, token, hex]) => (
              <Stack key={token} gap="1" w="140px">
                <Box h="56px" bg={token} borderRadius="md" borderWidth="1px" borderColor="border" />
                <Text fontSize="sm" fontWeight="600">
                  {label}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {hex}
                </Text>
              </Stack>
            ))}
          </Flex>
        </Card>

        <Card>
          <Heading size="sm" mb="4">
            Etats
          </Heading>
          <Flex gap="3" wrap="wrap">
            <StatusBadge status="PENDING" />
            <StatusBadge status="IN_PROGRESS" />
            <StatusBadge status="SUBMITTED" />
            <StatusBadge status="CLOSED" />
            <StatusBadge status="EXPIRED" />
          </Flex>
        </Card>

        <Card>
          <Heading size="sm" mb="4">
            Boutons
          </Heading>
          <Flex gap="4" align="center">
            <Button variant="div">Action primaire</Button>
            <Button variant="divGhost">Action secondaire</Button>
            <Button variant="div" disabled>
              Indisponible
            </Button>
          </Flex>
          <Text fontSize="sm" color="fg.muted" mt="3">
            Survoler le bouton primaire : fond accent, texte primary, contour inset.
          </Text>
        </Card>

        <Card>
          <Heading size="sm" mb="4">
            Typographie — Inter
          </Heading>
          <Stack gap="2">
            <Heading size="xl">Titre 600</Heading>
            <Text>Corps de texte 400. Ton formel, technique, phrases courtes.</Text>
            <Text color="fg.muted">Texte secondaire, gris #585858.</Text>
          </Stack>
        </Card>
      </Stack>
    </Shell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/_charte" element={<CharterPage />} />
      </Routes>
    </BrowserRouter>
  );
}
