import type {
  ConnectionStorage,
  ConnectionInfo,
} from '../../compass/packages/connection-storage/src/provider';

export class CompassWebConnectionStorage implements ConnectionStorage {
  private readonly _defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  constructor(private readonly _projectId: string) {
    const csrfElement: HTMLMetaElement | null = document.querySelector(
      'meta[name="csrf-token"]'
    );

    if (csrfElement?.content) {
      this._defaultHeaders['csrf-token'] = csrfElement.content;
    }
  }

  async loadAll(): Promise<ConnectionInfo[]> {
    const resp = await fetch(
      `/explorer/v1/groups/${this._projectId}/clusters/connectionInfo`
    );
    const connectionInfos = (await resp.json()) as ConnectionInfo[];
    return connectionInfos;
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
    const resp = await fetch(
      `/explorer/v1/groups/${this._projectId}/clusters/connectionInfo`,
      {
        method: 'POST',
        headers: this._defaultHeaders,
        body: JSON.stringify(connectionInfo),
      }
    );

    const result = await resp.json();
    console.log('Saved connection result:', result);
  }
  async delete({ id }: { id: string }): Promise<void> {
    const resp = await fetch(
      `/explorer/v1/groups/${this._projectId}/clusters/connectionInfo/${id}`,
      {
        method: 'DELETE',
        headers: this._defaultHeaders,
      }
    );

    const result = await resp.json();
    console.log('Deleted connection result:', result);
  }
}
