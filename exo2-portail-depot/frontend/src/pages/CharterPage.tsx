import { Box, Button, Container, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { Card } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/StatusBadge';

/**
 * Reference visuelle de la charte DIV Protocol.
 *
 * Conservee volontairement : elle sert de test de fumee du systeme de design et
 * de preuve de conformite. Chaque valeur affichee vient des tokens du theme,
 * aucune n est ecrite en dur ici.
 */
export function CharterPage() {
  const colors: Array<[string, string, string]> = [
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
    <Box minH="100vh" bg="bg">
      <Box borderBottomWidth="1px" borderColor="border">
        <Container maxW="6xl" py="4">
          <Flex align="center" justify="space-between">
            <Heading size="md">Charte graphique</Heading>
            <Text fontSize="sm" color="fg.muted">
              DIV Protocol
            </Text>
          </Flex>
        </Container>
      </Box>

      <Container maxW="6xl" py="10">
        <Stack gap="8">
          <Card>
            <Heading size="sm" mb="4">
              Couleurs
            </Heading>
            <Flex wrap="wrap" gap="4">
              {colors.map(([label, token, hex]) => (
                <Stack key={token} gap="1" w="140px">
                  <Box
                    h="56px"
                    bg={token}
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor="border"
                  />
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
            <Flex gap="4" align="center" wrap="wrap">
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
      </Container>
    </Box>
  );
}
