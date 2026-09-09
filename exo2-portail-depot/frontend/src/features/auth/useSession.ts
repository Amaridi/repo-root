import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentLawyer, login, logout, type Credentials, type Lawyer } from './auth.api';

export const SESSION_QUERY_KEY = ['session'] as const;

/**
 * Etat d authentification.
 *
 * Il n y a volontairement AUCUN contexte React ni store global : la session est
 * une donnee serveur, et TanStack Query en est deja le cache. Dupliquer cet etat
 * dans un provider creerait deux sources de verite qui finiraient par divergerer.
 *
 * `retry: false` est essentiel : un 401 est une reponse legitime — « pas
 * connecte » — pas une panne a reessayer trois fois.
 */
export function useSession() {
  const query = useQuery<Lawyer>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchCurrentLawyer,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    lawyer: query.data,
    isLoading: query.isPending,
    isAuthenticated: query.isSuccess,
    isUnauthenticated: query.isError,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (credentials: Credentials) => login(credentials),
    onSuccess: async () => {
      // Le profil est refetche plutot que devine : c est le serveur qui dit qui
      // est connecte.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      navigate('/demandes', { replace: true });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Tout le cache est vide : aucune donnee d un dossier ne doit survivre a
      // une deconnexion, y compris les listes deja chargees.
      queryClient.clear();
      navigate('/connexion', { replace: true });
    },
  });
}
