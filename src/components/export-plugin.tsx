import React from 'react';
import { registerHadronPlugin } from 'hadron-app-registry';
import { activatePlugin as activateExportPlugin } from '../../compass/packages/compass-import-export/src/stores/export-store';
import { preferencesLocator } from 'compass-preferences-model/provider';
import { createLoggerLocator } from '@mongodb-js/compass-logging/provider';
import { telemetryLocator } from '@mongodb-js/compass-telemetry/provider';
import { connectionsLocator } from '@mongodb-js/compass-connections/provider';
import { ExportModal } from '../../compass/packages/compass-import-export/src/components/export-modal';
import ExportInProgressModal from '../../compass/packages/compass-import-export/src/components/export-in-progress-modal';

function ExportPluginComponent() {
  return (
    <>
      <ExportModal />
      <ExportInProgressModal />
    </>
  );
}

export const ExportPlugin = registerHadronPlugin(
  {
    name: 'Export',
    component: ExportPluginComponent,
    activate: activateExportPlugin,
  },
  {
    connections: connectionsLocator,
    preferences: preferencesLocator,
    logger: createLoggerLocator('COMPASS-EXPORT-UI'),
    track: telemetryLocator,
  }
);
