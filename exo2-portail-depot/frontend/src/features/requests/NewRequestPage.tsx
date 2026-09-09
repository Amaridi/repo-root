import {
  Alert,
  Box,
  Button,
  Clipboard,
  Code,
  Field,
  Flex,
  Heading,
  Input,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { AppShell } from '../../components/AppShell';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/States';
import {
  createDepositRequest,
  type CreatedDepositRequest,
  type CreateDepositRequestInput,
} from './requests.api';

/**
 * Les bornes reprennent celles de l API. Elles sont dupliquees a dessein : la
 * validation cote client est un confort d interface, celle du serveur est la
 * regle. Si les deux divergent, c est le serveur qui a raison.
 */
const schema = z.object({
  title: z.string().trim().min(3, 'Au moins 3 caracteres.').max(200, 'Au plus 200 caracteres.'),
  clientName: z.string().trim().min(2, 'Au moins 2 caracteres.').max(120, 'Au plus 120 caracteres.'),
  clientEmail: z.union([z.literal(''), z.string().email('Adresse electronique invalide.')]),
  instructions: z.string().max(2000, 'Au plus 2000 caracteres.'),
});

type FormValues = z.infer<typeof schema>;

export function NewRequestPage() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateDepositRequestInput) => createDepositRequest(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deposits'] }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', clientName: '', clientEmail: '', instructions: '' },
  });

  // Une fois la demande creee, le formulaire disparait : les secrets ne sont
  // affichables qu une fois, il ne faut pas risquer de les faire defiler hors
  // de l ecran.
  if (mutation.isSuccess) {
    return <CreatedRequestPanel created={mutation.data} />;
  }

  return (
    <AppShell
      title="Nouvelle demande de depot"
      description="Un lien unique et un code a 6 chiffres seront generes par le serveur."
    >
      <Card maxW="2xl">
        <form
          onSubmit={handleSubmit((values) =>
            mutation.mutate({
              title: values.title,
              clientName: values.clientName,
              // Les champs vides sont omis plutot qu envoyes vides : l API
              // attend un email valide ou rien du tout.
              clientEmail: values.clientEmail || undefined,
              instructions: values.instructions || undefined,
            }),
          )}
          noValidate
        >
          <Stack gap="5">
            <Field.Root invalid={Boolean(errors.title)} required>
              <Field.Label>
                Objet de la demande <Field.RequiredIndicator />
              </Field.Label>
              <Input placeholder="Pieces pour la succession Martin" {...register('title')} />
              <Field.ErrorText>{errors.title?.message}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={Boolean(errors.clientName)} required>
              <Field.Label>
                Nom du client <Field.RequiredIndicator />
              </Field.Label>
              <Input placeholder="Jeanne Martin" {...register('clientName')} />
              <Field.ErrorText>{errors.clientName?.message}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={Boolean(errors.clientEmail)}>
              <Field.Label>Adresse electronique du client</Field.Label>
              <Input type="email" placeholder="facultatif" {...register('clientEmail')} />
              <Field.HelperText>
                Sert uniquement a votre suivi. Aucun courriel n est envoye par l application.
              </Field.HelperText>
              <Field.ErrorText>{errors.clientEmail?.message}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={Boolean(errors.instructions)}>
              <Field.Label>Consignes au client</Field.Label>
              <Textarea
                rows={4}
                placeholder="Listez les pieces attendues."
                {...register('instructions')}
              />
              <Field.ErrorText>{errors.instructions?.message}</Field.ErrorText>
            </Field.Root>


            {mutation.isError && <ErrorState message="La demande n a pas pu etre creee." />}

            <Flex gap="3">
              <Button type="submit" variant="div" loading={mutation.isPending}>
                Creer la demande
              </Button>
              <RouterLink to="/demandes">
                <Button variant="divGhost" type="button">
                  Annuler
                </Button>
              </RouterLink>
            </Flex>
          </Stack>
        </form>
      </Card>
    </AppShell>
  );
}

/**
 * Ecran des secrets, affiche une seule fois.
 *
 * Le serveur ne conserve que le SHA-256 du token et le hash argon2 du PIN : ces
 * deux valeurs sont donc definitivement irrecuperables une fois cet ecran
 * quitte. L avertissement n est pas decoratif.
 */
function CreatedRequestPanel({ created }: { created: CreatedDepositRequest }) {
  return (
    <AppShell
      title="Demande creee"
      description="Transmettez le lien et le code par deux canaux differents."
      action={
        <RouterLink to={`/demandes/${created.request.id}`}>
          <Button variant="div">Voir la demande</Button>
        </RouterLink>
      }
    >
      <Stack gap="6" maxW="2xl">
        <Alert.Root status="warning" borderRadius="lg">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Ces informations ne seront plus affichees</Alert.Title>
            <Alert.Description>
              Seules leurs empreintes sont conservees. Copiez-les maintenant.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>

        <Card>
          <Stack gap="6">
            <SecretRow
              label="Lien de depot"
              value={created.access.depositUrl}
              hint="A transmettre par courriel."
            />
            <SecretRow
              label="Code a 6 chiffres"
              value={created.access.pin}
              hint="A transmettre par un autre canal, par telephone de preference."
            />
          </Stack>
        </Card>

        <Box>
          <Text fontSize="sm" color="fg.muted">
            Client : {created.request.clientName}. Lien valable jusqu au{' '}
            {new Date(created.request.expiresAt).toLocaleDateString('fr-FR')}.
          </Text>
        </Box>
      </Stack>
    </AppShell>
  );
}

function SecretRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Stack gap="2">
      <Heading size="sm">{label}</Heading>
      <Clipboard.Root value={value}>
        <Flex gap="3" align="center" wrap="wrap">
          <Code
            px="3"
            py="2"
            borderRadius="md"
            bg="bg.accent"
            color="fg.accent"
            fontSize="sm"
            wordBreak="break-all"
            flex="1"
            minW="0"
          >
            {value}
          </Code>
          <Clipboard.Trigger asChild>
            <Button variant="divGhost" size="sm">
              <Clipboard.Indicator copied="Copie" >Copier</Clipboard.Indicator>
            </Button>
          </Clipboard.Trigger>
        </Flex>
      </Clipboard.Root>
      <Text fontSize="xs" color="fg.muted">
        {hint}
      </Text>
    </Stack>
  );
}
