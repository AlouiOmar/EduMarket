import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { env } from '../config/env.js';

export type PrivateStorageArea = 'course-assets' | 'assignment-submissions' | 'message-attachments' | 'teacher-evidence' | 'payment-proofs' | 'cloud-staging' | 'group-files' | 'scorm-packages';
export type PrivateFileResponse = {
  mimeType: string;
  downloadName?: string;
  headers?: Record<string, string>;
};

export interface PrivateStorageAdapter {
  uploadDirectory(area: PrivateStorageArea): string;
  readUpload(uploadPath: string): Promise<Buffer>;
  readUploadPrefix(uploadPath: string, length: number): Promise<Buffer>;
  storeUpload(area: PrivateStorageArea, storageKey: string, uploadPath: string): Promise<void>;
  removeUpload(uploadPath: string): Promise<void>;
  remove(area: PrivateStorageArea, storageKey: string): Promise<void>;
  send(area: PrivateStorageArea, storageKey: string, response: Response, options: PrivateFileResponse, onError: (error?: Error) => void): void;
}

class LocalPrivateStorageAdapter implements PrivateStorageAdapter {
  private readonly root = path.resolve(env.PRIVATE_UPLOAD_DIR);

  uploadDirectory(area: PrivateStorageArea) {
    // Preserve the existing teacher-evidence key layout at the configured root.
    return area === 'teacher-evidence' ? this.root : path.resolve(this.root, area);
  }

  async readUpload(uploadPath: string) { return readFile(uploadPath); }

  async readUploadPrefix(uploadPath: string, length: number) {
    const handle = await open(uploadPath, 'r');
    const bytes = Buffer.alloc(length);
    try {
      const { bytesRead } = await handle.read(bytes, 0, length, 0);
      return bytes.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }

  async storeUpload(area: PrivateStorageArea, storageKey: string, uploadPath: string) {
    const directory = this.uploadDirectory(area);
    await mkdir(directory, { recursive: true });
    await rename(uploadPath, this.filePath(area, storageKey));
  }

  async removeUpload(uploadPath: string) { await rm(uploadPath, { force: true }); }

  async remove(area: PrivateStorageArea, storageKey: string) { await rm(this.filePath(area, storageKey), { force: true }); }

  send(area: PrivateStorageArea, storageKey: string, response: Response, options: PrivateFileResponse, onError: (error?: Error) => void) {
    const filePath = this.filePath(area, storageKey);
    const sendOptions = { headers: { ...options.headers, 'Content-Type': options.mimeType } };
    if (options.downloadName) response.download(filePath, options.downloadName, sendOptions, onError);
    else response.sendFile(filePath, sendOptions, onError);
  }

  private filePath(area: PrivateStorageArea, storageKey: string) {
    if (!storageKey || path.basename(storageKey) !== storageKey || storageKey.includes('\\') || storageKey.includes('/')) throw new Error('INVALID_PRIVATE_STORAGE_KEY');
    const directory = this.uploadDirectory(area);
    const filePath = path.resolve(directory, storageKey);
    if (!filePath.startsWith(`${directory}${path.sep}`)) throw new Error('INVALID_PRIVATE_STORAGE_KEY');
    return filePath;
  }
}

export const privateStorage: PrivateStorageAdapter = new LocalPrivateStorageAdapter();
