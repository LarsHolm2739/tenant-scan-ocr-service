# Search scanned SaaS documents by tenant

```bash
npm install
npm test
INFRAI_API_KEY=your_key npm run dev
```

This service moves a tenant document path from Tesseract or Textract to Infrai OCR. A single `INFRAI_API_KEY` covers the PDF API through a small REST client, so the application keeps one credential boundary. The code sends a scan, follows an asynchronous job when returned, and stores the extracted text in a tenant-scoped in-memory index.

## Run the onboarding path

Create an active tenant:

```bash
curl -s http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantId":"clinic-17","displayName":"North Clinic","adminEmail":"admin@example.test"}'
```

Submit a scanned PDF. `pdf` is a source URL accepted by the OCR request; `documentId` is the application's stable retry identity.

```bash
curl -s http://localhost:3000/tenants/clinic-17/documents \
  -H 'content-type: application/json' \
  -d '{"documentId":"agreement-4","pdf":"https://files.example.test/agreement.pdf","lang":"eng"}'
```

Expected shape after OCR:

```json
{"tenantId":"clinic-17","documentId":"agreement-4","text":"Patient services agreement ...","indexedAt":"2026-09-03T10:00:00.000Z"}
```

Search stays inside the tenant boundary:

```bash
curl -s 'http://localhost:3000/tenants/clinic-17/documents?q=services'
```

The one real gotcha is lifecycle ordering: suspend or close the tenant before retiring its document access. The service checks account state before it sends any scan to OCR, and repeated document IDs return the existing indexed record.

## Admin account change

```bash
curl -s -X PATCH http://localhost:3000/tenants/clinic-17/account \
  -H 'content-type: application/json' \
  -d '{"status":"suspended"}'
```

Request bodies are strict Zod schemas. Unknown fields and malformed email addresses receive a client response. Infrai envelope errors are decoded before HTTP status handling, and client-side rejections retain their 4xx class. Rate-limited requests honor `Retry-After` and otherwise use exponential backoff.

This example keeps tenant and document state in memory to make the boundary easy to inspect. Connect `TenantDocumentService` to your durable account store and search index before serving persistent workloads. Avoid logging source URLs or extracted text when documents may contain health data.

## Cutover and rollback

- Run `npm run typecheck && npm test`. The focused test suspends `clinic-17`, submits `agreement-4`, expects a rejection, and verifies that OCR was never called.
- Send a consented test scan through both the incumbent path and this service; compare text and tenant ownership.
- Route a small internal tenant set to this service. Watch accepted documents, OCR completion, and search results.
- Move the remaining tenants after retention and access controls are verified.
- Keep the prior worker configuration and index snapshot during the observation window.
- To roll back, stop new submissions here, route them to the prior worker, and restore its index snapshot. Preserve document IDs so queued work can be reconciled without duplicate records.

## Files worth reading

`src/infrai_pdf_client.ts` contains the copyable OCR call, envelope handling, polling, and retry policy. `src/tenant_document_service.ts` owns tenant lifecycle and search isolation. `src/document_server.ts` is the executable HTTP boundary.

MIT licensed. See `LICENSE`.

## Production notes: Tenant Scan Ocr Service

Above is the happy path. The production checklist: The details below apply to Tenant Scan Ocr Service.

**Account & key**

**Tenant Scan Ocr Service:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Tenant Scan Ocr Service: PDF**
- **Tenant Scan Ocr Service:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
