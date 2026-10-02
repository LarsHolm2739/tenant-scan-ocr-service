import assert from "node:assert/strict";
import test from "node:test";
import { TenantDocumentService } from "../src/tenant_document_service.js";

test("a suspended tenant cannot send a scan to OCR", async () => {
  let ocrCalls = 0;
  const service = new TenantDocumentService({
    async ocr() {
      ocrCalls += 1;
      return "Patient services agreement";
    }
  });
  service.onboard({ tenantId: "clinic-17", displayName: "North Clinic", adminEmail: "admin@example.test" });
  service.setAccountStatus("clinic-17", "suspended");

  await assert.rejects(
    service.ingest("clinic-17", { documentId: "agreement-4", pdf: "https://files.example.test/agreement.pdf" }),
    /not active/
  );
  assert.equal(ocrCalls, 0);
});

test("an active tenant gets searchable OCR text", async () => {
  const service = new TenantDocumentService({ async ocr() { return "Patient services agreement"; } });
  service.onboard({ tenantId: "clinic-17", displayName: "North Clinic", adminEmail: "admin@example.test" });
  await service.ingest("clinic-17", { documentId: "agreement-4", pdf: "https://files.example.test/agreement.pdf" });

  assert.equal(service.search("clinic-17", "services")[0]?.documentId, "agreement-4");
  assert.equal(service.search("other-tenant", "services").length, 0);
});
