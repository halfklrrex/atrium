# P2 Spec: Files Column (Metadata Schema)

**Epic:** Files column  
**Roadmap Item:** `3306293650` (Phase P2: Full Column Library)  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/column-files`

---

## 1. Overview & Architecture Boundary

> [!IMPORTANT]
> **Scope Boundary:** This PR delivers the **metadata schema and client helpers only**.
> Storage upload mechanisms, `storage.rules`, and emulator test suites are tracked separately as a mandatory follow-up item (**Roadmap ID: `3307132989`**; per AGENTS.md, no Storage path ships to production without security rules and emulator test coverage).

The Files column stores file attachment metadata on items, enabling structured file tracking, size summaries, and validation against board and item hierarchies:

- **Metadata Only**: Stores attachment metadata (`id`, `name`, `storagePath`, `size`, `mimeType`, `uploadedAt`, `uploadedBy`).
- **No Direct Stored URLs**: The schema does **not** persist `url` strings. Persisting URLs exposes potential `javascript:` execution, signed URLs expire, and public URLs bypass Firebase Security Rules. Instead, download URLs are derived dynamically at render time via Firebase Storage SDK (`getDownloadURL(storagePath)`).
- **Strict Storage Path Hierarchy**: Every attachment strictly maps to `boards/{boardId}/items/{itemId}/files/{fileId}`, with traversal patterns (`..`) rejected by `validateFilesValue`.
- **Upload Callable Validation**: Client-supplied `size`, `mimeType`, `uploadedAt`, and `uploadedBy` are display fields on the client schema; they will be strictly verified and written by the server-side upload callable in `3307132989`.
- **Settings & Grammar**: Per-column max size is capped at 100 MB (`maxFileSizeMb: 1..100`, default 50 MB). `allowedTypes` accepts file extensions (e.g. `.pdf`, `.png`), MIME wildcards (e.g. `image/*`), and exact MIME types (e.g. `application/pdf`).

---

## 2. monday.com API v2 Mapping (P11 Importer Note)

monday.com GraphQL API v2 stores file column values in the following shape:

```json
{
  "files": [
    {
      "fileType": "asset",
      "assetId": 12345678,
      "name": "design_spec.pdf",
      "isImage": false
    }
  ]
}
```

During board migration in Phase P11:

1. The importer fetches file metadata and download streams from monday's asset CDN via GraphQL `assets(ids: [12345678]) { public_url, name, file_extension, file_size }`.
2. The importer streams the file binary to Atrium Firebase Cloud Storage at `boards/{boardId}/items/{itemId}/files/{newId}`.
3. The importer constructs the canonical Atrium `FileAttachment` record with Atrium `storagePath`, `size`, `mimeType`, and creator `uploadedBy`.

---

## 3. Data Models & Schemas

### 3.1 File Attachment Schema (`fileAttachmentSchema`)

```ts
export const fileAttachmentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    storagePath: z.string().min(1),
    size: z.number().int().min(0),
    mimeType: z.string().min(1),
    uploadedAt: z.string().datetime(),
    uploadedBy: uidSchema,
  })
  .strict();
```

### 3.2 Files Value Schema (`filesValueSchema`)

```ts
export const filesValueSchema = z
  .object({
    files: z
      .array(fileAttachmentSchema)
      .max(100)
      .refine((files) => new Set(files.map((f) => f.id)).size === files.length, {
        message: 'File ids must be unique',
      }),
  })
  .strict();
```

### 3.3 Files Settings Schema (`filesSettingsSchema`)

```ts
export const filesSettingsSchema = z
  .object({
    maxFileSizeMb: z.number().int().min(1).max(100).default(50),
    allowedTypes: z.array(z.string().min(1)).optional(),
  })
  .strict();
```

---

## 4. Helper Methods & Validation

- **`validateFilesValue(value, { boardId, itemId })`**: Verifies every file's `storagePath` strictly equals `boards/${boardId}/items/${itemId}/files/${file.id}` and contains no `..` traversal tokens.
- **`isFileAllowed(file, settings)`**: Matches candidate files against extension patterns (`.ext`), MIME wildcards (`image/*`), exact types (`application/pdf`), and verifies size is under `maxFileSizeMb * 1024 * 1024`.
- **`formatFileSize(bytes)`**: Accurately formats bytes into `"0 B"`, `"1.0 KB"`, `"1.5 MB"`, `"1.0 GB"`, rounding boundary numbers such as `1048575` up to `"1.0 MB"`.
- **`addFile(value, file)`**: Enforces the 100-file ceiling and rejects duplicate file IDs.
- **`removeFile(value, fileId)`**: Removes metadata from cell. Note: Orphaned storage object cleanup is handled in the Storage follow-up callable.
- **`aggregate`**: Computes total attached files count; returns `null` for empty sets.
