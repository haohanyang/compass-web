import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { CompassWeb } from './components/compass-web';
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

interface ProjectParams {
  projectId: string;
  orgId: string;
  appName: string;
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
};

resetGlobalCSS();

const App = () => {
  const [currentTab, updateCurrentTab] = useWorkspaceTabRouter();
  const [projectParams, setProjectParams] =
    React.useState<ProjectParams | null>(null);

  useEffect(() => {
    void fetch('/projectId')
      .then(async (res) => {
        const projectId = await res.text();

        if (!projectId) {
          throw new Error('failed to get projectId');
        }
        const { orgId, appName, preferences } = await fetch(
          `/cloud-mongodb-com/v2/${projectId}/params`
        ).then((res) => {
          return res.json();
        });
        setProjectParams({
          projectId,
          orgId,
          appName,
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
      {projectParams ? (
        <CompassWeb
          projectId={projectParams.projectId}
          orgId={projectParams.orgId}
          appName={projectParams.appName}
          onActiveWorkspaceTabChange={updateCurrentTab}
          initialWorkspace={currentTab ?? undefined}
          initialPreferences={{
            ...initialPreferences,
            ...projectParams.preferences,
          }}
          onLog={compassWebLogger.log}
          onDebug={compassWebLogger.debug}
          onFailToLoadConnections={(error) => {
            openToast('failed-to-load-connections', {
              title: 'Failed to load connections',
              description: error.message,
              variant: 'warning',
            });
          }}
        ></CompassWeb>
      ) : (
        <SpinLoaderWithLabel
          className="compass-init-loader"
          progressText="Loading Compass"
        />
      )}
    </Body>
  );
};

ReactDOM.render(<App />, document.querySelector('#sandbox-app')!);
