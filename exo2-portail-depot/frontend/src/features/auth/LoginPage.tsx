import { Box, Button, Container, Field, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { z } from 'zod';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/States';
import { useLogin, useSession } from './useSession';

const schema = z.object({
  email: z.string().min(1, 'Adresse requise.').email('Adresse electronique invalide.'),
  password: z.string().min(1, 'Mot de passe requis.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { isAuthenticated } = useSession();
  const loginMutation = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Deja connecte : la page de connexion n a pas de raison de s afficher.
  if (isAuthenticated) {
    return <Navigate to="/demandes" replace />;
  }

  return (
    <Box minH="100vh" bg="bg.accent" display="flex" alignItems="center">
      <Container maxW="md" py="12">
        <Stack gap="6">
          <Stack gap="1" textAlign="center">
            <Heading size="lg">Portail de depot de pieces</Heading>
            <Text fontSize="sm" color="fg.muted">
              Espace reserve aux avocats du cabinet.
            </Text>
          </Stack>

          <Card>
            <form onSubmit={handleSubmit((values) => loginMutation.mutate(values))} noValidate>
              <Stack gap="5">
                <Field.Root invalid={Boolean(errors.email)}>
                  <Field.Label>Adresse electronique</Field.Label>
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="avocat@cabinet.fr"
                    {...register('email')}
                  />
                  <Field.ErrorText>{errors.email?.message}</Field.ErrorText>
                </Field.Root>

                <Field.Root invalid={Boolean(errors.password)}>
                  <Field.Label>Mot de passe</Field.Label>
                  <Input type="password" autoComplete="current-password" {...register('password')} />
                  <Field.ErrorText>{errors.password?.message}</Field.ErrorText>
                </Field.Root>

                {/* Le message reste generique, comme la reponse de l API : on ne
                    confirme pas l existence d un compte. */}
                {loginMutation.isError && <ErrorState message="Identifiants invalides." />}

                <Button type="submit" variant="div" loading={loginMutation.isPending} width="full">
                  Se connecter
                </Button>
              </Stack>
            </form>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
