import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './features/auth/LoginPage';
import { DepositPage } from './features/deposit/DepositPage';
import { NewRequestPage } from './features/requests/NewRequestPage';
import { RequestDetailPage } from './features/requests/RequestDetailPage';
import { RequestsPage } from './features/requests/RequestsPage';
import { CharterPage } from './pages/CharterPage';

/**
 * Routage de l application.
 *
 * L espace avocat est place SOUS ProtectedRoute : une route ajoutee dans ce
 * bloc est protegee par defaut. C est la meme logique que la garde posee sur le
 * controleur entier cote backend — le defaut sur doit etre le defaut.
 *
 * Le parcours client vit sous /d/:token, hors de toute garde : c est le token
 * du lien, puis le PIN, qui font office d authentification. Aucune de ses pages
 * n importe quoi que ce soit de l espace avocat.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connexion" element={<LoginPage />} />

        {/* Parcours client anonyme : lien public + code a 6 chiffres. */}
        <Route path="/d/:token" element={<DepositPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/demandes" element={<RequestsPage />} />
          <Route path="/demandes/nouvelle" element={<NewRequestPage />} />
          <Route path="/demandes/:id" element={<RequestDetailPage />} />
        </Route>

        {/* Reference visuelle de la charte DIV, conservee comme test de fumee
            du systeme de design. */}
        <Route path="/_charte" element={<CharterPage />} />

        <Route path="/" element={<Navigate to="/demandes" replace />} />
        <Route path="*" element={<Navigate to="/demandes" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
