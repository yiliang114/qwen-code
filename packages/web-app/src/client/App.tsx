/**
 * @license
 * Copyright 2025 Qwen Code Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChatArea } from './components/ChatArea.js';
import { LoginPage } from './components/LoginPage.js';
import { useSessions } from './hooks/useSessions.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useMessages } from './hooks/useMessages.js';
import { useAuth } from './hooks/useAuth.js';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './components/ui/resizable.js';
import type { Message } from '../shared/types.js';

// App version - dynamically imported from generated file
import { APP_VERSION } from './version.js';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const effectiveTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function App() {
  // Authentication
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    logout,
    refreshUser,
  } = useAuth();

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => {
      const hash = window.location.hash.slice(1);
      return hash || null;
    },
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Theme state
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('qwen-code-theme') as Theme | null;
    return saved || 'system';
  });

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sync session ID to URL hash
  useEffect(() => {
    if (currentSessionId) {
      window.history.replaceState(null, '', `#${currentSessionId}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [currentSessionId]);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('qwen-code-theme', theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Sessions and messages hooks
  const { sessions, createSession, deleteSession, refreshSessions, isLoading } =
    useSessions();
  const { messages, addMessage, setMessages, clearMessages } = useMessages();

  const handleMessage = useCallback(
    (msg: Message) => {
      addMessage(msg);
    },
    [addMessage],
  );

  const handleHistory = useCallback(
    (history: Message[]) => {
      setMessages(history);
    },
    [setMessages],
  );

  const {
    send,
    isConnected,
    isStreaming,
    permissionRequest,
    respondToPermission,
    sessionInfo,
    usage,
  } = useWebSocket(currentSessionId, {
    onMessage: handleMessage,
    onHistory: handleHistory,
  });

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      clearMessages();
      if (isMobile) {
        setShowMobileSidebar(false);
      }
    },
    [clearMessages, isMobile],
  );

  const handleCreateSession = useCallback(async () => {
    const newSession = await createSession();
    if (newSession) {
      setCurrentSessionId(newSession.id);
      clearMessages();
      if (isMobile) {
        setShowMobileSidebar(false);
      }
    }
  }, [createSession, clearMessages, isMobile]);

  const handleSendMessage = useCallback(
    (content: string) => {
      if (!currentSessionId || !content.trim()) return;
      send({ type: 'user_message', content });
    },
    [currentSessionId, send],
  );

  const handleCancel = useCallback(() => {
    send({ type: 'cancel' });
  }, [send]);

  const handlePermissionResponse = useCallback(
    (optionId: string) => {
      respondToPermission(optionId);
    },
    [respondToPermission],
  );

  const handleToggleTheme = useCallback(() => {
    setTheme((current) => {
      if (current === 'light') return 'dark';
      if (current === 'dark') return 'system';
      return 'light';
    });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setShowMobileSidebar((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  }, [isMobile]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const success = await deleteSession(sessionId);
      if (success && currentSessionId === sessionId) {
        setCurrentSessionId(null);
        clearMessages();
      }
    },
    [deleteSession, currentSessionId, clearMessages],
  );

  const handleLoginSuccess = useCallback(() => {
    void refreshUser();
  }, [refreshUser]);

  // Find current session for header display
  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // Get previous/next session for navigation
  const currentIndex = sessions.findIndex((s) => s.id === currentSessionId);
  const hasPrevSession = currentIndex > 0;
  const hasNextSession =
    currentIndex >= 0 && currentIndex < sessions.length - 1;

  const handlePrevSession = useCallback(() => {
    if (hasPrevSession) {
      const prevSession = sessions[currentIndex - 1];
      handleSelectSession(prevSession.id);
    }
  }, [hasPrevSession, sessions, currentIndex, handleSelectSession]);

  const handleNextSession = useCallback(() => {
    if (hasNextSession) {
      const nextSession = sessions[currentIndex + 1];
      handleSelectSession(nextSession.id);
    }
  }, [hasNextSession, sessions, currentIndex, handleSelectSession]);

  // Display version
  const displayVersion = sessionInfo?.version || APP_VERSION;

  // Show login page if not authenticated
  if (!isAuthenticated && !authLoading) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Show loading state
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Mobile header */}
      {isMobile && (
        <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <button
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            className="p-2 hover:bg-muted rounded-md"
            aria-label="Toggle sidebar"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-foreground">Qwen Code</h1>
          <button
            onClick={logout}
            className="p-2 hover:bg-muted rounded-md"
            aria-label="Logout"
          >
            <svg
              className="w-5 h-5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar overlay */}
        {isMobile && showMobileSidebar && (
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowMobileSidebar(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={`
            ${isMobile ? 'fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-200 ease-in-out' : ''}
            ${isMobile && !showMobileSidebar ? '-translate-x-full' : ''}
          `}
        >
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel
              defaultSize={isMobile ? 100 : sidebarCollapsed ? 3 : 20}
              minSize={isMobile ? 100 : sidebarCollapsed ? 3 : 15}
              maxSize={isMobile ? 100 : sidebarCollapsed ? 3 : 30}
              className="border-r border-border bg-background"
            >
              <Sidebar
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onCreateSession={handleCreateSession}
                onDeleteSession={handleDeleteSession}
                onRefresh={refreshSessions}
                isLoading={isLoading}
                collapsed={isMobile ? false : sidebarCollapsed}
                onToggleCollapse={handleToggleSidebar}
                theme={theme}
                onToggleTheme={handleToggleTheme}
                version={displayVersion}
                user={user}
                onLogout={logout}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {!isMobile && <ResizableHandle />}

        {/* Main content */}
        <div className={`flex-1 ${isMobile ? 'ml-0' : ''}`}>
          <ChatArea
            sessionId={currentSessionId}
            sessionTitle={currentSession?.title}
            sessionTime={currentSession?.lastUpdated}
            messages={messages}
            isConnected={isConnected}
            isStreaming={isStreaming}
            permissionRequest={permissionRequest}
            onSendMessage={handleSendMessage}
            onCancel={handleCancel}
            onPermissionResponse={handlePermissionResponse}
            onPrevSession={hasPrevSession ? handlePrevSession : undefined}
            onNextSession={hasNextSession ? handleNextSession : undefined}
            theme={
              theme === 'system'
                ? window.matchMedia('(prefers-color-scheme: dark)').matches
                  ? 'dark'
                  : 'light'
                : theme
            }
            usage={usage}
            currentModel={sessionInfo?.model}
          />
        </div>
      </div>
    </div>
  );
}
