import React, { useCallback, useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import {
  Button,
  ErrorSummary,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  css,
  cx,
  spacing,
  FormFieldContainer,
  Body,
  Link,
  palette,
  useDarkMode,
} from '@mongodb-js/compass-components';

import {
  FINISHED_STATUSES,
  STARTED,
} from '../../compass/packages/compass-import-export/src/constants/process-status';
import type { ProcessStatus } from '../../compass/packages/compass-import-export/src/constants/process-status';
import { ImportPreview } from '../../compass/packages/compass-import-export/src/components/import-preview';
import ImportPreviewLoader from '../../compass/packages/compass-import-export/src/components/import-preview-loader';
import { ImportOptions } from './import-options';
import type { AcceptedFileType } from '../../compass/packages/compass-import-export/src/constants/file-types';
import {
  cancelImport,
  skipCSVAnalyze,
  setDelimiter,
  setStopOnErrors,
  setIgnoreBlanks,
  closeImport,
  toggleIncludeField,
  setFieldType,
} from '../../compass/packages/compass-import-export/src/modules/import';
import { selectImportFile, startImport } from '../import';
import type { RootImportState } from '../../compass/packages/compass-import-export/src/stores/import-store';
import type { FieldFromCSV } from '../../compass/packages/compass-import-export/src/modules/import';
import { ImportFileInput } from './import-file-input';
import type {
  Delimiter,
  CSVParsableFieldType,
} from '../../compass/packages/compass-import-export/src/csv/csv-types';
import {
  useTrackOnChange,
  type TrackFunction,
} from '@mongodb-js/compass-telemetry/provider';

const closeButtonStyles = css({
  marginRight: spacing[200],
});

const fieldsHeadingStyles = css({
  fontWeight: 'bold',
  paddingBottom: spacing[200],
});

const fieldsHeadingStylesDark = css({
  borderBottom: `2px solid ${palette.gray.dark2}`,
});

const fieldsHeadingStylesLight = css({
  borderBottom: `2px solid ${palette.gray.light2}`,
});

const analyzeContainerStyles = css({
  // Remove double spacing between the analyze container and the form action
  // buttons caused by analyze always being the last item when visible.
  marginBottom: 0,
});

const dataTypesLinkStyles = css({
  marginLeft: spacing[400],
});

type ImportModalProps = {
  isOpen: boolean;
  ns: string;
  startImport: (file: File) => void;
  cancelImport: () => void;
  skipCSVAnalyze: () => void;
  closeImport: () => void;
  errors: Error[];
  status: ProcessStatus;

  /**
   * See `<ImportOptions />`
   */
  selectImportFile: (file: File) => void;
  setDelimiter: (delimiter: Delimiter) => void;
  delimiter: Delimiter;
  fileType: AcceptedFileType | '';
  fileName: string;
  stopOnErrors: boolean;
  setStopOnErrors: (stopOnErrors: boolean) => void;
  ignoreBlanks: boolean;
  setIgnoreBlanks: (ignoreBlanks: boolean) => void;

  /**
   * See `<ImportPreview />`
   */
  fields: {
    isArray?: boolean;
    path: string;
    checked?: boolean; // CSV placeholder fields don't have checked
    type?: CSVParsableFieldType;
  }[];
  values: string[][];
  toggleIncludeField: (path: string) => void;
  setFieldType: (path: string, bsonType: string) => void;
  previewLoaded: boolean;
  csvAnalyzed: boolean;
  analyzeError?: Error;
};

function ImportModal({
  isOpen,
  ns,
  startImport,
  cancelImport,
  closeImport,

  errors,
  status,
  fileName,
  selectImportFile,
  setDelimiter,
  delimiter,
  fileType,
  stopOnErrors,
  setStopOnErrors,
  ignoreBlanks,
  setIgnoreBlanks,

  fields,
  values,
  toggleIncludeField,
  setFieldType,
  previewLoaded,
  csvAnalyzed,
  analyzeError,
}: ImportModalProps) {
  const darkMode = useDarkMode();

  const modalBodyRef = useRef<HTMLDivElement>(null);

  const fileRef = useRef<File | null>(null);

  const handleClose = useCallback(() => {
    cancelImport();
    closeImport();
  }, [closeImport, cancelImport]);

  useEffect(() => {
    // When the errors change and there are new errors, we auto scroll
    // to the end of the modal body to ensure folks see the new errors.
    if (isOpen && errors && modalBodyRef.current) {
      const contentDiv = modalBodyRef.current;
      contentDiv.scrollTop = contentDiv.scrollHeight;
    }
  }, [errors, isOpen]);

  useTrackOnChange(
    (track: TrackFunction) => {
      if (isOpen) {
        track('Screen', { name: 'import_modal' }, undefined);
      }
    },
    [isOpen],
    undefined
  );

  if (isOpen && !fileName && errors.length === 0) {
    // Show the file input when we don't have a file to import yet.
    return (
      // Don't actually show it on the screen, just render it to trigger
      // autoOpen
      <div style={{ display: 'none' }}>
        <ImportFileInput
          autoOpen
          onCancel={handleClose}
          fileName={fileName}
          selectImportFile={selectImportFile}
          fileRef={fileRef}
        />
      </div>
    );
  }

  return (
    <Modal
      open={isOpen}
      setOpen={handleClose}
      data-testid="import-modal"
      size={fileType === 'csv' ? 'large' : 'small'}
    >
      <ModalHeader title="Import" subtitle={`To collection ${ns}`} />
      <ModalBody ref={modalBodyRef}>
        <ImportOptions
          delimiter={delimiter}
          setDelimiter={setDelimiter}
          fileType={fileType}
          fileName={fileName}
          selectImportFile={selectImportFile}
          stopOnErrors={stopOnErrors}
          setStopOnErrors={setStopOnErrors}
          ignoreBlanks={ignoreBlanks}
          setIgnoreBlanks={setIgnoreBlanks}
        />
        {fileType === 'csv' && !analyzeError && (
          <FormFieldContainer className={analyzeContainerStyles}>
            <Body
              as="h3"
              className={cx(
                fieldsHeadingStyles,
                darkMode ? fieldsHeadingStylesDark : fieldsHeadingStylesLight
              )}
            >
              Specify Fields and Types
              <Link
                className={dataTypesLinkStyles}
                href="https://www.mongodb.com/docs/mongodb-shell/reference/data-types/"
              >
                Learn more about data types
              </Link>
            </Body>
            {csvAnalyzed ? (
              <ImportPreview
                loaded={previewLoaded}
                onFieldCheckedChanged={toggleIncludeField}
                setFieldType={setFieldType}
                values={values}
                fields={fields as FieldFromCSV[]}
              />
            ) : (
              <ImportPreviewLoader />
            )}
          </FormFieldContainer>
        )}
        {errors.length > 0 && (
          <ErrorSummary errors={errors.map((error) => error.message)} />
        )}
        {analyzeError && (
          <ErrorSummary
            data-testid="analyze-error"
            errors={[analyzeError.message]}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          data-testid="import-button"
          onClick={() => startImport(fileRef.current!)}
          disabled={
            !fileName ||
            status === STARTED ||
            (fileType === 'csv' && !csvAnalyzed)
          }
          variant="primary"
        >
          {status === STARTED ? 'Importing\u2026' : 'Import'}
        </Button>
        <Button
          className={closeButtonStyles}
          data-testid="cancel-button"
          onClick={handleClose}
        >
          {FINISHED_STATUSES.includes(status) ? 'Close' : 'Cancel'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Map the state of the store to component properties.
 */
const mapStateToProps = (state: RootImportState) => ({
  ns: state.import.namespace,
  isOpen: state.import.isOpen,
  errors: state.import.firstErrors,
  fileType: state.import.fileType,
  fileName: state.import.fileName,
  status: state.import.status,
  delimiter: state.import.delimiter,
  stopOnErrors: state.import.stopOnErrors,
  ignoreBlanks: state.import.ignoreBlanks,
  fields: state.import.fields,
  values: state.import.values,
  previewLoaded: state.import.previewLoaded,
  csvAnalyzed: state.import.analyzeStatus === 'COMPLETED',
  analyzeError: state.import.analyzeError,
});

/**
 * Export the connected component as the default.
 */
export default connect(mapStateToProps, {
  startImport,
  cancelImport,
  skipCSVAnalyze,
  selectImportFile,
  setDelimiter,
  setStopOnErrors,
  setIgnoreBlanks,
  closeImport,
  toggleIncludeField,
  setFieldType,
})(ImportModal);
