import type { ColumnDef, FileAttachment, FilesSettings, FilesValue } from '@atrium/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../components/toast-store';
import { fileCalls } from '../lib/callables';
import { filesUi } from './files';
import type { CellContext, CellProps } from './types';

vi.mock('../lib/callables', () => ({
  fileCalls: {
    requestUpload: vi.fn(),
    finalizeUpload: vi.fn(),
    getDownloadUrl: vi.fn(),
    deleteAttachment: vi.fn(),
  },
  describeCallableError: (_err: unknown, fallback: string) => fallback,
}));

const Cell = filesUi.Cell as ComponentType<CellProps<FilesValue, FilesSettings>>;

const dummyColumn: ColumnDef = {
  id: 'c-files',
  type: 'files',
  title: 'Attachments',
  position: 'a0',
  settings: { maxFileSizeMb: 10 },
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: false,
  canAct: true,
  boardId: 'b-1',
  itemId: 'i-1',
};

function makeFile(idx: number, overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    id: `f-${idx}`,
    name: `report-${idx}.pdf`,
    storagePath: `boards/b-1/items/i-1/files/f-${idx}`,
    size: 1536, // 1.5 KB
    mimeType: 'application/pdf',
    uploadedAt: '2026-10-23T10:30:00.000Z',
    uploadedBy: 'user-avery',
    ...overrides,
  };
}

class MockXHR {
  static instances: MockXHR[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentBody: unknown = null;
  autoComplete = true;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.sentBody = body;
    if (MockXHR.manualMode) return;
    if (this.upload.onprogress) {
      this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
      this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
    }
    if (this.onload) {
      this.onload();
    }
  }

  static manualMode = false;
}

describe('files column UI', () => {
  const originalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    MockXHR.instances = [];
    MockXHR.manualMode = false;
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
  });

  describe('FilesCell rendering', () => {
    it('renders empty state with hint icon when value is null or empty', () => {
      const { container } = render(
        <Cell
          value={null}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      expect(container.querySelector('svg')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Attachments' })).toBeInTheDocument();
    });

    it('renders 1, 2, and 4 files (showing first 2 badges + "+2")', () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <Cell
          value={{ files: [makeFile(1)] }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('report-1.pdf')).toBeInTheDocument();
      expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();

      rerender(
        <Cell
          value={{ files: [makeFile(1), makeFile(2)] }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('report-1.pdf')).toBeInTheDocument();
      expect(screen.getByText('report-2.pdf')).toBeInTheDocument();
      expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();

      rerender(
        <Cell
          value={{ files: [makeFile(1), makeFile(2), makeFile(3), makeFile(4)] }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('report-1.pdf')).toBeInTheDocument();
      expect(screen.getByText('report-2.pdf')).toBeInTheDocument();
      expect(screen.queryByText('report-3.pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('report-4.pdf')).not.toBeInTheDocument();
      expect(screen.getByText('+2')).toBeInTheDocument();
    });
  });

  describe('Files popover', () => {
    it('lists file name, formatted size, uploader, and formatted date', () => {
      const files = [
        makeFile(1, {
          name: 'architecture.pdf',
          size: 1572864, // 1.5 MB
          uploadedBy: 'user-avery',
          uploadedAt: '2026-10-23T10:30:00.000Z',
        }),
      ];

      render(
        <Cell
          value={{ files }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Attachments (1)' }));

      const dialog = screen.getByRole('dialog', { name: 'Attachments' });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveTextContent('architecture.pdf');
      expect(dialog).toHaveTextContent('1.5 MB');
      expect(dialog).toHaveTextContent('user-avery');
      expect(dialog).toHaveTextContent('Oct 23');
    });

    it('downloads a file via fileCalls.getDownloadUrl and opens in a new tab', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      vi.mocked(fileCalls.getDownloadUrl).mockResolvedValue({
        downloadUrl: 'https://storage.example.com/signed-download-url',
        expiresAt: 1700000000000,
      });

      const file = makeFile(1, { name: 'budget.xlsx' });
      render(
        <Cell
          value={{ files: [file] }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Attachments (1)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Download budget.xlsx' }));

      await waitFor(() => {
        expect(fileCalls.getDownloadUrl).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileId: 'f-1',
        });
      });

      expect(openSpy).toHaveBeenCalledWith(
        'https://storage.example.com/signed-download-url',
        '_blank',
        'noopener,noreferrer',
      );
      openSpy.mockRestore();
    });

    it('deletes a file with inline confirmation and calls fileCalls.deleteAttachment', async () => {
      vi.mocked(fileCalls.deleteAttachment).mockResolvedValue({
        success: true,
        columnValue: { files: [] },
      });

      const file = makeFile(1, { name: 'notes.txt' });
      const onChange = vi.fn();
      render(
        <Cell
          value={{ files: [file] }}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Attachments (1)' }));

      // Click Delete -> shows confirmation
      fireEvent.click(screen.getByRole('button', { name: 'Delete notes.txt' }));
      expect(fileCalls.deleteAttachment).not.toHaveBeenCalled();

      const confirmBtn = screen.getByRole('button', { name: 'Confirm delete' });
      expect(confirmBtn).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

      // Confirm deletion
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(fileCalls.deleteAttachment).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileId: 'f-1',
        });
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('uploads a file via file input with XMLHttpRequest progress and finalizeUpload, never calling onChange', async () => {
      MockXHR.manualMode = true;
      const newFile = makeFile(99, { id: 'f-new', name: 'spec.pdf' });
      vi.mocked(fileCalls.requestUpload).mockResolvedValue({
        fileId: 'f-new',
        storagePath: 'boards/b-1/items/i-1/files/f-new',
        uploadUrl: 'https://storage.example.com/upload-signed',
        headers: { 'Content-Type': 'application/pdf', 'x-goog-content-length-range': '0,2048' },
        expiresAt: 1700000000000,
      });
      vi.mocked(fileCalls.finalizeUpload).mockResolvedValue({
        file: newFile,
        columnValue: { files: [newFile] },
      });

      const onChange = vi.fn();
      render(
        <Cell
          value={null}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      // Click empty cell to open popover
      fireEvent.click(screen.getByRole('button', { name: 'Add Attachments' }));
      expect(screen.getByRole('dialog', { name: 'Attachments' })).toBeInTheDocument();

      const input = screen.getByTestId('files-upload-input') as HTMLInputElement;
      const testFile = new File(['hello pdf content'], 'spec.pdf', { type: 'application/pdf' });

      fireEvent.change(input, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(fileCalls.requestUpload).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileName: 'spec.pdf',
          contentType: 'application/pdf',
          size: testFile.size,
        });
      });

      await waitFor(() => {
        expect(MockXHR.instances.length).toBe(1);
      });

      const xhr = MockXHR.instances[0]!;
      expect(xhr.method).toBe('PUT');
      expect(xhr.url).toBe('https://storage.example.com/upload-signed');
      expect(xhr.headers).toEqual({
        'Content-Type': 'application/pdf',
        'x-goog-content-length-range': '0,2048',
      });

      // Verify progress bar updates during XHR upload
      const progressBar = screen.getByRole('progressbar', { name: 'Upload progress' });
      expect(progressBar).toHaveAttribute('aria-valuenow', '0');

      act(() => {
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 65, total: 100 });
      });
      expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute(
        'aria-valuenow',
        '65',
      );

      act(() => {
        xhr.onload?.();
      });

      await waitFor(() => {
        expect(fileCalls.finalizeUpload).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileId: 'f-new',
          fileName: 'spec.pdf',
        });
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('supports drag-and-drop upload onto the popover body', async () => {
      const droppedAttachment = makeFile(100, {
        id: 'f-drop',
        name: 'diagram.png',
        mimeType: 'image/png',
      });
      vi.mocked(fileCalls.requestUpload).mockResolvedValue({
        fileId: 'f-drop',
        storagePath: 'boards/b-1/items/i-1/files/f-drop',
        uploadUrl: 'https://storage.example.com/upload-drop',
        headers: { 'Content-Type': 'image/png' },
        expiresAt: 1700000000000,
      });
      vi.mocked(fileCalls.finalizeUpload).mockResolvedValue({
        file: droppedAttachment,
        columnValue: { files: [droppedAttachment] },
      });

      const onChange = vi.fn();
      render(
        <Cell
          value={null}
          settings={{ maxFileSizeMb: 10 }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add Attachments' }));
      const dialog = screen.getByRole('dialog', { name: 'Attachments' });
      const dropZone = dialog.firstElementChild as HTMLElement;

      const droppedFile = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
      fireEvent.dragOver(dropZone);
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [droppedFile] },
      });

      await waitFor(() => {
        expect(fileCalls.requestUpload).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileName: 'diagram.png',
          contentType: 'image/png',
          size: droppedFile.size,
        });
      });

      await waitFor(() => {
        expect(fileCalls.finalizeUpload).toHaveBeenCalledWith({
          boardId: 'b-1',
          itemId: 'i-1',
          columnId: 'c-files',
          fileId: 'f-drop',
          fileName: 'diagram.png',
        });
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects files exceeding settings.maxFileSizeMb or failing settings.allowedTypes on the client with a negative toast', async () => {
      const onChange = vi.fn();
      render(
        <Cell
          value={null}
          settings={{ maxFileSizeMb: 1, allowedTypes: ['.pdf', 'image/*'] }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add Attachments' }));
      const input = screen.getByTestId('files-upload-input') as HTMLInputElement;

      // 1. Disallowed type (.exe)
      const badTypeFile = new File(['binary'], 'installer.exe', {
        type: 'application/x-msdownload',
      });
      fireEvent.change(input, { target: { files: [badTypeFile] } });

      expect(fileCalls.requestUpload).not.toHaveBeenCalled();
      let toasts = useToastStore.getState().toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0]?.type).toBe('negative');
      expect(toasts[0]?.text).toMatch(/allowed types/i);

      // 2. Exceeds maxFileSizeMb (2 MB > 1 MB)
      useToastStore.setState({ toasts: [] });
      const oversizedFile = new File([new Uint8Array(2 * 1024 * 1024)], 'huge.pdf', {
        type: 'application/pdf',
      });
      fireEvent.change(input, { target: { files: [oversizedFile] } });

      expect(fileCalls.requestUpload).not.toHaveBeenCalled();
      toasts = useToastStore.getState().toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0]?.type).toBe('negative');
      expect(toasts[0]?.text).toMatch(/1 MB/i);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
