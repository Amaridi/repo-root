import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../features/auth/useSession';
import { LoadingState } from './ui/States';

/**
 * Garde de route de l espace avocat.
 *
 * Elle ne decide RIEN elle-meme : elle interroge le serveur via /auth/me. Une
 * garde qui se fierait a un indicateur local serait contournable depuis la
 * console du navigateur, et surtout mensongere — le cookie peut avoir expire.
 *
 * Tant que la reponse n est pas arrivee, on affiche un chargement plutot que de
 * rediriger : rediriger trop tot ejecterait un utilisateur pourtant connecte a
 * chaque rechargement de page.
 */
export function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useSession();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState label="Verification de la session..." />;
  }

  if (!isAuthenticated) {
    // L URL demandee est conservee pour y revenir apres connexion.
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
