import React, { useCallback } from 'react';

import {
  Body,
  Checkbox,
  Select,
  Label,
  Option,
  css,
  spacing,
} from '../../compass/packages/compass-components/src';

import type { AcceptedFileType } from '../../compass/packages/compass-import-export/src/constants/file-types';
import type { Delimiter } from '../../compass/packages/compass-import-export/src/csv/csv-types';
import { ImportFileInput } from './import-file-input';

const formStyles = css({
  paddingTop: spacing[400],
});

const optionsHeadingStyles = css({
  fontWeight: 'bold',
  marginTop: spacing[400],
});

const inlineFieldStyles = css({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing[200],
});

const inlineLabelStyles = css({
  fontWeight: 'normal',
});

const delimiterSelectStyles = css({
  minWidth: '120px', // fit all options without wrapping
});

const checkboxStyles = css({
  margin: `${spacing[200]}px 0`,
});

const delimiters: {
  value: Delimiter;
  label: string;
}[] = [
  {
    value: ',',
    label: 'Comma',
  },
  {
    value: '\t',
    label: 'Tab',
  },
  {
    value: ';',
    label: 'Semicolon',
  },
  {
    value: ' ',
    label: 'Space',
  },
];

type ImportOptionsProps = {
  selectImportFile: (file: File) => void;
  setDelimiter: (delimiter: Delimiter) => void;
  delimiter: Delimiter;
  fileType: AcceptedFileType | '';
  fileName: string;
  stopOnErrors: boolean;
  setStopOnErrors: (stopOnErrors: boolean) => void;
  ignoreBlanks: boolean;
  setIgnoreBlanks: (ignoreBlanks: boolean) => void;
};

function ImportOptions({
  selectImportFile,
  setDelimiter,
  delimiter,
  fileType,
  fileName,
  stopOnErrors,
  setStopOnErrors,
  ignoreBlanks,
  setIgnoreBlanks,
}: ImportOptionsProps) {
  const handleOnSubmit = useCallback((evt) => {
    evt.preventDefault();
    evt.stopPropagation();
  }, []);

  const isCSV = fileType === 'csv';

  return (
    <form onSubmit={handleOnSubmit} className={formStyles}>
      <ImportFileInput
        fileName={fileName}
        selectImportFile={selectImportFile}
      />
      <Body as="h3" className={optionsHeadingStyles}>
        Options
      </Body>
      {isCSV && (
        <>
          <div className={inlineFieldStyles}>
            <Label
              id="import-delimiter-label"
              htmlFor="import-delimiter-select"
              className={inlineLabelStyles}
            >
              Select delimiter
            </Label>
            <Select
              className={delimiterSelectStyles}
              id="import-delimiter-select"
              aria-labelledby="import-delimiter-label"
              aria-label="Delimiter"
              data-testid="import-delimiter-select"
              onChange={(delimiter: string) =>
                void setDelimiter(delimiter as Delimiter)
              }
              value={delimiter}
              allowDeselect={false}
              size="small"
            >
              {delimiters.map(({ value, label }) => (
                <Option key={value} value={value}>
                  {label}
                </Option>
              ))}
            </Select>
          </div>
          <Checkbox
            className={checkboxStyles}
            checked={ignoreBlanks}
            onChange={() => {
              setIgnoreBlanks(!ignoreBlanks);
            }}
            label="Ignore empty strings"
          />
        </>
      )}
      <Checkbox
        data-testid="import-stop-on-errors"
        className={checkboxStyles}
        checked={stopOnErrors}
        onChange={() => {
          setStopOnErrors(!stopOnErrors);
        }}
        label="Stop on errors"
      />
    </form>
  );
}

export { ImportOptions };
