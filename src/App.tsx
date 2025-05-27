import React from "react";
import {
  AppRegistryProvider,
  GlobalAppRegistryProvider,
} from "hadron-app-registry";
import {
  Description,
  CompassComponentsProvider,
} from "@mongodb-js/compass-components";
import { PreferencesProvider } from "compass-preferences-model/provider";
import { CompassWebPreferencesAccess } from "compass-preferences-model/provider";
import { DataModelStorageServiceProviderInMemory } from "@mongodb-js/compass-data-modeling/web";
import { AtlasCloudConnectionStorageProvider } from "./ConnectionStorage";
import CompassConnections from "@mongodb-js/compass-connections";

export default function App() {
  const preferencesAccess = new CompassWebPreferencesAccess({
    enableExplainPlan: true,
    enableAggregationBuilderRunPipeline: true,
    enableAggregationBuilderExtraOptions: true,
    enableAtlasSearchIndexes: false,
    enableImportExport: false,
    enableGenAIFeatures: true,
    enableGenAIFeaturesAtlasProject: false,
    enableGenAISampleDocumentPassingOnAtlasProject: false,
    enableGenAIFeaturesAtlasOrg: false,
    enablePerformanceAdvisorBanner: true,
    cloudFeatureRolloutAccess: {
      GEN_AI_COMPASS: false,
    },
    maximumNumberOfActiveConnections: 10,
    trackUsageStatistics: true,
    enableShell: false,
    enableCreatingNewConnections: false,
    enableGlobalWrites: false,
    optInDataExplorerGenAIFeatures: false,
    enableConnectInNewWindow: false,
  });

  return (
    <GlobalAppRegistryProvider>
      <AppRegistryProvider>
        <CompassComponentsProvider>
          <PreferencesProvider value={preferencesAccess}>
            <DataModelStorageServiceProviderInMemory>
              <AtlasCloudConnectionStorageProvider orgId="" projectId="">
                <CompassConnections
                  appName="Compass Web"
                  onFailToLoadConnections={() => {}}
                  onExtraConnectionDataRequest={() => {
                    return Promise.resolve([{}, null] as [
                      Record<string, unknown>,
                      null
                    ]);
                  }}
                >
                  <Description>Hi there</Description>
                </CompassConnections>
              </AtlasCloudConnectionStorageProvider>
            </DataModelStorageServiceProviderInMemory>
          </PreferencesProvider>
        </CompassComponentsProvider>
      </AppRegistryProvider>
    </GlobalAppRegistryProvider>
  );
}
