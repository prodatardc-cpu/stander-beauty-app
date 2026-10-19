import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// A page's search field, filled from ?q= when opened from the sidebar search (also when already on the page).
export const useSearchTerm = () => {
  const [searchParams] = useSearchParams();
  const [term, setTerm] = useState(searchParams.get('q') ?? '');
  const [appliedParams, setAppliedParams] = useState(searchParams);
  if (appliedParams !== searchParams) {
    setAppliedParams(searchParams);
    const fromUrl = searchParams.get('q');
    if (fromUrl !== null) setTerm(fromUrl);
  }
  return [term, setTerm] as const;
};
