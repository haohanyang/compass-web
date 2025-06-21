import React, { useEffect, useRef, useState } from 'react';
import AppRegistry, {
  AppRegistryProvider,
  GlobalAppRegistryProvider,
} from 'hadron-app-registry';
import type { ConnectionInfo } from '@mongodb-js/compass-connections/provider';
import { useConnectionActions } from '@mongodb-js/compass-connections/provider';
import { CompassInstanceStorePlugin } from '@mongodb-js/compass-app-stores';
import type { OpenWorkspaceOptions } from '@mongodb-js/compass-workspaces';
import WorkspacesPlugin, {
  WorkspacesProvider,
} from '@mongodb-js/compass-workspaces';
import { CompassSettingsPlugin } from '@mongodb-js/compass-settings';
import {
  DatabasesWorkspaceTab,
  CollectionsWorkspaceTab,
} from '@mongodb-js/compass-databases-collections';
import { CompassComponentsProvider, css } from '@mongodb-js/compass-components';
import {
  WorkspaceTab as CollectionWorkspace,
  CollectionTabsProvider,
} from '@mongodb-js/compass-collection';
import {
  CompassSidebarPlugin,
  AtlasClusterConnectionsOnlyProvider,
} from '@mongodb-js/compass-sidebar';
import CompassQueryBarPlugin from '@mongodb-js/compass-query-bar';
import { CompassDocumentsPlugin } from '@mongodb-js/compass-crud';
import {
  CompassAggregationsPlugin,
  CreateViewPlugin,
} from '@mongodb-js/compass-aggregations';
import { CompassSchemaPlugin } from '@mongodb-js/compass-schema';
import { CompassIndexesPlugin } from '@mongodb-js/compass-indexes';
import { CompassSchemaValidationPlugin } from '@mongodb-js/compass-schema-validation';
import { CompassGlobalWritesPlugin } from '@mongodb-js/compass-global-writes';
import { CompassGenerativeAIPlugin } from '@mongodb-js/compass-generative-ai';
import ExplainPlanCollectionTabModal from '@mongodb-js/compass-explain-plan';
import ExportToLanguageCollectionTabModal from '@mongodb-js/compass-export-to-language';
import { ExportPlugin } from '@mongodb-js/compass-import-export';
import {
  CreateNamespacePlugin,
  DropNamespacePlugin,
  RenameCollectionPlugin,
} from '@mongodb-js/compass-databases-collections';
import { PreferencesProvider } from 'compass-preferences-model/provider';
import type { AllPreferences } from 'compass-preferences-model/provider';
import FieldStorePlugin from '@mongodb-js/compass-field-store';
import { AtlasServiceProvider } from '@mongodb-js/atlas-service/provider';
import { AtlasAiServiceProvider } from '@mongodb-js/compass-generative-ai/provider';
import { LoggerProvider } from '@mongodb-js/compass-logging/provider';
import { TelemetryProvider } from '@mongodb-js/compass-telemetry/provider';
import CompassConnections from '@mongodb-js/compass-connections';
import { AtlasCloudConnectionStorageProvider } from '../../compass/packages/compass-web/src/connection-storage';
import { AtlasCloudAuthServiceProvider } from '../../compass/packages/compass-web/src/atlas-auth-service';
import type {
  TrackFunction,
  LogFunction,
  DebugFunction,
} from '../../compass/packages/compass-web/src/logger-and-telemetry';
import { useCompassWebLoggerAndTelemetry } from '../../compass/packages/compass-web/src/logger-and-telemetry';
import { type TelemetryServiceOptions } from '@mongodb-js/compass-telemetry';
import { WebWorkspaceTab as WelcomeWorkspaceTab } from '@mongodb-js/compass-welcome';
import { useCompassWebPreferences } from './preferences';
import { WorkspaceTab as DataModelingWorkspace } from '@mongodb-js/compass-data-modeling';
import { DataModelStorageServiceProviderInMemory } from '@mongodb-js/compass-data-modeling/web';

const WithAtlasProviders: React.FC = ({ children }) => {
  return (
    <AtlasCloudAuthServiceProvider>
      <AtlasClusterConnectionsOnlyProvider value={true}>
        <AtlasServiceProvider>
          <AtlasAiServiceProvider apiURLPreset="cloud">
            {children}
          </AtlasAiServiceProvider>
        </AtlasServiceProvider>
      </AtlasClusterConnectionsOnlyProvider>
    </AtlasCloudAuthServiceProvider>
  );
};

type CompassWorkspaceProps = Pick<
  React.ComponentProps<typeof WorkspacesPlugin>,
  'initialWorkspaceTabs' | 'onActiveWorkspaceTabChange'
> &
  Pick<
    React.ComponentProps<typeof CompassSidebarPlugin>,
    'onOpenConnectViaModal'
  >;

type CompassWebProps = {
  appName?: string;
  orgId: string;
  projectId: string;
  initialAutoconnectId?: string;
  initialWorkspace?: OpenWorkspaceOptions;
  onActiveWorkspaceTabChange: React.ComponentProps<
    typeof WorkspacesPlugin
  >['onActiveWorkspaceTabChange'];
  initialPreferences?: Partial<AllPreferences>;
  onLog?: LogFunction;
  onDebug?: DebugFunction;
  onTrack?: TrackFunction;
  onOpenConnectViaModal?: (
    atlasMetadata: ConnectionInfo['atlasMetadata']
  ) => void;
  onFailToLoadConnections: (err: Error) => void;
};

function CompassWorkspace({
  initialWorkspaceTabs,
  onActiveWorkspaceTabChange,
  onOpenConnectViaModal,
}: CompassWorkspaceProps) {
  return (
    <WorkspacesProvider
      value={[
        WelcomeWorkspaceTab,
        DatabasesWorkspaceTab,
        CollectionsWorkspaceTab,
        CollectionWorkspace,
        DataModelingWorkspace,
      ]}
    >
      <CollectionTabsProvider
        queryBar={CompassQueryBarPlugin}
        tabs={[
          CompassDocumentsPlugin,
          CompassAggregationsPlugin,
          CompassSchemaPlugin,
          CompassIndexesPlugin,
          CompassSchemaValidationPlugin,
          CompassGlobalWritesPlugin,
        ]}
        modals={[
          ExplainPlanCollectionTabModal,
          ExportToLanguageCollectionTabModal,
        ]}
      >
        <div
          data-testid="compass-web-connected"
          className={connectedContainerStyles}
        >
          <WorkspacesPlugin
            initialWorkspaceTabs={initialWorkspaceTabs}
            openOnEmptyWorkspace={{ type: 'Welcome' }}
            onActiveWorkspaceTabChange={onActiveWorkspaceTabChange}
            renderSidebar={() => {
              return (
                <CompassSidebarPlugin
                  onOpenConnectViaModal={onOpenConnectViaModal}
                  isCompassWeb={false}
                ></CompassSidebarPlugin>
              );
            }}
            renderModals={() => {
              return (
                <>
                  <CreateViewPlugin></CreateViewPlugin>
                  <CreateNamespacePlugin></CreateNamespacePlugin>
                  <DropNamespacePlugin></DropNamespacePlugin>
                  <RenameCollectionPlugin></RenameCollectionPlugin>
                  <ExportPlugin></ExportPlugin>
                </>
              );
            }}
          ></WorkspacesPlugin>
        </div>
      </CollectionTabsProvider>
    </WorkspacesProvider>
  );
}

const WithConnectionsStore: React.FunctionComponent<{
  children: React.ReactElement;
}> = ({ children }) => {
  const actions = useConnectionActions();
  useEffect(() => {
    const intervalId = setInterval(() => {
      void actions.refreshConnections();
    }, /* Matches default polling intervals in mms codebase */ 60_000);
    return () => {
      clearInterval(intervalId);
    };
  }, [actions]);
  return <>{children}</>;
};

const LINK_PROPS = {
  utmSource: 'DE',
  utmMedium: 'product',
} as const;

const connectedContainerStyles = css({
  width: '100%',
  height: '100%',
  display: 'flex',
});

const CompassWeb = ({
  appName,
  orgId,
  projectId,
  initialAutoconnectId,
  initialWorkspace,
  onActiveWorkspaceTabChange,
  initialPreferences,
  onLog,
  onDebug,
  onTrack,
  onOpenConnectViaModal,
  onFailToLoadConnections,
}: CompassWebProps) => {
  const appRegistry = useRef(new AppRegistry());
  const logger = useCompassWebLoggerAndTelemetry({
    onLog,
    onDebug,
  });
  const preferencesAccess = useCompassWebPreferences(initialPreferences);
  const initialWorkspaceRef = useRef(initialWorkspace);
  const initialWorkspaceTabsRef = useRef(
    initialWorkspaceRef.current ? [initialWorkspaceRef.current] : []
  );

  const autoconnectId =
    initialWorkspaceRef.current && 'connectionId' in initialWorkspaceRef.current
      ? initialWorkspaceRef.current.connectionId
      : initialAutoconnectId ?? undefined;

  const onTrackRef = useRef(onTrack);

  const telemetryOptions = useRef<TelemetryServiceOptions>({
    sendTrack: (event: string, properties: Record<string, any> | undefined) => {
      onTrackRef.current && void onTrackRef.current(event, properties || {});
    },
    logger,
    preferences: preferencesAccess.current,
  });

  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    preferencesAccess.current
      .getConfigurableUserPreferences()
      .then((preferences) => {
        const theme = preferences['theme'];
        if (theme == 'DARK') {
          setDarkMode(true);
        } else if (theme == 'LIGHT') {
          setDarkMode(false);
        }
      });
  }, [preferencesAccess]);

  preferencesAccess.current.onPreferenceValueChanged('theme', (theme) => {
    if (theme == 'DARK') {
      setDarkMode(true);
    } else if (theme == 'LIGHT') {
      setDarkMode(false);
    }
  });

  return (
    <GlobalAppRegistryProvider value={appRegistry.current}>
      <AppRegistryProvider scopeName="Compass Web Root">
        <CompassComponentsProvider
          darkMode={darkMode}
          stackedElementsZIndex={10_000}
          onNextGuideGue={(cue) => {
            onTrackRef.current?.('Guide Cue Dismissed', {
              groupId: cue.groupId,
              cueId: cue.cueId,
              step: cue.step,
            });
          }}
          onNextGuideCueGroup={(cue) => {
            if (cue.groupSteps !== cue.step) {
              onTrackRef.current?.('Guide Cue Group Dismissed', {
                groupId: cue.groupId,
                cueId: cue.cueId,
                step: cue.step,
              });
            }
          }}
          onSignalMount={(id) => {
            onTrackRef.current?.('Signal Shown', { id });
          }}
          onSignalOpen={(id) => {
            onTrackRef.current?.('Signal Opened', { id });
          }}
          onSignalPrimaryActionClick={(id) => {
            onTrackRef.current?.('Signal Action Button Clicked', { id });
          }}
          onSignalLinkClick={(id) => {
            onTrackRef.current?.('Signal Link Clicked', { id });
          }}
          onSignalClose={(id) => {
            onTrackRef.current?.('Signal Closed', { id });
          }}
          {...LINK_PROPS}
        >
          <PreferencesProvider value={preferencesAccess.current}>
            <LoggerProvider value={logger}>
              <TelemetryProvider options={telemetryOptions.current}>
                <WithAtlasProviders>
                  <DataModelStorageServiceProviderInMemory>
                    <AtlasCloudConnectionStorageProvider
                      orgId={orgId}
                      projectId={projectId}
                    >
                      <CompassConnections
                        appName={appName ?? 'Compass Web'}
                        onFailToLoadConnections={onFailToLoadConnections}
                        onExtraConnectionDataRequest={() => {
                          return Promise.resolve([{}, null] as [
                            Record<string, unknown>,
                            null
                          ]);
                        }}
                        onAutoconnectInfoRequest={(connectionStore) => {
                          if (autoconnectId) {
                            return connectionStore.loadAll().then(
                              (connections) => {
                                return connections.find(
                                  (connectionInfo) =>
                                    connectionInfo.id === autoconnectId
                                );
                              },
                              (err) => {
                                const { log, mongoLogId } = logger;
                                log.warn(
                                  mongoLogId(1_001_000_329),
                                  'Compass Web',
                                  'Could not load connections when trying to autoconnect',
                                  { err: err.message }
                                );
                                return undefined;
                              }
                            );
                          }
                          return Promise.resolve(undefined);
                        }}
                      >
                        <CompassInstanceStorePlugin>
                          <FieldStorePlugin>
                            <WithConnectionsStore>
                              <CompassWorkspace
                                initialWorkspaceTabs={
                                  initialWorkspaceTabsRef.current
                                }
                                onActiveWorkspaceTabChange={
                                  onActiveWorkspaceTabChange
                                }
                                onOpenConnectViaModal={onOpenConnectViaModal}
                              ></CompassWorkspace>
                            </WithConnectionsStore>
                            <CompassSettingsPlugin></CompassSettingsPlugin>
                          </FieldStorePlugin>
                          <CompassGenerativeAIPlugin projectId={projectId} />
                        </CompassInstanceStorePlugin>
                      </CompassConnections>
                    </AtlasCloudConnectionStorageProvider>
                  </DataModelStorageServiceProviderInMemory>
                </WithAtlasProviders>
              </TelemetryProvider>
            </LoggerProvider>
          </PreferencesProvider>
        </CompassComponentsProvider>
      </AppRegistryProvider>
    </GlobalAppRegistryProvider>
  );
};

export { CompassWeb };
