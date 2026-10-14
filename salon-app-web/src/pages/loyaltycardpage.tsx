import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../services/api';

type LoyaltyCard = { id: string; name: string; loyaltyPoints: number };

export const LoyaltyCardPage = () => {
  const { id } = useParams();
  const [card, setCard] = useState<LoyaltyCard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    apiClient.get<LoyaltyCard>(`/clients/loyalty/${id}`)
      .then(({ data }) => setCard(data))
      .catch(() => setError('Cette carte fidélité est introuvable.'));
  }, [id]);

  return <main className="flex min-h-screen items-center justify-center bg-[#f5f4ee] p-5 text-[#18221e]">
    <section className="w-full max-w-md border border-[#d8ddd4] bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase text-orange-800">Stander Beauty · fidélité</p>
      {card ? <><h1 className="mt-5 text-3xl font-semibold">Bonjour {card.name}</h1><p className="mt-2 text-sm text-gray-600">Votre carte fidélité numérique</p><div className="my-8 border-y border-gray-200 py-6"><p className="text-sm text-gray-600">Vos points</p><p className="mt-1 text-5xl font-semibold text-orange-800">{Number(card.loyaltyPoints)}</p></div><p className="text-sm text-gray-600">Présentez cette carte à chaque visite.</p><Link to="/login" className="mt-6 inline-block text-sm text-orange-800 underline">Espace du salon</Link></> : <p role={error ? 'alert' : undefined} className="mt-8 text-sm text-gray-600">{error || 'Chargement de la carte…'}</p>}
    </section>
  </main>;
};
