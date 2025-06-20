import React, { useRef } from 'react';
import { createNoopLogger } from '@mongodb-js/compass-logging/provider';
import {
  Preferences,
  type PreferencesAccess,
} from '../../compass/packages/compass-preferences-model/src/preferences';
import {
  type UserPreferences,
  type UserConfigurablePreferences,
  type PreferenceStateInformation,
  getDefaultsForStoredPreferences,
} from '../../compass/packages/compass-preferences-model/src/preferences-schema';
import { type PreferencesStorage } from '../../compass/packages/compass-preferences-model/src/preferences-storage';
import {
  type AllPreferences,
  type StoredPreferences,
} from '../../compass/packages/compass-preferences-model/src/preferences-schema';
import { getActiveUser } from '../../compass/packages/compass-preferences-model/src/utils';

const editablePreferences: (keyof UserPreferences)[] = ['theme'];

class CompassWebPreferencesAccess implements PreferencesAccess {
  private _preferences: Preferences;
  constructor(preferencesOverrides?: Partial<AllPreferences>) {
    this._preferences = new Preferences({
      logger: createNoopLogger(),
      preferencesStorage: new CompassWebPreferencesStorage(
        preferencesOverrides
      ),
    });

    this._preferences.setupStorage();
  }

  savePreferences(
    attributes: Partial<UserPreferences>
  ): Promise<AllPreferences> {
    if (
      Object.keys(attributes).length >= 1 &&
      Object.keys(attributes).every((attribute) =>
        editablePreferences.includes(attribute as keyof UserPreferences)
      )
    ) {
      return Promise.resolve(this._preferences.savePreferences(attributes));
    }
    return Promise.resolve(this._preferences.getPreferences());
  }

  refreshPreferences(): Promise<AllPreferences> {
    return Promise.resolve(this._preferences.getPreferences());
  }

  getPreferences(): AllPreferences {
    return this._preferences.getPreferences();
  }

  ensureDefaultConfigurableUserPreferences(): Promise<void> {
    return this._preferences.ensureDefaultConfigurableUserPreferences();
  }

  getConfigurableUserPreferences(): Promise<UserConfigurablePreferences> {
    return Promise.resolve(this._preferences.getConfigurableUserPreferences());
  }

  getPreferenceStates(): Promise<PreferenceStateInformation> {
    return Promise.resolve(this._preferences.getPreferenceStates());
  }

  onPreferenceValueChanged<K extends keyof AllPreferences>(
    preferenceName: K,
    callback: (value: AllPreferences[K]) => void
  ): () => void {
    return this._preferences.onPreferencesChanged(
      (preferences: Partial<AllPreferences>) => {
        if (Object.keys(preferences).includes(preferenceName)) {
          return callback((preferences as AllPreferences)[preferenceName]);
        }
      }
    );
  }

  createSandbox(): Promise<PreferencesAccess> {
    return Promise.resolve(
      new CompassWebPreferencesAccess(this.getPreferences())
    );
  }
  getPreferencesUser(): ReturnType<typeof getActiveUser> {
    return getActiveUser(this);
  }
}

class CompassWebPreferencesStorage implements PreferencesStorage {
  private preferences = getDefaultsForStoredPreferences();

  constructor(preferencesOverrides?: Partial<AllPreferences>) {
    this.preferences = {
      ...this.preferences,
      ...preferencesOverrides,
    };
  }

  setup(): Promise<void> {
    const theme = localStorage.getItem('compass-web:theme') ?? '';
    if (['DARK', 'LIGHT', 'OS_THEME'].includes(theme)) {
      // @ts-ignore
      this.preferences['theme'] = theme;
    }
    return Promise.resolve();
  }
  getPreferences(): StoredPreferences {
    return this.preferences;
  }

  updatePreferences(attributes: Partial<StoredPreferences>): Promise<void> {
    this.preferences = {
      ...this.preferences,
      ...attributes,
    };

    localStorage.setItem('compass-web:theme', this.preferences['theme']);

    return Promise.resolve();
  }
}

export function useCompassWebPreferences(
  initialPreferences?: Partial<AllPreferences>
): React.MutableRefObject<CompassWebPreferencesAccess> {
  const preferencesAccess = useRef(
    new CompassWebPreferencesAccess({
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
      ...initialPreferences,
    })
  );

  return preferencesAccess;
}
