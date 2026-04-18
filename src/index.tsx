import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';

const CompassWeb = React.lazy(() =>
  import('./components/compass-web').then((m) => ({ default: m.CompassWeb }))
);

import {
  resetGlobalCSS,
  css,
  Body,
  openToast,
  SpinLoaderWithLabel,
} from '../compass/packages/compass-components/src';
import { useWorkspaceTabRouter } from '../compass/packages/compass-web/sandbox/sandbox-workspace-tab-router';
import { type AllPreferences } from '../compass/packages/compass-preferences-model/src';
import { compassWebLogger } from './logger';
import { getAPIRoute } from './shared';
import { CompassWebConnectionStorage } from './connection-storage';
import { SandboxConnectionStorageProvider } from '../compass/packages/compass-web/src/connection-storage';

interface ProjectParams {
  preferences: Partial<AllPreferences>;
}

const sandboxContainerStyles = css({
  width: '100%',
  height: '100%',
});

const initialPreferences: Partial<AllPreferences> = {
  enableExportSchema: true,
  enablePerformanceAdvisorBanner: false,
  enableAtlasSearchIndexes: false,
  maximumNumberOfActiveConnections: undefined,
  enableCreatingNewConnections: false,
  enableGlobalWrites: false,
  enableRollingIndexes: false,
  showDisabledConnections: true,
  enableDataModeling: false,
  trackUsageStatistics: false,
  enableImportExport: true,
  enableExplainPlan: true,
  enableAggregationBuilderRunPipeline: true,
  enableAggregationBuilderExtraOptions: true,
  enableShell: false,
  enableConnectInNewWindow: false,
  atlasServiceBackendPreset: 'atlas',
};

resetGlobalCSS();

const WithConnectionStorageProvider: React.FunctionComponent<{
  children: React.ReactElement;
  preferences?: Partial<AllPreferences>;
  projectId: string;
}> = ({ children, preferences, projectId }) => {
  if (preferences?.enableCreatingNewConnections) {
    const connectionStorage = new CompassWebConnectionStorage(projectId);
    return (
      <SandboxConnectionStorageProvider value={connectionStorage}>
        {children}
      </SandboxConnectionStorageProvider>
    );
  }
  return children;
};

const App = () => {
  const [currentTab, updateCurrentTab] = useWorkspaceTabRouter();
  const [projectParams, setProjectParams] =
    React.useState<ProjectParams | null>(null);

  useEffect(() => {
    fetch(getAPIRoute('settings'))
      .then((res) => res.json())
      .then(({ preferences }) => {
        setProjectParams({
          preferences,
        });
      })
      .catch((err) => {
        openToast('failed-to-load-project-parameters', {
          title: 'Failed to load project parameters',
          description: err.message,
          variant: 'warning',
        });
      });
  }, []);

  return (
    <Body as="div" className={sandboxContainerStyles}>
      <React.Suspense
        fallback={
          <SpinLoaderWithLabel
            className="compass-init-loader"
            progressText="Loading Compass"
          />
        }
      >
        {projectParams ? (
          <WithConnectionStorageProvider
            preferences={projectParams.preferences}
            projectId="-"
          >
            <CompassWeb
              projectId="-"
              orgId="-"
              appName="Compass Web"
              onActiveWorkspaceTabChange={updateCurrentTab}
              initialWorkspace={currentTab ?? undefined}
              initialPreferences={{
                ...initialPreferences,
                ...projectParams.preferences,
              }}
              onLog={compassWebLogger.log}
              onDebug={compassWebLogger.debug}
              onFailToLoadConnections={(error: Error) => {
                openToast('failed-to-load-connections', {
                  title: 'Failed to load connections',
                  description: error.message,
                  variant: 'warning',
                });
              }}
            />
          </WithConnectionStorageProvider>
        ) : (
          <SpinLoaderWithLabel
            className="compass-init-loader"
            progressText="Loading Compass"
          />
        )}
      </React.Suspense>
    </Body>
  );
};

ReactDOM.render(<App />, document.querySelector('#sandbox-app')!);
