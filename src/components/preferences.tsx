import React, { useRef } from 'react';
import { createNoopLogger } from '../../compass/packages/compass-logging/src/provider';
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

const editablePreferences: (keyof UserPreferences)[] = [
  'theme',
  'defaultSortOrder',
];

function persistEditablePreferences(preferences: UserPreferences) {
  localStorage.setItem('compass-web:theme', preferences['theme'] ?? 'LIGHT');
  localStorage.setItem(
    'compass-web:defaultSortOrder',
    preferences['defaultSortOrder'] ?? ''
  );
}

function loadUserPreferencesFromStorage(preferences: UserPreferences) {
  const theme = localStorage.getItem('compass-web:theme') ?? '';
  if (['DARK', 'LIGHT', 'OS_THEME'].includes(theme)) {
    // @ts-ignore
    preferences['theme'] = theme;
  }

  const defaultSortOrder =
    localStorage.getItem('compass-web:defaultSortOrder') ?? '';
  if (
    ['{ $natural: -1 }', '{ _id: 1 }', '{ _id: -1 }'].includes(defaultSortOrder)
  ) {
    // @ts-ignore
    preferences['defaultSortOrder'] = defaultSortOrder;
  }
}

class CompassWebPreferencesAccess implements PreferencesAccess {
  private _preferences: Preferences;
  constructor(preferencesOverrides?: Partial<AllPreferences>) {
    this._preferences = new Preferences({
      logger: createNoopLogger(),
      preferencesStorage: new CompassWebPreferencesStorage(
        preferencesOverrides
      ),
    });
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
    loadUserPreferencesFromStorage(this.preferences);
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

    persistEditablePreferences(this.preferences);
    return Promise.resolve();
  }
}

export function useCompassWebPreferences(
  initialPreferences?: Partial<AllPreferences>
): React.MutableRefObject<CompassWebPreferencesAccess> {
  const preferencesAccess = useRef(
    new CompassWebPreferencesAccess(initialPreferences)
  );

  return preferencesAccess;
}
