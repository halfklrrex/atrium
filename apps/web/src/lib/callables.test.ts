import { httpsCallable } from 'firebase/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callClickButton,
  callDeleteFileAttachment,
  callFinalizeFileUpload,
  callGetFileDownloadUrl,
  callRequestFileUpload,
  callStartTimeTracking,
  callStopTimeTracking,
  columnActionCalls,
  describeCallableError,
  fileCalls,
} from './callables';
import { functions } from './firebase';

vi.mock('./firebase', () => ({
  functions: { __mock: 'functions' },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

const mockHttpsCallable = vi.mocked(httpsCallable);

const sampleAttachment = {
  id: 'file-1',
  name: 'report.pdf',
  storagePath: 'boards/board-1/items/item-1/files/file-1',
  size: 2048,
  mimeType: 'application/pdf',
  uploadedAt: '2026-10-28T10:00:00.000Z',
  uploadedBy: 'user-1',
};

describe('server-managed column callables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the 7 wrappers on columnActionCalls and fileCalls', () => {
    expect(columnActionCalls.clickButton).toBe(callClickButton);
    expect(columnActionCalls.startTimeTracking).toBe(callStartTimeTracking);
    expect(columnActionCalls.stopTimeTracking).toBe(callStopTimeTracking);
    expect(fileCalls.requestUpload).toBe(callRequestFileUpload);
    expect(fileCalls.finalizeUpload).toBe(callFinalizeFileUpload);
    expect(fileCalls.getDownloadUrl).toBe(callGetFileDownloadUrl);
    expect(fileCalls.deleteAttachment).toBe(callDeleteFileAttachment);
  });

  describe('callClickButton', () => {
    it('validates request, invokes clickButton callable, and parses response', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: true, activityId: 'act-1', timestamp: 1700000000000 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = { boardId: 'board-1', itemId: 'item-1', columnId: 'col-btn' };
      const res = await callClickButton(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'clickButton');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual({ success: true, activityId: 'act-1', timestamp: 1700000000000 });
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callClickButton({ boardId: '', itemId: 'item-1', columnId: 'col-btn' }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({ data: { success: true } });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callClickButton({ boardId: 'board-1', itemId: 'item-1', columnId: 'col-btn' }),
      ).rejects.toThrow();
    });
  });

  describe('callStartTimeTracking', () => {
    it('validates request, invokes startTimeTracking callable, and parses response', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: true, sessionId: 'sess-1', startedAt: 1700000000000 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-tt',
        note: 'Initial session',
      };
      const res = await callStartTimeTracking(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'startTimeTracking');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual({ success: true, sessionId: 'sess-1', startedAt: 1700000000000 });
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callStartTimeTracking({ boardId: 'board-1', itemId: '', columnId: 'col-tt' }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: true, sessionId: '', startedAt: -10 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callStartTimeTracking({ boardId: 'board-1', itemId: 'item-1', columnId: 'col-tt' }),
      ).rejects.toThrow();
    });
  });

  describe('callStopTimeTracking', () => {
    it('validates request, invokes stopTimeTracking callable, and parses response', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: true, duration: 95, stoppedAt: 1700000095000 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-tt',
        sessionId: 'sess-1',
      };
      const res = await callStopTimeTracking(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'stopTimeTracking');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual({ success: true, duration: 95, stoppedAt: 1700000095000 });
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callStopTimeTracking({ boardId: 'board-1', itemId: 'item-1', columnId: '' }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: true, duration: -1, stoppedAt: 1700000095000 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callStopTimeTracking({ boardId: 'board-1', itemId: 'item-1', columnId: 'col-tt' }),
      ).rejects.toThrow();
    });
  });

  describe('callRequestFileUpload', () => {
    it('validates request, invokes requestFileUpload callable, and parses response', async () => {
      const payload = {
        uploadUrl: 'https://storage.example.com/upload/file-1',
        fileId: 'file-1',
        storagePath: 'boards/board-1/items/item-1/files/file-1',
        expiresAt: 1700000600000,
        headers: { 'Content-Type': 'application/pdf' },
      };
      const remote = vi.fn().mockResolvedValue({ data: payload });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-files',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
      const res = await callRequestFileUpload(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'requestFileUpload');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual(payload);
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callRequestFileUpload({
          boardId: 'board/invalid',
          itemId: 'item-1',
          columnId: 'col-files',
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: {
          uploadUrl: 'not-a-valid-url',
          fileId: 'file-1',
          storagePath: 'boards/board-1/items/item-1/files/file-1',
          expiresAt: 1700000600000,
        },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callRequestFileUpload({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      ).rejects.toThrow();
    });
  });

  describe('callFinalizeFileUpload', () => {
    it('validates request, invokes finalizeFileUpload callable, and parses response', async () => {
      const payload = {
        file: sampleAttachment,
        columnValue: { files: [sampleAttachment] },
      };
      const remote = vi.fn().mockResolvedValue({ data: payload });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-files',
        fileId: 'file-1',
        fileName: 'report.pdf',
      };
      const res = await callFinalizeFileUpload(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'finalizeFileUpload');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual(payload);
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callFinalizeFileUpload({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: '../bad',
          fileName: 'report.pdf',
        }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({ data: { file: {}, columnValue: {} } });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callFinalizeFileUpload({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: 'file-1',
          fileName: 'report.pdf',
        }),
      ).rejects.toThrow();
    });
  });

  describe('callGetFileDownloadUrl', () => {
    it('validates request, invokes getFileDownloadUrl callable, and parses response', async () => {
      const payload = {
        downloadUrl: 'https://storage.example.com/download/file-1',
        expiresAt: 1700000600000,
      };
      const remote = vi.fn().mockResolvedValue({ data: payload });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-files',
        fileId: 'file-1',
      };
      const res = await callGetFileDownloadUrl(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'getFileDownloadUrl');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual(payload);
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callGetFileDownloadUrl({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: '',
        }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { downloadUrl: 'invalid-url', expiresAt: 0 },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callGetFileDownloadUrl({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: 'file-1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('callDeleteFileAttachment', () => {
    it('validates request, invokes deleteFileAttachment callable, and parses response', async () => {
      const payload = {
        success: true as const,
        columnValue: { files: [] },
      };
      const remote = vi.fn().mockResolvedValue({ data: payload });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      const req = {
        boardId: 'board-1',
        itemId: 'item-1',
        columnId: 'col-files',
        fileId: 'file-1',
      };
      const res = await callDeleteFileAttachment(req);

      expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'deleteFileAttachment');
      expect(remote).toHaveBeenCalledWith(req);
      expect(res).toEqual(payload);
    });

    it('rejects invalid request before calling httpsCallable', async () => {
      await expect(
        callDeleteFileAttachment({
          boardId: '',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: 'file-1',
        }),
      ).rejects.toThrow();
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('rejects invalid response payload from server', async () => {
      const remote = vi.fn().mockResolvedValue({
        data: { success: false, columnValue: { files: [] } },
      });
      mockHttpsCallable.mockReturnValue(remote as unknown as ReturnType<typeof httpsCallable>);

      await expect(
        callDeleteFileAttachment({
          boardId: 'board-1',
          itemId: 'item-1',
          columnId: 'col-files',
          fileId: 'file-1',
        }),
      ).rejects.toThrow();
    });
  });
});

describe('describeCallableError', () => {
  it('maps permission-denied with or without functions/ prefix to default friendly text', () => {
    expect(describeCallableError({ code: 'permission-denied' }, 'Fallback')).toBe(
      'You do not have permission to perform this action.',
    );
    expect(
      describeCallableError(
        { code: 'functions/permission-denied', message: 'functions/permission-denied' },
        'Fallback',
      ),
    ).toBe('You do not have permission to perform this action.');
    expect(
      describeCallableError({ code: 'permission-denied', message: 'INTERNAL' }, 'Fallback'),
    ).toBe('You do not have permission to perform this action.');
  });

  it('maps failed-precondition with or without functions/ prefix to default friendly text', () => {
    expect(describeCallableError({ code: 'failed-precondition' }, 'Fallback')).toBe(
      'This action cannot be completed in the current state.',
    );
    expect(
      describeCallableError(
        { code: 'functions/failed-precondition', message: 'functions/failed-precondition' },
        'Fallback',
      ),
    ).toBe('This action cannot be completed in the current state.');
  });

  it('maps resource-exhausted with or without functions/ prefix to default friendly text', () => {
    expect(describeCallableError({ code: 'resource-exhausted' }, 'Fallback')).toBe(
      'Rate limit or quota reached. Please wait a moment and try again.',
    );
    expect(
      describeCallableError(
        { code: 'functions/resource-exhausted', message: 'INTERNAL' },
        'Fallback',
      ),
    ).toBe('Rate limit or quota reached. Please wait a moment and try again.');
  });

  it('returns custom server message when provided on explained error codes', () => {
    expect(
      describeCallableError(
        { code: 'functions/permission-denied', message: 'Only board editors can upload files.' },
        'Fallback',
      ),
    ).toBe('Only board editors can upload files.');
    expect(
      describeCallableError(
        { code: 'failed-precondition', message: 'Timer is already running.' },
        'Fallback',
      ),
    ).toBe('Timer is already running.');
    expect(
      describeCallableError(
        { code: 'functions/resource-exhausted', message: 'Maximum of 100 files reached.' },
        'Fallback',
      ),
    ).toBe('Maximum of 100 files reached.');
  });

  it('maps offline/deadline codes and falls back for unknown errors', () => {
    expect(describeCallableError({ code: 'functions/unavailable' }, 'Fallback')).toBe(
      'You appear to be offline. Try again in a moment.',
    );
    expect(describeCallableError({ code: 'functions/internal' }, 'Fallback')).toBe('Fallback');
    expect(describeCallableError(null, 'Fallback')).toBe('Fallback');
  });
});
