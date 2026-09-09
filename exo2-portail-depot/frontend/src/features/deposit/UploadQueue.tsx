import { Alert, Box, Button, Flex, Progress, Stack, Text } from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { uploadDocument } from './deposit.api';
import { describeDepositError } from './deposit.errors';
import { ACCEPT_ATTRIBUTE, checkFile, formatSize } from './deposit.rules';
import { DEPOSIT_DOCUMENTS_QUERY_KEY, DEPOSIT_SESSION_QUERY_KEY } from './deposit.queries';

type ItemStatus = 'attente' | 'envoi' | 'termine' | 'echec';

interface QueueItem {
  key: string;
  file: File;
  progress: number;
  status: ItemStatus;
  error?: string;
}

/**
 * File d attente de depot.
 *
 * Les fichiers sont envoyes SEQUENTIELLEMENT et non en parallele : c est plus
 * lisible pour le client, plus doux pour une connexion faible, et cela evite
 * qu un lot entier echoue sur un quota atteint au milieu.
 *
 * Chaque element porte sa propre progression et sa propre erreur : un fichier
 * refuse ne fait pas echouer les autres.
 */
export function UploadQueue({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isSending, setIsSending] = useState(false);

  function update(key: string, patch: Partial<QueueItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function handleSelection(files: FileList | null) {
    if (!files || files.length === 0) return;

    const queued: QueueItem[] = Array.from(files).map((file, index) => {
      const rejection = checkFile(file);
      return {
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        progress: 0,
        // Le refus local est immediat : inutile de televerser un fichier que le
        // serveur rejettera.
        status: rejection ? 'echec' : 'attente',
        error: rejection ?? undefined,
      };
    });

    setItems((current) => [...current, ...queued]);
    if (inputRef.current) inputRef.current.value = '';

    setIsSending(true);
    for (const item of queued) {
      if (item.status === 'echec') continue;

      update(item.key, { status: 'envoi' });
      try {
        await uploadDocument(item.file, (percent) => update(item.key, { progress: percent }));
        update(item.key, { status: 'termine', progress: 100 });
        // La liste des pieces et le compteur sont relus depuis le serveur : lui
        // seul sait ce qui est reellement disponible.
        await queryClient.invalidateQueries({ queryKey: DEPOSIT_DOCUMENTS_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: DEPOSIT_SESSION_QUERY_KEY });
      } catch (error) {
        update(item.key, { status: 'echec', error: describeDepositError(error).message });
      }
    }
    setIsSending(false);
  }

  const pendingCount = items.filter((item) => item.status === 'envoi' || item.status === 'attente')
    .length;

  return (
    <Stack gap="4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        onChange={(event) => void handleSelection(event.target.files)}
        style={{ display: 'none' }}
      />

      <Flex gap="3" align="center" wrap="wrap">
        <Button
          variant="div"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isSending}
          loading={isSending}
        >
          Choisir des fichiers
        </Button>
        <Text fontSize="sm" color="fg.muted">
          PDF, images et documents bureautiques. 25 Mo par fichier au maximum.
        </Text>
      </Flex>

      {items.length > 0 && (
        <Stack gap="3">
          {items.map((item) => (
            <Box
              key={item.key}
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              p="3"
              bg="bg.surface"
            >
              <Stack gap="2">
                <Flex justify="space-between" gap="3" align="baseline">
                  <Text fontSize="sm" fontWeight="600" wordBreak="break-all">
                    {item.file.name}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" flexShrink="0">
                    {formatSize(item.file.size)}
                  </Text>
                </Flex>

                {item.status === 'envoi' && (
                  <Progress.Root value={item.progress} size="sm" colorPalette="purple">
                    <Progress.Track>
                      <Progress.Range bg="brand.primary" />
                    </Progress.Track>
                  </Progress.Root>
                )}

                <Text
                  fontSize="xs"
                  color={
                    item.status === 'echec'
                      ? 'state.dangerFg'
                      : item.status === 'termine'
                        ? 'state.successFg'
                        : 'fg.muted'
                  }
                >
                  {item.status === 'attente' && 'En attente'}
                  {item.status === 'envoi' && `Envoi ${item.progress} %`}
                  {item.status === 'termine' && 'Transmis'}
                  {item.status === 'echec' && (item.error ?? 'Echec')}
                </Text>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {pendingCount > 0 && (
        <Alert.Root status="info" borderRadius="lg">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              Envoi en cours. Ne fermez pas cette page.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </Stack>
  );
}
