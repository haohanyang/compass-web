import _ from 'lodash';
import {
  ExportActionTypes,
  cancelExport,
  FieldsToExport,
  getIdForSchemaPath,
} from '../compass/packages/compass-import-export/src/modules/export';
import { createProjectionFromSchemaFields } from '../compass/packages/compass-import-export/src/export/gather-fields';
import type { ExportResult } from '../compass/packages/compass-import-export/src/export/export-types';
import { queryHasProjection } from '../compass/packages/compass-import-export/src/utils/query-has-projection';
import type { CSVExportPhase } from '../compass/packages/compass-import-export/src/export/export-csv';
import {
  showCancelledToast,
  showFailedToast,
  showInProgressToast,
} from '../compass/packages/compass-import-export/src/components/export-toast';
import type { ExportJSONFormat } from '../compass/packages/compass-import-export/src/export/export-json';
import type { ExportThunkAction } from '../compass/packages/compass-import-export/src/stores/export-store';

type SelectFieldsToExportAction = {
  type: ExportActionTypes.SelectFieldsToExport;
};

type FetchFieldsToExportAction = {
  type: ExportActionTypes.FetchFieldsToExport;
  fieldsToExportAbortController: AbortController;
};

type FetchFieldsToExportErrorAction = {
  type: ExportActionTypes.FetchFieldsToExportError;
  errorMessage?: string;
};

type FetchFieldsToExportSuccessAction = {
  type: ExportActionTypes.FetchFieldsToExportSuccess;
  fieldsToExport: FieldsToExport;
  aborted?: boolean;
};

export const runExport = ({
  fileType,
  jsonFormatVariant,
}: {
  fileType: 'csv' | 'json';
  jsonFormatVariant: ExportJSONFormat;
}): ExportThunkAction<Promise<void>> => {
  return async (
    dispatch,
    getState,
    { connections, preferences, track, logger: { log, mongoLogId } }
  ) => {
    const startTime = Date.now();
    const userPreferences = await preferences.getConfigurableUserPreferences();

    const {
      export: {
        connectionId,
        query: _query,
        namespace,
        fieldsToExport,
        aggregation,
        exportFullCollection,
        selectedFieldOption,
        fieldsAddedCount,
      },
    } = getState();

    let fieldsIncludedCount = 0;
    let fieldsExcludedCount = 0;

    const query =
      exportFullCollection || aggregation
        ? {
            filter: {},
          }
        : selectedFieldOption === 'select-fields'
        ? {
            ...(_query ?? {
              filter: {},
            }),
            projection: createProjectionFromSchemaFields(
              Object.values(fieldsToExport)
                .filter((field) => {
                  field.selected
                    ? fieldsIncludedCount++
                    : fieldsExcludedCount++;

                  return field.selected;
                })
                .map((field) => field.path)
            ),
          }
        : _query;

    log.info(mongoLogId(1_001_000_185), 'Export', 'Start export', {
      namespace,
      fileType,
      exportFullCollection,
      jsonFormatVariant,
      fieldsToExport,
      aggregation,
      query,
      selectedFieldOption,
    });

    const exportAbortController = new AbortController();

    dispatch({
      type: ExportActionTypes.RunExport,
      exportAbortController,
    });

    // showStartingToast({
    //   cancelExport: () => dispatch(cancelExport()),
    //   namespace,
    // });

    let exportSucceeded = false;

    const progressCallback = _.throttle(function (
      index: number,
      csvPhase?: CSVExportPhase
    ) {
      showInProgressToast({
        cancelExport: () => dispatch(cancelExport()),
        docsWritten: index,
        filePath: '',
        namespace,
        csvPhase,
      });
    },
    1000);

    let exportResult: ExportResult | undefined;
    try {
      if (!connectionId) {
        throw new Error('ConnectionId not provided');
      }

      const baseExportOptions = {
        connectionId,
        ns: namespace,
        preferences: userPreferences,
      };

      let response;
      if (aggregation) {
        if (fileType === 'csv') {
          response = await fetch('/export-csv', {
            method: 'POST',
            body: JSON.stringify({ ...baseExportOptions, aggregation }),
            headers: {
              'Content-Type': 'application/json',
              // @ts-ignore
              'csrf-token':
                document.querySelector('meta[name="csrf-token"]')?.content ??
                '',
            },
          });
        } else {
          response = await fetch('/export-json', {
            method: 'POST',
            body: JSON.stringify({
              ...baseExportOptions,
              aggregation,
              jsonFormatVariant,
            }),
            headers: {
              'Content-Type': 'application/json',
              // @ts-ignore
              'csrf-token':
                document.querySelector('meta[name="csrf-token"]')?.content ??
                '',
            },
          });
        }
      } else {
        if (fileType === 'csv') {
          response = await fetch('/export-csv', {
            method: 'POST',
            body: JSON.stringify({ ...baseExportOptions, query }),
            headers: {
              'Content-Type': 'application/json',
              // @ts-ignore
              'csrf-token':
                document.querySelector('meta[name="csrf-token"]')?.content ??
                '',
            },
          });
        } else {
          response = await fetch('/export-json', {
            method: 'POST',
            body: JSON.stringify({
              ...baseExportOptions,
              query,
              jsonFormatVariant,
            }),
            headers: {
              'Content-Type': 'application/json',
              // @ts-ignore
              'csrf-token':
                document.querySelector('meta[name="csrf-token"]')?.content ??
                '',
            },
          });
        }
      }

      const exportId = await response.text();

      window.open(`/export/${exportId}`, '_blank');

      // log.info(mongoLogId(1_001_000_186), 'Export', 'Finished export', {
      //     namespace,
      //     docsWritten: exportResult.docsWritten,
      //     filePath,
      // });

      exportSucceeded = true;
      progressCallback.flush();
    } catch (err: any) {
      log.error(mongoLogId(1_001_000_187), 'Export', 'Export failed', {
        namespace,
        error: (err as Error)?.message,
      });
      dispatch({
        type: ExportActionTypes.RunExportError,
        error: err,
      });
      showFailedToast(err);
    }

    const aborted = !!(
      exportAbortController.signal.aborted || exportResult?.aborted
    );
    track(
      'Export Completed',
      {
        type: aggregation ? 'aggregation' : 'query',
        all_docs: exportFullCollection,
        has_projection:
          exportFullCollection || aggregation || !_query
            ? undefined
            : queryHasProjection(_query),
        field_option:
          exportFullCollection ||
          aggregation ||
          (_query && queryHasProjection(_query))
            ? undefined
            : selectedFieldOption,
        file_type: fileType,
        json_format: fileType === 'json' ? jsonFormatVariant : undefined,
        field_count:
          selectedFieldOption === 'select-fields'
            ? fieldsIncludedCount
            : undefined,
        fields_added_count:
          selectedFieldOption === 'select-fields'
            ? fieldsAddedCount
            : undefined,
        fields_not_selected_count:
          selectedFieldOption === 'select-fields'
            ? fieldsExcludedCount
            : undefined,
        number_of_docs: exportResult?.docsWritten,
        success: exportSucceeded,
        stopped: aborted,
        duration: Date.now() - startTime,
      },
      connections.getConnectionById(connectionId)?.info
    );

    if (!exportSucceeded) {
      return;
    }

    if (exportResult?.aborted) {
      showCancelledToast({
        docsWritten: exportResult?.docsWritten ?? 0,
        filePath: '',
      });
    } else {
      // showCompletedToast({
      //   docsWritten: exportResult?.docsWritten ?? 0,
      //   filePath: '',
      // });
    }

    dispatch({
      type: ExportActionTypes.RunExportSuccess,
      aborted,
    });
  };
};

export const selectFieldsToExport = (): ExportThunkAction<
  Promise<void>,
  | SelectFieldsToExportAction
  | FetchFieldsToExportAction
  | FetchFieldsToExportErrorAction
  | FetchFieldsToExportSuccessAction
> => {
  return async (dispatch, getState, { logger: { log, mongoLogId } }) => {
    dispatch({
      type: ExportActionTypes.SelectFieldsToExport,
    });

    const fieldsToExportAbortController = new AbortController();

    dispatch({
      type: ExportActionTypes.FetchFieldsToExport,
      fieldsToExportAbortController,
    });

    const {
      export: { query, namespace, connectionId },
    } = getState();

    let gatherFieldsResult;

    try {
      if (!connectionId) {
        throw new Error('ConnectionId not provided');
      }

      const res = await fetch('/gather-fields', {
        method: 'POST',
        body: JSON.stringify({
          connectionId: connectionId,
          ns: namespace,
          query,
          sampleSize: 50,
        }),
        headers: {
          'Content-Type': 'application/json',
          // @ts-ignore
          'csrf-token':
            document.querySelector('meta[name="csrf-token"]')?.content ?? '',
        },
      });

      gatherFieldsResult = await res.json();
    } catch (err: any) {
      log.error(
        mongoLogId(1_001_000_184),
        'Export',
        'Failed to gather fields for selecting for export',
        err
      );
      dispatch({
        type: ExportActionTypes.FetchFieldsToExportError,
        errorMessage: err?.message,
      });
      return;
    }

    const fields: FieldsToExport = {};
    for (const schemaPath of gatherFieldsResult.paths) {
      fields[getIdForSchemaPath(schemaPath)] = {
        path: schemaPath,
        // We start all of the fields as unchecked.
        selected: false,
      };
    }

    dispatch({
      type: ExportActionTypes.FetchFieldsToExportSuccess,
      fieldsToExport: fields,
      aborted:
        fieldsToExportAbortController.signal.aborted ||
        gatherFieldsResult.aborted,
    });
  };
};
