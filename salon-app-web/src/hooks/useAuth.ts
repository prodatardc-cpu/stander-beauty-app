import { useSelector } from 'react-redux';
import type { RootState } from '../redux/store';

export const useCurrentUser = () => useSelector((state: RootState) => state.auth.user);

export const useIsAdmin = () => useCurrentUser()?.role === 'admin';
