import type {
  ConnectionStorage,
  ConnectionInfo,
} from '../compass/packages/connection-storage/src/provider';
import { getMetaData, getAPIRoute } from './shared';
import { openToast } from '../compass/packages/compass-components/src';

const baseRoute = getMetaData('base-route') || '';

export class CompassWebConnectionStorage implements ConnectionStorage {
  private readonly _defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  constructor(private readonly _projectId: string) {
    const csrfToken = getMetaData('csrf-token');

    if (csrfToken) {
      this._defaultHeaders['csrf-token'] = csrfToken;
    }
  }

  async loadAll(): Promise<ConnectionInfo[]> {
    try {
      const resp = await fetch(getAPIRoute('connection-info'));

      if (!resp.ok) {
        const error = (await resp.json()).error || 'Unknown error';
        throw new Error(error);
      }

      const connectionInfos = (await resp.json()) as ConnectionInfo[];
      return connectionInfos.map((conn) => ({
        ...conn,
        connectionOptions: {
          ...conn.connectionOptions,
          lookup: () => ({
            wsURL: baseRoute ? `/${baseRoute}/ws` : '/ws',
          }),
        },
      }));
    } catch (err) {
      openToast('failed-load-connection-info', {
        title: 'Failed to load project parameters',
        description: (err as Error).message,
        variant: 'warning',
      });
      return [];
    }
  }

  async load({ id }: { id: string }): Promise<ConnectionInfo | undefined> {
    const allConnections = await this.loadAll();
    return allConnections.find((conn) => conn.id === id);
  }

  async save({
    connectionInfo,
  }: {
    connectionInfo: ConnectionInfo;
  }): Promise<void> {
    try {
      const resp = await fetch(getAPIRoute('connection-info'), {
        method: 'POST',
        headers: this._defaultHeaders,
        body: JSON.stringify(connectionInfo),
      });

      if (!resp.ok) {
        const error = (await resp.json()).error || 'Unknown error';
        throw new Error(error);
      }
    } catch (err) {
      openToast('failed-save-connection-info', {
        title: 'Failed to save the connection',
        description: (err as Error).message,
        variant: 'warning',
      });
    }
  }

  async delete({ id }: { id: string }): Promise<void> {
    try {
      const resp = await fetch(getAPIRoute(`connection-info/${id}`), {
        method: 'DELETE',
      });

      if (!resp.ok) {
        const error = (await resp.json()).error || 'Unknown error';
        throw new Error(error);
      }
    } catch (err) {
      openToast('failed-delete-connection-info', {
        title: 'Failed to delete the connection',
        description: (err as Error).message,
        variant: 'warning',
      });
    }
  }
}
