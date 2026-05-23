/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';

/**
 * User information
 */
export interface User {
  id: string;
  username: string;
}

/**
 * Auth hook return type
 */
export interface UseAuthReturn {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

/**
 * Authentication hook
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('qwen-code-token');
  });
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current user info
  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem('qwen-code-token');

    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUser(data.data.user);
        setToken(storedToken);
      } else {
        // Token invalid or expired
        localStorage.removeItem('qwen-code-token');
        localStorage.removeItem('qwen-code-username');
        localStorage.removeItem('qwen-code-session-id');
        setUser(null);
        setToken(null);
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial auth check
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Login function
  const login = useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username.trim(),
            password,
            remember: true,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          return {
            success: false,
            error: data.error || 'Login failed',
          };
        }

        // Store credentials
        localStorage.setItem('qwen-code-token', data.data.token);
        localStorage.setItem('qwen-code-username', data.data.user.username);
        localStorage.setItem('qwen-code-session-id', data.data.sessionId);

        setUser(data.data.user);
        setToken(data.data.token);

        return { success: true };
      } catch (error) {
        console.error('Login error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Network error',
        };
      }
    },
    [],
  );

  // Logout function
  const logout = useCallback(async () => {
    // Notify server
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    // Clear local storage
    localStorage.removeItem('qwen-code-token');
    localStorage.removeItem('qwen-code-username');
    localStorage.removeItem('qwen-code-session-id');

    setUser(null);
    setToken(null);
  }, [token]);

  return {
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    refreshUser,
  };
}
