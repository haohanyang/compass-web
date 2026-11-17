import React from 'react';
import { registerCompassPlugin } from '../../compass/packages/compass-app-registry/src';
import { activatePlugin } from '../../compass/packages/compass-import-export/src/stores/export-store';
import { preferencesLocator } from '../../compass/packages/compass-preferences-model/src/provider';
import { createLoggerLocator } from '../../compass/packages/compass-logging/src/provider';
import { telemetryLocator } from '../../compass/packages/compass-telemetry/src/provider';
import { connectionsLocator } from '../../compass/packages/compass-connections/src/provider';
import { ExportModal } from './export-modal';
import ExportInProgressModal from '../../compass/packages/compass-import-export/src/components/export-in-progress-modal';

function ExportComponent() {
  return (
    <>
      <ExportModal />
      <ExportInProgressModal />
    </>
  );
}

// @ts-ignore
export const ExportPlugin = registerCompassPlugin(
  {
    name: 'Export',
    component: ExportComponent,
    activate: activatePlugin,
  },
  {
    connections: connectionsLocator,
    preferences: preferencesLocator,
    logger: createLoggerLocator('COMPASS-EXPORT-UI'),
    track: telemetryLocator,
  }
);
