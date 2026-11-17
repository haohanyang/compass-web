import { useCallback, useState } from 'react';
import type { WorkspaceTab } from '@mongodb-js/workspace-info';
import type { OpenWorkspaceOptions } from '@mongodb-js/compass-workspaces';
import {
  getRouteFromWorkspaceTab,
  getWorkspaceTabFromRoute,
} from '../compass/packages/compass-web/src/url-builder';

export function useWorkspaceTabRouter() {
  const [currentTab, setCurrentTab] = useState<OpenWorkspaceOptions | null>(
    () => {
      return getWorkspaceTabFromRoute(window.location.pathname);
    }
  );

  const updateCurrentTab = useCallback((tab: WorkspaceTab | null) => {
    const newPath = getRouteFromWorkspaceTab(tab);
    window.history.replaceState(null, '', newPath);
    setCurrentTab(tab as OpenWorkspaceOptions | null);
  }, []);

  return [currentTab, updateCurrentTab] as const;
}
