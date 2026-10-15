import { useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import { can, type Permission } from '../utils/permissions';

export const useCurrentUser = () => useSelector((state: RootState) => state.auth.user);

export const useIsAdmin = () => useCurrentUser()?.role === 'admin';

export const useCan = (permission: Permission) => can(useCurrentUser(), permission);
