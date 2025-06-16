import { useState, useCallback } from 'react';
import {
  getWorkspaceTabFromRoute,
  getRouteFromWorkspaceTab,
} from './components/url-builder';
import type {
  OpenWorkspaceOptions,
  WorkspaceTab,
} from '@mongodb-js/compass-workspaces';

export function useWorkspaceTabRouter() {
  const [currentTab, setCurrentTab] = useState<OpenWorkspaceOptions | null>(
    () => {
      return getWorkspaceTabFromRoute(window.location.pathname);
    }
  );

  const updateCurrentTab = useCallback((tab: WorkspaceTab | null) => {
    const newPath = getRouteFromWorkspaceTab(tab);
    window.history.replaceState(null, '', newPath);
    setCurrentTab(tab as any);
  }, []);
  return [currentTab, updateCurrentTab] as const;
}
