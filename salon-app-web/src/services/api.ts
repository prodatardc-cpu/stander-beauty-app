import axios, { isAxiosError } from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// VITE_API_URL is checked when the app is built (vite.config.ts, config/apiUrl.ts): the localhost
// fallback only exists for the development server and is removed from production bundles.
const API_BASE_URL = import.meta.env.VITE_API_URL?.trim() || (import.meta.env.DEV ? 'http://localhost:3000/api' : '');
export const authTokenKey = 'authToken';

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem(authTokenKey);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // An expired session sends the user back to the login page, except for the
    // login/register calls themselves whose 401 simply means "wrong credentials".
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = String(error.config?.url ?? '');
        if (error.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
          localStorage.removeItem(authTokenKey);
          if (window.location.pathname !== '/login') window.location.assign('/login');
        }
        return Promise.reject(error);
      }
    );
  }

  get<T>(url: string, params?: unknown) {
    return this.client.get<T>(url, { params });
  }

  post<T>(url: string, data?: unknown, headers?: Record<string, string>) {
    return this.client.post<T>(url, data, headers ? { headers } : undefined);
  }

  put<T>(url: string, data?: unknown) {
    return this.client.put<T>(url, data);
  }

  patch<T>(url: string, data?: unknown) {
    return this.client.patch<T>(url, data);
  }

  delete<T>(url: string) {
    return this.client.delete<T>(url);
  }
}

export const apiClient = new APIClient();

// Server messages are in English; map the ones users can act on to French.
const knownErrors: Record<string, string> = {
  'Phone number already exists': 'Ce numéro de téléphone est déjà enregistré.',
  'Email already exists': 'Cette adresse e-mail est déjà utilisée.',
  'Insufficient product stock': 'Stock insuffisant pour un des produits.',
  'Current password is incorrect': 'Le mot de passe actuel est incorrect.',
  'Amount paid must be between zero and the total': 'Le montant reçu doit être compris entre zéro et le total.',
  'Selected catalog item is unavailable': 'Un article sélectionné n’est plus disponible.',
  'Client or active staff member not found': 'Client ou membre du personnel introuvable ou inactif.',
  'You cannot change your own role or status': 'Vous ne pouvez pas modifier votre propre rôle.',
  'Failed to create product; check that the SKU is unique': 'Ce SKU existe déjà.',
  'Failed to update product; check that the SKU is unique': 'Ce SKU existe déjà.',
  'SKU already exists': 'Ce SKU est déjà utilisé par un autre produit.',
  'Product has sales history': 'Ce produit figure dans des ventes : désactivez-le plutôt que de le supprimer.',
  'Invalid value for imageUrl': 'L’adresse de l’image doit commencer par http:// ou https://.',
  'A reason is required for a stock adjustment': 'Indiquez le motif de l’ajustement.',
  'Too many login attempts': 'Trop de tentatives. Réessayez dans 15 minutes.',
  'Public registration is disabled': 'L’inscription est fermée : demandez un accès à l’administrateur.',
  'Role must be staff or cashier': 'Seuls les rôles Équipe et Caisse peuvent être attribués.',
  'Use your own settings to change the administrator password': 'Le mot de passe administrateur se change depuis son propre compte.',
  'Phone number belongs to an archived client': 'Ce numéro appartient à un client archivé : l’administrateur peut restaurer sa fiche.',
  'No unpaid commission is covered by this amount': 'Aucune commission à régler pour ce montant : le solde a peut-être déjà été payé.',
  'Idempotency key already used for another payment': 'Ce paiement a déjà été traité.',
  'This staff member is already linked to another account': 'Cette fiche est déjà reliée à un autre accès.',
  'Staff member not found': 'Membre de l’équipe introuvable.',
  'Active staff member not found': 'Membre de l’équipe introuvable ou inactif.',
  'Active service not found': 'Prestation introuvable ou retirée.',
  'Client not found': 'Client introuvable ou archivé.',
  'Commission rate must be between 0 and 100': 'Le taux de commission doit être compris entre 0 et 100 %.',
};

export const getApiError = (error: unknown, fallback: string) => {
  if (!isAxiosError(error)) return fallback;
  if (!error.response) return 'Serveur injoignable. Vérifiez que l’API est démarrée.';
  if (error.response.status === 403) return 'Action non autorisée pour votre rôle.';
  if (error.response.status === 413) return 'Données trop volumineuses (photo trop lourde ?).';
  if (error.response.status === 429) return knownErrors['Too many login attempts'];
  const message = (error.response.data as { error?: string } | undefined)?.error;
  return (message && knownErrors[message]) || fallback;
};

// "online": API and database answer; "degraded": the API answers but not its database.
export const checkApiStatus = async (): Promise<'online' | 'degraded' | 'offline'> => {
  try {
    await apiClient.get('/health/ready');
    return 'online';
  } catch (error) {
    return isAxiosError(error) && error.response?.status === 503 ? 'degraded' : 'offline';
  }
};
