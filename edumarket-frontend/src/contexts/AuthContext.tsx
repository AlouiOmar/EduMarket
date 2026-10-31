import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { mockUsers } from '../mocks/mockData';
import { apiRequest, usesApi } from '../services/apiClient';

interface ApiUser { id: string; name: string; email: string; role: UserRole; verified?: boolean; emailVerified?: boolean; status?: User['status']; createdAt?: string; headline?: string; bio?: string; phone?: string; institutionId?: string }
interface AuthResult { success: boolean; data: { expiresIn: number; user: ApiUser } }

const mapApiUser = (user: ApiUser): User => ({
  id: user.id, name: user.name, email: user.email, role: user.role, verified: user.verified, emailVerified: user.emailVerified, avatar: '', status: user.status || 'active',
  joinedDate: user.createdAt?.slice(0, 10) || '', headline: user.headline, bio: user.bio, phone: user.phone, institutionId: user.institutionId,
});

interface AuthContextType {
  user: User | null;
  role: UserRole;
  isAuthenticated: boolean;
  isReady: boolean;
  login: (role?: UserRole) => void;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<{ previewUrl?: string }>;
  refreshUser: () => Promise<void>;
  logout: () => void;
  switchRole: (role: UserRole) => void;
  updateUserProfile: (updates: Partial<User>) => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (usesApi) return null;
    const savedRole = localStorage.getItem('demo_user_role') as UserRole;
    if (savedRole && mockUsers[savedRole]) {
      return mockUsers[savedRole];
    }
    return mockUsers.student; // default logged in demo as student
  });
  const [isReady, setIsReady] = useState(!usesApi);

  useEffect(() => {
    if (!usesApi) return;
    let active = true;
    apiRequest<{ success: boolean; data: ApiUser }>('/auth/me').then(result => {
      if (active) setCurrentUser(mapApiUser(result.data));
    }).catch(() => {
      if (active) setCurrentUser(null);
    }).finally(() => { if (active) setIsReady(true); });
    return () => { active = false; };
  }, []);

  const role: UserRole = currentUser ? currentUser.role : 'visitor';

  const login = (chosenRole: UserRole = 'student') => {
    if (usesApi) return;
    const target = mockUsers[chosenRole] || mockUsers.student;
    setCurrentUser(target);
    localStorage.setItem('demo_user_role', target.role);
  };

  const signIn = async (email: string, password: string) => {
    const result = await apiRequest<AuthResult>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    const user = mapApiUser(result.data.user);
    setCurrentUser(user);
    return user;
  };

  const signUp = async (name: string, email: string, password: string) => {
    const result = await apiRequest<{ success: boolean; data: ApiUser & { previewUrl?: string } }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ name, email, password }),
    });
    return { previewUrl: result.data.previewUrl };
  };

  const refreshUser = async () => {
    if (!usesApi) return;
    const result = await apiRequest<{ success: boolean; data: ApiUser }>('/auth/me');
    setCurrentUser(mapApiUser(result.data));
  };

  const logout = () => {
    setCurrentUser(null);
    if (usesApi) { void apiRequest<void>('/auth/logout', { method: 'POST' }).catch(() => undefined); }
    else localStorage.removeItem('demo_user_role');
  };

  const switchRole = (newRole: UserRole) => {
    if (usesApi) return;
    if (newRole === 'visitor') {
      setCurrentUser(null);
      localStorage.removeItem('demo_user_role');
      return;
    }
    const target = mockUsers[newRole] || {
      ...mockUsers.student,
      role: newRole,
    };
    setCurrentUser(target);
    localStorage.setItem('demo_user_role', newRole);
  };

  const updateUserProfile = async (updates: Partial<User>) => {
    if (currentUser) {
      if (usesApi) {
        const result = await apiRequest<{ success: boolean; data: ApiUser }>('/auth/me', {
          method: 'PATCH', body: JSON.stringify({ name: updates.name, headline: updates.headline, bio: updates.bio, phone: updates.phone }),
        });
        setCurrentUser(mapApiUser(result.data));
        return;
      }
      setCurrentUser({ ...currentUser, ...updates });
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!usesApi) return;
    await apiRequest('/auth/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  };

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        role,
        isAuthenticated: !!currentUser,
        isReady,
        login,
        signIn,
        signUp,
        refreshUser,
        logout,
        switchRole,
        updateUserProfile,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
